import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { getEvent, patchEvent } from "@/lib/google-calendar";
import type { Booking } from "@/lib/db-types";
import {
  bornEventToIso,
  deduireTypeDepuisEvent,
  retirerAttendee,
} from "@/lib/reservation";
import { moveBodySchema } from "../_logic";

/**
 * POST /api/admin/bookings/move — Alice déplace une réservation vers un AUTRE
 * créneau (event Google), depuis le back-office.
 *
 * Body : `{ bookingId, targetCreneauId }`.
 * Réponses :
 *   - 200 `{ ok: true, booking }`     : déplacement effectué.
 *   - 400 `{ error }`                 : body invalide.
 *   - 404 `{ error }`                 : booking ou créneau cible introuvable.
 *   - 409 `{ error }`                 : la cliente est déjà inscrite sur la cible
 *                                       (anti-double-booking) / déplacement no-op.
 *   - 422 `{ error }`                 : type de cours incompatible (collectif ↔
 *                                       particulier) ou booking non annulable.
 *   - 502 `{ error }`                 : Google Calendar indisponible.
 *   - (401/redirect géré par requireAdmin)
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ APPROCHE — fail-safe, anti-double-booking préservé.                       │
 * │   1. Charge le booking → 404 ; doit être 'confirmed' (sinon 422).         │
 * │   2. getEvent(cible) → 404/502. Déduit type + bornes de la cible.         │
 * │   3. TYPE : la cible doit avoir le même type que le booking (le ticket     │
 * │      consommé est de ce type) → 422 sinon.                                 │
 * │   4. Anti-double-booking : refuse si la cliente a déjà un booking confirmé  │
 * │      sur la cible (409). L'index unique partiel reste le backstop DB.      │
 * │   5. UPDATE booking → nouveaux event_id / creneau_id / starts_at / ends_at, │
 * │      AVEC garde status='confirmed' (anti-concurrence). Si le 23505 part     │
 * │      malgré la pré-vérif (course) → 409.                                    │
 * │   6. Google (best-effort) : retire la cliente de l'ANCIEN event. On ne      │
 * │      RÉ-AJOUTE PAS comme attendee sur le nouveau (un service account sans   │
 * │      Domain-Wide Delegation ne peut pas inviter — cf. /api/reserver). La    │
 * │      source de vérité reste la table `bookings`.                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — Cloudflare Workers (edge) : Supabase REST + Google Calendar REST.
 */

/** Code d'erreur Postgres pour violation de contrainte unique. */
const PG_UNIQUE_VIOLATION = "23505";

export async function POST(request: Request) {
  // ── Gate admin. ─────────────────────────────────────────────────────────────
  await requireAdmin();

  // ── Validation du corps (zod, strict). ──────────────────────────────────────
  let body: { bookingId: string; targetCreneauId: string };
  try {
    const json = await request.json();
    const result = moveBodySchema.safeParse(json);
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
    console.error("[admin/move] Lecture du booking échouée :", loadErr.message);
    return NextResponse.json(
      { error: "Impossible de charger la réservation." },
      { status: 500 },
    );
  }
  if (!bookingRow) {
    return NextResponse.json({ error: "Réservation introuvable." }, { status: 404 });
  }

  const booking = bookingRow as Booking;

  if (booking.status !== "confirmed") {
    return NextResponse.json(
      { error: "Seule une réservation confirmée peut être déplacée." },
      { status: 422 },
    );
  }

  // No-op : déplacer vers le même créneau ne change rien.
  if (booking.google_calendar_creneau_id === body.targetCreneauId) {
    return NextResponse.json(
      { error: "La réservation est déjà sur ce créneau." },
      { status: 409 },
    );
  }

  // ── 2) Récupère l'event Google cible → 404 / 502. ───────────────────────────
  let targetEvent;
  try {
    targetEvent = await getEvent(body.targetCreneauId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("HTTP 404") || message.includes("HTTP 410")) {
      return NextResponse.json({ error: "Créneau cible introuvable." }, { status: 404 });
    }
    console.error("[admin/move] Lecture de l'event cible échouée :", err);
    return NextResponse.json(
      { error: "Service de réservation indisponible." },
      { status: 502 },
    );
  }

  if (targetEvent.status === "cancelled") {
    return NextResponse.json(
      { error: "Le créneau cible n'est plus disponible." },
      { status: 404 },
    );
  }

  const targetType = deduireTypeDepuisEvent(targetEvent);
  const targetStartsAt = bornEventToIso(targetEvent.start);
  const targetEndsAt = bornEventToIso(targetEvent.end);
  if (!targetStartsAt || !targetEndsAt) {
    return NextResponse.json(
      { error: "Créneau cible aux dates invalides." },
      { status: 422 },
    );
  }

  // ── 3) Type : la cible doit matcher le type du booking (cohérence ticket). ──
  if (targetType !== booking.type) {
    return NextResponse.json(
      {
        error:
          "Le créneau cible n'est pas du même type que la réservation (collectif/particulier).",
      },
      { status: 422 },
    );
  }

  // ── 4) Anti-double-booking : la cliente est-elle déjà sur la cible ? ────────
  const { data: existant, error: existErr } = await service
    .from("bookings")
    .select("id")
    .eq("user_id", booking.user_id)
    .eq("google_calendar_creneau_id", body.targetCreneauId)
    .eq("status", "confirmed")
    .maybeSingle();

  if (existErr) {
    console.error("[admin/move] Pré-vérif anti-double-booking échouée :", existErr.message);
    return NextResponse.json(
      { error: "Impossible de vérifier le créneau cible." },
      { status: 500 },
    );
  }
  if (existant) {
    return NextResponse.json(
      { error: "Cette cliente est déjà inscrite sur le créneau cible." },
      { status: 409 },
    );
  }

  // ── 5) UPDATE booking → nouveau créneau (garde status='confirmed'). ─────────
  const { data: moved, error: updateErr } = await service
    .from("bookings")
    .update({
      google_event_id: body.targetCreneauId,
      google_calendar_creneau_id: body.targetCreneauId,
      starts_at: targetStartsAt,
      ends_at: targetEndsAt,
    })
    .eq("id", booking.id)
    .eq("status", "confirmed")
    .select("*")
    .maybeSingle();

  if (updateErr) {
    // Backstop : l'index unique partiel rejette une course gagnée par un autre
    // appel (la cliente vient d'être inscrite sur la cible entre-temps) → 409.
    if (updateErr.code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: "Cette cliente est déjà inscrite sur le créneau cible." },
        { status: 409 },
      );
    }
    console.error("[admin/move] Update booking échoué :", updateErr.message);
    return NextResponse.json({ error: "Déplacement impossible." }, { status: 500 });
  }
  if (!moved) {
    // 0 ligne touchée : le booking n'était plus 'confirmed' (annulé/déplacé en
    // concurrence). Idempotent côté métier → 409 pour signaler à l'admin.
    return NextResponse.json(
      { error: "La réservation a changé entre-temps. Rechargez la page." },
      { status: 409 },
    );
  }

  // ── 6) Google (best-effort) : retire la cliente de l'ANCIEN event. ──────────
  if (booking.google_event_id && booking.google_event_id !== body.targetCreneauId) {
    try {
      const { data: profilRow } = await service
        .from("profiles")
        .select("email")
        .eq("id", booking.user_id)
        .maybeSingle();
      const clientEmail = (profilRow as { email?: string | null } | null)?.email;
      if (clientEmail) {
        const oldEvent = await getEvent(booking.google_event_id);
        const attendees = retirerAttendee(oldEvent.attendees, clientEmail);
        await patchEvent(booking.google_event_id, { attendees });
      }
    } catch (err) {
      // Le déplacement métier (étape 5) a réussi : on n'échoue pas pour un effet
      // de bord Google. Log pour réconciliation manuelle.
      console.error(
        "[admin/move] Retrait attendee de l'ancien event échoué (déplacement maintenu) :",
        err,
      );
    }
  }

  return NextResponse.json({ ok: true, booking: moved as Booking });
}

// Le déplacement se fait uniquement en POST.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
