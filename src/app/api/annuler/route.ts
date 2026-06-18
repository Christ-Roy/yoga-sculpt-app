import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEvent, patchEvent } from "@/lib/google-calendar";
import { logEvent } from "@/lib/events";
import type { Booking, Ticket } from "@/lib/db-types";
import {
  retirerAttendee,
  dansMoinsDe,
  DELAI_ANNULATION_HEURES,
} from "@/lib/reservation";

/**
 * POST /api/annuler — annule une réservation confirmée.
 *
 * Body : `{ bookingId: string }`.
 * Réponses :
 *   - 200 `{ ok: true }`  : annulation effectuée.
 *   - 400 `{ error }`     : body invalide.
 *   - 401 `{ error }`     : non authentifié.
 *   - 403 `{ error }`     : le booking n'appartient pas au user.
 *   - 404 `{ error }`     : booking inexistant.
 *   - 409 `{ error, tooLate: true }` : créneau à moins de 24h → annulation refusée.
 *                          (Le "déjà annulé" est, lui, idempotent → 200 ok, cf. infra.)
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ APPROCHE — symétrique de /api/reserver, dans l'ordre fail-safe :         │
 * │   1. Charge le booking (service_role) → 404 si absent.                    │
 * │   2. Vérifie l'appartenance au user → 403 sinon.                          │
 * │   3. Si déjà 'cancelled' → idempotent : on renvoie 200 ok (rien à faire). │
 * │   4. Passe le booking en 'cancelled' AVEC garde `status='confirmed'`       │
 * │      (anti double-annulation concurrente). Libère le verrou unique         │
 * │      (l'index ne s'applique qu'aux 'confirmed') → re-réservation possible. │
 * │   5. Recrédite le ticket lié (quantite_restante + 1), best-effort.        │
 * │   6. Retire le user des attendees de l'event Google (PATCH), best-effort. │
 * │                                                                           │
 * │ On marque l'annulation EN PREMIER (étape 4) : c'est la source de vérité    │
 * │ métier. Le recrédit + le retrait Google sont des effets de bord qu'on log  │
 * │ s'ils ratent, sans bloquer l'annulation (qui, elle, a réussi).            │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Corps attendu : `{ bookingId }`. Rejet strict de tout champ inconnu. */
const bodySchema = z
  .object({
    bookingId: z.string().min(1, "bookingId requis."),
  })
  .strict();

export async function POST(request: Request) {
  // ── Auth (annuler exige d'être connecté). ───────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentification requise." },
      { status: 401 },
    );
  }

  // ── Validation du corps (zod). ──────────────────────────────────────────────
  let bookingId: string;
  try {
    const json = await request.json();
    const result = bodySchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: result.error.issues },
        { status: 400 },
      );
    }
    bookingId = result.data.bookingId;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const service = createServiceClient();

  // ── 1) Charge le booking. ────────────────────────────────────────────────────
  const { data: bookingRow, error: loadErr } = await service
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadErr) {
    console.error("[annuler] Lecture du booking échouée :", loadErr.message);
    return NextResponse.json(
      { error: "Impossible de charger la réservation." },
      { status: 500 },
    );
  }
  if (!bookingRow) {
    return NextResponse.json(
      { error: "Réservation introuvable." },
      { status: 404 },
    );
  }

  const booking = bookingRow as Booking;

  // ── 2) Vérifie l'appartenance (on ne fie PAS la RLS ici : service_role). ────
  if (booking.user_id !== user.id) {
    return NextResponse.json(
      { error: "Cette réservation ne vous appartient pas." },
      { status: 403 },
    );
  }

  // ── 3) Idempotence : déjà annulée → rien à faire, on renvoie ok. ────────────
  if (booking.status === "cancelled") {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  // ── 3 bis) Garde serveur — règle d'annulation min 24h. ──────────────────────
  // On REFUSE d'annuler un créneau qui démarre dans moins de
  // DELAI_ANNULATION_HEURES (24h). Le délai est calculé sur `starts_at` lu EN
  // BASE (source de vérité), jamais sur une date envoyée par le client : un
  // appel API direct ne peut donc PAS contourner la règle déjà appliquée côté
  // UI (bouton désactivé dans MesReservations.tsx, même seuil). On vérifie ce
  // garde-fou APRÈS l'idempotence (un booking déjà annulé reste idempotent) et
  // AVANT toute écriture : aucun recrédit, aucun passage en 'cancelled' ici.
  if (dansMoinsDe(booking.starts_at, DELAI_ANNULATION_HEURES)) {
    return NextResponse.json(
      {
        error: "Annulation impossible à moins de 24h du cours.",
        tooLate: true,
      },
      { status: 409 },
    );
  }

  // ── 4) Marque cancelled AVEC garde status='confirmed' (anti-concurrence). ───
  // Si 0 ligne touchée, c'est qu'un autre appel a annulé entre-temps → on
  // considère l'annulation comme déjà faite (idempotent) plutôt que d'échouer.
  const { data: cancelledRow, error: cancelErr } = await service
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", booking.id)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();

  if (cancelErr) {
    console.error("[annuler] Update booking échoué :", cancelErr.message);
    return NextResponse.json(
      { error: "Annulation impossible." },
      { status: 500 },
    );
  }
  if (!cancelledRow) {
    // Annulation déjà appliquée par un appel concurrent : idempotent.
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  // ── 5) Recrédite le ticket lié (best-effort). ───────────────────────────────
  // On lit la quantité actuelle puis +1, sous le plafond quantite_initiale (le
  // check DB `quantite_restante <= quantite_initiale` rejetterait un dépassement).
  let ticketRecredite = false;
  if (booking.ticket_id) {
    const { data: ticketRow, error: ticketLoadErr } = await service
      .from("tickets")
      .select("*")
      .eq("id", booking.ticket_id)
      .maybeSingle();

    if (ticketLoadErr) {
      console.error(
        "[annuler] Lecture ticket pour recrédit échouée :",
        ticketLoadErr.message,
      );
    } else if (ticketRow) {
      const ticket = ticketRow as Ticket;
      const recredite = Math.min(
        ticket.quantite_restante + 1,
        ticket.quantite_initiale,
      );
      const { error: recreditErr } = await service
        .from("tickets")
        .update({ quantite_restante: recredite })
        .eq("id", ticket.id);
      if (recreditErr) {
        console.error("[annuler] Recrédit ticket échoué :", recreditErr.message);
      } else {
        ticketRecredite = true;
      }
    }
  }

  // ── 6) Retire le user des attendees de l'event Google (best-effort). ────────
  // Le créneau est un event partagé d'Alice : on ne le SUPPRIME pas (d'autres
  // users peuvent y être inscrits), on retire juste le user de la liste.
  if (user.email && booking.google_event_id) {
    try {
      const event = await getEvent(booking.google_event_id);
      const attendees = retirerAttendee(event.attendees, user.email);
      await patchEvent(booking.google_event_id, { attendees });
    } catch (err) {
      // L'annulation métier (étape 4) a réussi : on n'échoue pas la requête
      // pour un effet de bord Google. On log pour réconciliation manuelle.
      console.error(
        "[annuler] Retrait de l'attendee Google échoué (annulation maintenue) :",
        err,
      );
    }
  }

  // ── Tracking : booking_cancelled. ───────────────────────────────────────────
  // best-effort (l'annulation — métier — est déjà committée, étape 4). On
  // réutilise le client service_role déjà ouvert.
  await logEvent(
    user.id,
    "booking_cancelled",
    {
      booking_id: booking.id,
      type: booking.type,
      creneau_id: booking.google_calendar_creneau_id,
      starts_at: booking.starts_at,
      recredite: ticketRecredite,
    },
    { source: "annuler", service },
  );

  return NextResponse.json({ ok: true });
}

// L'annulation se fait uniquement en POST. Tout autre verbe → 405 explicite.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
