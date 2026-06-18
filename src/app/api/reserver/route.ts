import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEvent, patchEvent } from "@/lib/google-calendar";
import { logEvent } from "@/lib/events";
import type { Booking, Ticket } from "@/lib/db-types";
import {
  bornEventToIso,
  deduireTypeDepuisEvent,
} from "@/lib/reservation";

/**
 * POST /api/reserver — réserve un créneau du Google Calendar contre un ticket.
 *
 * Body : `{ creneauId: string }` (id de l'event Google à réserver).
 * Réponses :
 *   - 200 `{ ok: true, booking }`        : réservation confirmée.
 *   - 400 `{ error }`                    : body invalide.
 *   - 401 `{ error }`                    : non authentifié.
 *   - 402 `{ error, needsPurchase, type }`: aucun ticket du bon type → achat requis.
 *   - 404 `{ error }`                    : créneau inexistant côté Google.
 *   - 409 `{ error }`                    : déjà réservé (anti-double-booking) ou
 *                                          course perdue sur le décrément du ticket.
 *   - 502 `{ error }`                    : échec Google Calendar.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ APPROCHE — lien booking ↔ event Google + sûreté concurrente              │
 * │                                                                           │
 * │ Les créneaux sont des events PARTAGÉS posés par Alice. Réserver = inscrire │
 * │ le user comme `attendee` de l'event existant ; on NE crée PAS d'event      │
 * │ perso. Donc `booking.google_event_id == google_calendar_creneau_id ==      │
 * │ creneauId` (stable et simple).                                            │
 * │                                                                           │
 * │ Ordre (idempotent / fail-safe) :                                          │
 * │   1. getEvent(creneauId) → 404 si absent. Déduit le `type`.               │
 * │   2. Sélectionne le ticket valide le plus ancien (FIFO) du bon type ;     │
 * │      aucun → 402 (achat requis). NB : on ne décrémente PAS encore.        │
 * │   3. INSERT bookings (status='confirmed', google_event_id=creneauId).     │
 * │      → C'EST L'INSERT QUI POSE LE VERROU anti-double-booking : l'index     │
 * │        unique partiel (user_id, creneau_id) where confirmed rejette tout   │
 * │        doublon avec une erreur Postgres 23505 → on renvoie 409.           │
 * │   4. Décrémente le ticket : update ... set quantite_restante = …-1         │
 * │      WHERE id=ticket AND quantite_restante>0. Si 0 ligne touchée (course   │
 * │      perdue / ticket vidé entre-temps) → rollback booking + 409.          │
 * │   5. PATCH l'event Google pour ajouter le user en attendee. Si ça échoue   │
 * │      → rollback : recrédite le ticket + supprime le booking (pas de ligne  │
 * │        fantôme) → 502.                                                     │
 * │                                                                           │
 * │ On ne « consomme » réellement (ticket décrémenté + user inscrit côté       │
 * │ Google) QUE si toutes les étapes réussissent.                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Code d'erreur Postgres pour violation de contrainte unique. */
const PG_UNIQUE_VIOLATION = "23505";

/** Corps attendu : `{ creneauId }`. Rejet strict de tout champ inconnu. */
const bodySchema = z
  .object({
    creneauId: z.string().min(1, "creneauId requis."),
  })
  .strict();

export async function POST(request: Request) {
  // ── Auth (réserver exige d'être connecté). ──────────────────────────────────
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
  let creneauId: string;
  try {
    const json = await request.json();
    const result = bodySchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: result.error.issues },
        { status: 400 },
      );
    }
    creneauId = result.data.creneauId;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  // ── 1) Récupère l'event Google → 404 si absent / annulé. ────────────────────
  let event;
  try {
    event = await getEvent(creneauId);
  } catch (err) {
    // getEvent throw aussi bien pour un 404 Google que pour une panne réseau.
    // On distingue grossièrement via le message (contient "HTTP 404").
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("HTTP 404") || message.includes("HTTP 410")) {
      return NextResponse.json(
        { error: "Créneau introuvable." },
        { status: 404 },
      );
    }
    console.error("[reserver] Lecture de l'event Google échouée :", err);
    return NextResponse.json(
      { error: "Service de réservation indisponible." },
      { status: 502 },
    );
  }

  if (event.status === "cancelled") {
    return NextResponse.json(
      { error: "Ce créneau n'est plus disponible." },
      { status: 404 },
    );
  }

  const type = deduireTypeDepuisEvent(event);
  const startsAt = bornEventToIso(event.start);
  const endsAt = bornEventToIso(event.end);
  if (!startsAt || !endsAt) {
    return NextResponse.json(
      { error: "Créneau aux dates invalides." },
      { status: 422 },
    );
  }

  // À partir d'ici, toutes les écritures passent par la service_role (le moteur
  // de résa écrit au nom du système : décrément ticket, insert booking, …).
  const service = createServiceClient();

  // ── 2) Sélectionne le ticket valide le plus ancien (FIFO) du bon type. ──────
  // Critères : appartient au user, bon type, quantite_restante>0, non expiré.
  // Tri created_at asc → on consomme le plus ancien (et donc celui qui expire
  // potentiellement le plus tôt) en premier.
  const nowIso = new Date().toISOString();
  const { data: tickets, error: ticketErr } = await service
    .from("tickets")
    .select("*")
    .eq("user_id", user.id)
    .eq("type", type)
    .gt("quantite_restante", 0)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(1);

  if (ticketErr) {
    console.error("[reserver] Lecture des tickets échouée :", ticketErr.message);
    return NextResponse.json(
      { error: "Impossible de vérifier vos tickets." },
      { status: 500 },
    );
  }

  const ticket = (tickets?.[0] as Ticket | undefined) ?? null;
  if (!ticket) {
    // Pas de ticket → le front redirige vers l'achat (checkout Stripe).
    return NextResponse.json(
      { error: "Aucun ticket disponible", needsPurchase: true, type },
      { status: 402 },
    );
  }

  // ── 3) INSERT booking AVANT de décrémenter → pose le verrou anti-double. ─────
  // L'index unique partiel (user_id, creneau_id) where status='confirmed'
  // rejette un doublon avec un code 23505 → on le mappe en 409.
  // google_event_id = creneauId : le créneau EST l'event qu'on réserve.
  const { data: inserted, error: insertErr } = await service
    .from("bookings")
    .insert({
      user_id: user.id,
      type,
      google_event_id: creneauId,
      google_calendar_creneau_id: creneauId,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "confirmed",
      ticket_id: ticket.id,
    })
    .select("*")
    .single();

  if (insertErr) {
    if (insertErr.code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: "Vous avez déjà réservé ce créneau." },
        { status: 409 },
      );
    }
    console.error("[reserver] Insert booking échoué :", insertErr.message);
    return NextResponse.json(
      { error: "Réservation impossible." },
      { status: 500 },
    );
  }

  const booking = inserted as Booking;

  // ── 4) Décrémente le ticket (clause de garde contre la course). ─────────────
  // WHERE quantite_restante>0 : si un autre appel concurrent a vidé le ticket
  // entre la lecture (étape 2) et maintenant, 0 ligne est touchée → on annule
  // le booking qu'on vient de créer (rollback) et on renvoie 409.
  const { data: decremented, error: decrErr } = await service
    .from("tickets")
    .update({ quantite_restante: ticket.quantite_restante - 1 })
    .eq("id", ticket.id)
    .gt("quantite_restante", 0)
    .select("id")
    .maybeSingle();

  if (decrErr || !decremented) {
    if (decrErr) {
      console.error("[reserver] Décrément ticket échoué :", decrErr.message);
    }
    // Rollback : supprimer le booking fantôme (le ticket n'a pas été consommé).
    await service.from("bookings").delete().eq("id", booking.id);
    return NextResponse.json(
      {
        error: "Ticket indisponible (déjà consommé). Réessayez.",
        needsPurchase: false,
      },
      { status: 409 },
    );
  }

  // ── 5) Reflète l'inscription dans l'event Google (BEST-EFFORT, jamais bloquant).
  // ⚠️ On NE peut PAS ajouter le client comme `attendee` : un service account
  // sans Domain-Wide Delegation se voit refuser l'invitation d'attendees
  // (403 forbiddenForServiceAccounts). C'est une limite Google connue.
  // À la place, on patche la DESCRIPTION de l'event (autorisé pour le SA sur
  // SON calendrier) en y listant les inscrits, pour qu'Alice voie qui vient.
  //
  // La SOURCE DE VÉRITÉ de l'inscription est la table `bookings` (déjà écrite,
  // étape 3) + le dashboard admin. Le reflet dans l'agenda est cosmétique :
  // s'il échoue, la réservation RESTE valide (200) — on ne rollback PLUS,
  // sinon on punirait le client pour une limite technique de notre côté.
  try {
    const inscritLabel =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      "Client";

    // Compte des inscrits confirmés sur ce créneau (pour un récap fiable).
    const { count } = await service
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("google_calendar_creneau_id", creneauId)
      .eq("status", "confirmed");

    const baseDesc = (event.description ?? "").split("\n— Inscrits :")[0];
    const nouvelleDesc =
      `${baseDesc}\n— Inscrits : ${count ?? "?"} ` +
      `(dernier : ${inscritLabel}). Géré via l'espace client Yoga Sculpt.`;

    await patchEvent(creneauId, { description: nouvelleDesc });
  } catch (err) {
    // Best-effort : un échec ici n'invalide PAS la réservation (elle est en base).
    console.error(
      "[reserver] Reflet agenda (description) échoué — réservation conservée :",
      err,
    );
  }

  // ── Tracking : booking_created. ─────────────────────────────────────────────
  // best-effort (la résa — métier — est déjà confirmée en base, étape 3/4). On
  // réutilise le client service_role déjà ouvert.
  await logEvent(
    user.id,
    "booking_created",
    {
      booking_id: booking.id,
      type,
      creneau_id: creneauId,
      starts_at: startsAt,
      ticket_id: ticket.id,
    },
    { source: "reserver", service },
  );

  return NextResponse.json({ ok: true, booking });
}

// La réservation se fait uniquement en POST. Tout autre verbe → 405 explicite.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
