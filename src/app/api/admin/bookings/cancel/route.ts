import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { getEvent, patchEvent } from "@/lib/google-calendar";
import type { Booking, Ticket } from "@/lib/db-types";
import { retirerAttendee, DELAI_ANNULATION_HEURES } from "@/lib/reservation";
import {
  cancelBodySchema,
  decisionAnnulationAdmin,
  quantiteApresRecredit,
} from "../_logic";

/**
 * POST /api/admin/bookings/cancel — Alice annule une réservation AU NOM d'un
 * client, depuis le back-office.
 *
 * Body : `{ bookingId, overrideGuard?, recredit? }`.
 * Réponses :
 *   - 200 `{ ok: true }`                : annulation effectuée.
 *   - 200 `{ ok: true, alreadyCancelled }` : idempotent (déjà annulée).
 *   - 400 `{ error }`                   : body invalide.
 *   - 404 `{ error }`                   : booking inexistant.
 *   - 409 `{ error, tooLate: true }`    : < 24h ET overrideGuard non demandé.
 *   - (401/redirect géré par requireAdmin)
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ DIFFÉRENCES avec `/api/annuler` (client), tout en RÉUTILISANT sa logique : │
 * │   - Gate = `requireAdmin()` (pas un simple getUser) : Alice agit POUR un   │
 * │     client → on ne vérifie PAS l'appartenance au caller.                   │
 * │   - La garde 24h peut être OUTREPASSÉE (`overrideGuard:true`) : Alice peut  │
 * │     annuler une séance imminente.                                          │
 * │   - Le recrédit est OPTIONNEL (`recredit`, défaut true).                   │
 * │                                                                            │
 * │ La MÉCANIQUE reste identique à `/api/annuler` (ordre fail-safe, mêmes      │
 * │ helpers `retirerAttendee` / recrédit borné) : on ne duplique pas la règle  │
 * │ métier, on la réemploie via `@/lib/reservation` + `../_logic`.            │
 * │                                                                            │
 * │ ATTENDEE GOOGLE : le booking ne stocke pas l'email du client → on le       │
 * │ résout via `profiles.email` (best-effort) pour retirer le bon attendee.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — Cloudflare Workers (edge) : Supabase REST + Google Calendar REST.
 */
export async function POST(request: Request) {
  // ── Gate admin (défense en profondeur côté serveur). ────────────────────────
  await requireAdmin();

  // ── Validation du corps (zod, strict). ──────────────────────────────────────
  let body: { bookingId: string; overrideGuard: boolean; recredit: boolean };
  try {
    const json = await request.json();
    const result = cancelBodySchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: result.error.issues },
        { status: 400 },
      );
    }
    body = result.data;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const service = createServiceClient();

  // ── 1) Charge le booking. ────────────────────────────────────────────────────
  const { data: bookingRow, error: loadErr } = await service
    .from("bookings")
    .select("*")
    .eq("id", body.bookingId)
    .maybeSingle();

  if (loadErr) {
    console.error("[admin/cancel] Lecture du booking échouée :", loadErr.message);
    return NextResponse.json(
      { error: "Impossible de charger la réservation." },
      { status: 500 },
    );
  }
  if (!bookingRow) {
    return NextResponse.json({ error: "Réservation introuvable." }, { status: 404 });
  }

  const booking = bookingRow as Booking;

  // ── 2) Idempotence : déjà annulée → rien à faire. ───────────────────────────
  if (booking.status === "cancelled") {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  // ── 3) Garde 24h (outrepassable par l'admin via overrideGuard). ─────────────
  // Calculée sur `starts_at` lu EN BASE (source de vérité), jamais sur le client.
  const decision = decisionAnnulationAdmin({
    startsAt: booking.starts_at,
    overrideGuard: body.overrideGuard,
    delaiHeures: DELAI_ANNULATION_HEURES,
  });
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error:
          "Annulation à moins de 24h du cours. Cochez « Forcer » pour outrepasser.",
        tooLate: true,
      },
      { status: 409 },
    );
  }

  // ── 4) Marque cancelled AVEC garde status='confirmed' (anti-concurrence). ───
  // Même mécanique que `/api/annuler` : 0 ligne touchée ⇒ annulation concurrente
  // déjà appliquée ⇒ idempotent (ok), pas une erreur.
  const { data: cancelledRow, error: cancelErr } = await service
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", booking.id)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();

  if (cancelErr) {
    console.error("[admin/cancel] Update booking échoué :", cancelErr.message);
    return NextResponse.json({ error: "Annulation impossible." }, { status: 500 });
  }
  if (!cancelledRow) {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  // ── 5) Recrédite le ticket lié (optionnel, best-effort). ────────────────────
  // Recrédit borné identique à `/api/annuler` (helper `quantiteApresRecredit`).
  if (body.recredit && booking.ticket_id) {
    const { data: ticketRow, error: ticketLoadErr } = await service
      .from("tickets")
      .select("*")
      .eq("id", booking.ticket_id)
      .maybeSingle();

    if (ticketLoadErr) {
      console.error(
        "[admin/cancel] Lecture ticket pour recrédit échouée :",
        ticketLoadErr.message,
      );
    } else if (ticketRow) {
      const ticket = ticketRow as Ticket;
      const recredite = quantiteApresRecredit(
        ticket.quantite_restante,
        ticket.quantite_initiale,
      );
      const { error: recreditErr } = await service
        .from("tickets")
        .update({ quantite_restante: recredite })
        .eq("id", ticket.id);
      if (recreditErr) {
        console.error("[admin/cancel] Recrédit ticket échoué :", recreditErr.message);
      }
    }
  }

  // ── 6) Retire le client des attendees de l'event Google (best-effort). ──────
  // On résout l'email du CLIENT (pas de l'admin) via profiles. Si introuvable,
  // on saute proprement le retrait Google : l'annulation métier reste valide.
  if (booking.google_event_id) {
    try {
      const { data: profilRow } = await service
        .from("profiles")
        .select("email")
        .eq("id", booking.user_id)
        .maybeSingle();
      const clientEmail = (profilRow as { email?: string | null } | null)?.email;
      if (clientEmail) {
        const event = await getEvent(booking.google_event_id);
        const attendees = retirerAttendee(event.attendees, clientEmail);
        await patchEvent(booking.google_event_id, { attendees });
      }
    } catch (err) {
      // L'annulation métier (étape 4) a réussi : on n'échoue pas pour un effet
      // de bord Google. Log pour réconciliation manuelle.
      console.error(
        "[admin/cancel] Retrait attendee Google échoué (annulation maintenue) :",
        err,
      );
    }
  }

  return NextResponse.json({ ok: true });
}

// L'annulation admin se fait uniquement en POST.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
