import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getEvent,
  patchEvent,
  insertEvent,
  freeBusyQuery,
} from "@/lib/google-calendar";
import { logEvent } from "@/lib/events";
import { notifierAlice, resoudreTelClient } from "@/lib/notify-alice";
import {
  getUserGclid,
  recordAdsConversion,
  FREE_TICKET_VALUE_EUR,
} from "@/lib/ads-attribution";
import type { Booking, Ticket, TicketType } from "@/lib/db-types";
import {
  bornEventToIso,
  deduireTypeDepuisEvent,
  validerSlotParticulier,
  chevauche,
  TZ_AFFICHAGE,
} from "@/lib/reservation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("reserver");

/**
 * POST /api/reserver — réserve un cours contre un ticket. DEUX modes :
 *
 *   A) COLLECTIF (créneau pré-posé par Alice) — body `{ creneauId }` :
 *      on inscrit le user sur l'event Google EXISTANT (inchangé, cf. flux d'origine).
 *
 *   B) PARTICULIER (créneau LIBRE 9h-21h) — body `{ type:"particulier", startsAt }` :
 *      le client a choisi une date+heure libre ; on CRÉE l'event dans l'agenda
 *      d'Alice puis on enregistre le booking. Anti-chevauchement à deux niveaux :
 *        - re-check freebusy à l'instant T (le slot vu par le client peut être périmé) ;
 *        - INDEX UNIQUE PARTIEL sur (starts_at) where type='particulier' & confirmed
 *          (migration 0009) → deux clients sur le même horaire : le 2e tombe en 409.
 *
 * Réponses :
 *   - 200 `{ ok: true, booking }`
 *   - 400 `{ error }`                     : body invalide / slot hors plage.
 *   - 401 `{ error }`                     : non authentifié.
 *   - 402 `{ error, needsPurchase, type }`: aucun ticket du bon type.
 *   - 404 `{ error }`                     : créneau collectif inexistant côté Google.
 *   - 409 `{ error }`                     : déjà réservé / horaire pris / course ticket.
 *   - 422 `{ error }`                     : créneau aux dates invalides.
 *   - 502 `{ error }`                     : échec Google Calendar.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ORDRE FAIL-SAFE (mode A, inchangé) :                                      │
 * │   1. getEvent → 404 si absent. Déduit le type.                            │
 * │   2. Sélectionne le ticket FIFO du bon type ; aucun → 402.               │
 * │   3. INSERT booking confirmed (verrou anti-double via index unique).      │
 * │   4. Décrément ticket (garde quantite_restante>0) ; 0 ligne → rollback+409.│
 * │   5. PATCH description de l'event (best-effort, cosmétique).              │
 * │                                                                           │
 * │ ORDRE FAIL-SAFE (mode B, particulier libre) :                            │
 * │   1. Valide le slot (heure pleine 9h-21h Paris, délai 24h) → 400 sinon.   │
 * │   2. Re-check freebusy : si Alice occupée sur ce créneau → 409.           │
 * │   3. Sélectionne le ticket particulier FIFO ; aucun → 402.               │
 * │   4. INSERT booking confirmed AVEC starts_at (verrou unique horaire).      │
 * │      0 doublon : un 2e client sur le même horaire → 23505 → 409.          │
 * │   5. Décrément ticket (garde) ; 0 ligne → rollback booking + 409.         │
 * │   6. CRÉE l'event Google ; échec → rollback (recrédit + delete) + 502.    │
 * │      On stocke ensuite l'id Google dans le booking (best-effort).         │
 * │                                                                           │
 * │ Dans les deux modes, on notifie Alice (best-effort) une fois confirmé.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Code d'erreur Postgres pour violation de contrainte unique. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Corps attendu — discriminé :
 *   - `{ creneauId }`                      → mode A (collectif/existant) ;
 *   - `{ type:"particulier", startsAt }`   → mode B (créneau libre).
 * Rejet strict de tout champ inconnu.
 */
const bodySchema = z.union([
  z.object({ creneauId: z.string().min(1, "creneauId requis.") }).strict(),
  z
    .object({
      type: z.literal("particulier"),
      startsAt: z.string().min(1, "startsAt requis."),
    })
    .strict(),
]);

/** Libellé d'affichage du client (pour la notif Alice et le reflet agenda). */
function labelClient(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): string {
  return (
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ??
    "Client"
  );
}

/** Téléphone éventuel du user (Supabase le range dans user_metadata.phone). */
function telClient(user: {
  phone?: string;
  user_metadata?: Record<string, unknown>;
}): string | null {
  return (
    user.phone ||
    (user.user_metadata?.phone as string | undefined) ||
    (user.user_metadata?.telephone as string | undefined) ||
    null
  );
}

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

  // ── Validation du corps (zod, union discriminée). ───────────────────────────
  let body: z.infer<typeof bodySchema>;
  try {
    const json = await request.json();
    const result = bodySchema.safeParse(json);
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

  // ── Aiguillage : mode B (particulier libre) si `startsAt` fourni. ───────────
  if ("startsAt" in body) {
    return reserverParticulierLibre(body.startsAt, user, service);
  }

  // ════════════════════════════════════════════════════════════════════════
  // MODE A — collectif / créneau pré-posé (flux d'origine, inchangé)
  // ════════════════════════════════════════════════════════════════════════
  const creneauId = body.creneauId;

  // ── 1) Récupère l'event Google → 404 si absent / annulé. ────────────────────
  let event;
  try {
    event = await getEvent(creneauId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("HTTP 404") || message.includes("HTTP 410")) {
      return NextResponse.json(
        { error: "Créneau introuvable." },
        { status: 404 },
      );
    }
    log.error("Lecture de l'event Google échouée", {
      creneau_id: creneauId,
      user_id: user.id,
      err: serializeError(err),
    });
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

  // ── 2) Sélectionne le ticket valide le plus ancien (FIFO) du bon type. ──────
  const sel = await selectionnerTicket(service, user.id, type);
  if ("error" in sel) {
    return NextResponse.json(
      { error: "Impossible de vérifier vos tickets." },
      { status: 500 },
    );
  }
  const ticket = sel.ticket;
  if (!ticket) {
    return NextResponse.json(
      { error: "Aucun ticket disponible", needsPurchase: true, type },
      { status: 402 },
    );
  }

  // ── 3) INSERT booking AVANT de décrémenter → pose le verrou anti-double. ─────
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
    log.error("Insert booking échoué", {
      creneau_id: creneauId,
      user_id: user.id,
      db: insertErr.message,
    });
    return NextResponse.json({ error: "Réservation impossible." }, { status: 500 });
  }

  const booking = inserted as Booking;

  // ── 4) Décrémente le ticket (clause de garde contre la course). ─────────────
  const decremente = await decrementerTicket(service, ticket);
  if (!decremente) {
    await service.from("bookings").delete().eq("id", booking.id);
    return NextResponse.json(
      { error: "Ticket indisponible (déjà consommé). Réessayez.", needsPurchase: false },
      { status: 409 },
    );
  }

  // ── 5) Reflète l'inscription dans la description de l'event (best-effort). ──
  try {
    const inscritLabel = labelClient(user);
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
    log.error("Reflet agenda (description) échoué — réservation conservée", {
      booking_id: booking.id,
      creneau_id: creneauId,
      err: serializeError(err),
    });
  }

  // ── Notif Alice (best-effort) + tracking. ───────────────────────────────────
  // Le tel vient de l'auth si présent, sinon de profiles.phone (collecté au
  // paiement Stripe). Indispensable pour qu'Alice puisse rappeler la cliente.
  await notifierAlice("reservation", {
    type,
    startsAt,
    endsAt,
    clientNom: labelClient(user),
    clientEmail: user.email ?? null,
    clientTel: await resoudreTelClient(service, user.id, telClient(user)),
  });

  await logEvent(
    user.id,
    "booking_created",
    { booking_id: booking.id, type, creneau_id: creneauId, starts_at: startsAt, ticket_id: ticket.id },
    { source: "reserver", service },
  );

  await attribuerTicketGratuitConsomme(service, user.id, ticket, booking.id);

  return NextResponse.json({ ok: true, booking });
}

// ════════════════════════════════════════════════════════════════════════════
// MODE B — cours PARTICULIER en créneau LIBRE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Réserve un cours particulier sur un créneau libre choisi par le client.
 * Crée l'event dans l'agenda d'Alice + consomme 1 ticket particulier, avec
 * anti-chevauchement (re-check freebusy + index unique sur starts_at).
 */
async function reserverParticulierLibre(
  startsAtBrut: string,
  user: {
    id: string;
    email?: string;
    phone?: string;
    user_metadata?: Record<string, unknown>;
  },
  service: SupabaseClient,
): Promise<NextResponse> {
  const type: TicketType = "particulier";

  // ── 1) Valide le slot (heure pleine 9h-21h Paris, délai 24h). ───────────────
  const slot = validerSlotParticulier(startsAtBrut);
  if (!slot.ok) {
    return NextResponse.json({ error: slot.raison }, { status: 400 });
  }
  const startsAt = slot.debut;
  const endsAt = slot.fin;

  // ── 2) Re-check freebusy : Alice est-elle libre MAINTENANT sur ce créneau ? ─
  // Le slot vu par le client peut être périmé (busy ajouté entre-temps). On
  // re-vérifie à l'instant T sur la fenêtre exacte du créneau.
  try {
    const busy = await freeBusyQuery(startsAt, endsAt);
    const debutMs = new Date(startsAt).getTime();
    const finMs = new Date(endsAt).getTime();
    const occupe = busy.some((b) =>
      chevauche(debutMs, finMs, new Date(b.start).getTime(), new Date(b.end).getTime()),
    );
    if (occupe) {
      return NextResponse.json(
        { error: "Ce créneau n'est plus disponible." },
        { status: 409 },
      );
    }
  } catch (err) {
    log.error("freebusy (particulier) échoué", {
      user_id: user.id,
      starts_at: startsAt,
      err: serializeError(err),
    });
    return NextResponse.json(
      { error: "Service de réservation indisponible." },
      { status: 502 },
    );
  }

  // ── 3) Sélectionne le ticket particulier FIFO ; aucun → 402. ────────────────
  const sel = await selectionnerTicket(service, user.id, type);
  if ("error" in sel) {
    return NextResponse.json(
      { error: "Impossible de vérifier vos tickets." },
      { status: 500 },
    );
  }
  const ticket = sel.ticket;
  if (!ticket) {
    return NextResponse.json(
      { error: "Aucun ticket disponible", needsPurchase: true, type },
      { status: 402 },
    );
  }

  // ── 4) INSERT booking AVANT toute écriture Google → pose le verrou horaire. ─
  // google_event_id temporaire (placeholder) : l'event Google n'existe pas
  // encore. NOT NULL en base → on met un marqueur, remplacé à l'étape 6.
  // L'index unique partiel sur (starts_at) where type='particulier' & confirmed
  // (migration 0009) rejette tout 2e booking au même horaire (23505 → 409).
  const placeholder = `pending-${user.id}-${startsAt}`;
  const { data: inserted, error: insertErr } = await service
    .from("bookings")
    .insert({
      user_id: user.id,
      type,
      google_event_id: placeholder,
      google_calendar_creneau_id: null, // créneau libre : pas de créneau source
      starts_at: startsAt,
      ends_at: endsAt,
      status: "confirmed",
      ticket_id: ticket.id,
    })
    .select("*")
    .single();

  if (insertErr) {
    if (insertErr.code === PG_UNIQUE_VIOLATION) {
      // Horaire déjà pris (autre client) OU déjà réservé par ce user.
      return NextResponse.json(
        { error: "Ce créneau n'est plus disponible." },
        { status: 409 },
      );
    }
    log.error("Insert booking (particulier) échoué", {
      user_id: user.id,
      starts_at: startsAt,
      db: insertErr.message,
    });
    return NextResponse.json({ error: "Réservation impossible." }, { status: 500 });
  }

  const booking = inserted as Booking;

  // ── 5) Décrémente le ticket (garde) ; 0 ligne → rollback booking + 409. ─────
  const decremente = await decrementerTicket(service, ticket);
  if (!decremente) {
    await service.from("bookings").delete().eq("id", booking.id);
    return NextResponse.json(
      { error: "Ticket indisponible (déjà consommé). Réessayez.", needsPurchase: false },
      { status: 409 },
    );
  }

  // ── 6) CRÉE l'event dans l'agenda d'Alice. Échec → rollback complet. ────────
  const clientLabel = labelClient(user);
  let googleEventId: string;
  try {
    const created = await insertEvent({
      summary: `Cours particulier — ${clientLabel}`,
      description:
        `Cours particulier réservé via l'espace client Yoga Sculpt.\n` +
        `Client : ${clientLabel}` +
        (user.email ? ` (${user.email})` : "") +
        (telClient(user) ? `\nTél : ${telClient(user)}` : ""),
      start: { dateTime: startsAt, timeZone: TZ_AFFICHAGE },
      end: { dateTime: endsAt, timeZone: TZ_AFFICHAGE },
    });
    if (!created.id) throw new Error("event créé sans id");
    googleEventId = created.id;
  } catch (err) {
    log.error("Création event Google (particulier) échouée — rollback", {
      booking_id: booking.id,
      ticket_id: ticket.id,
      err: serializeError(err),
    });
    // Rollback : on recrédite le ticket (qu'on a décrémenté à l'étape 5) puis on
    // supprime le booking (pas de fantôme). Recrédit en lecture-fraîche + min
    // (même pattern que /api/annuler) pour ne pas clobberer une écriture
    // concurrente ni dépasser le plafond quantite_initiale.
    await recrediterTicket(service, ticket.id);
    await service.from("bookings").delete().eq("id", booking.id);
    return NextResponse.json(
      { error: "Service de réservation indisponible. Réessayez." },
      { status: 502 },
    );
  }

  // ── 6 bis) Persiste l'id Google dans le booking (best-effort). ──────────────
  // L'event existe ; si ce PATCH DB rate, le booking garde le placeholder mais
  // la résa reste valide (l'annulation retrouvera l'event par recherche, et la
  // source de vérité reste la table). On le tente quand même.
  const { error: linkErr } = await service
    .from("bookings")
    .update({ google_event_id: googleEventId })
    .eq("id", booking.id);
  if (linkErr) {
    log.error("Lien booking↔event Google échoué (résa conservée)", {
      booking_id: booking.id,
      google_event_id: googleEventId,
      db: linkErr.message,
    });
  } else {
    booking.google_event_id = googleEventId;
  }

  // ── Notif Alice (best-effort) + tracking. ───────────────────────────────────
  // Tel : auth si présent, sinon profiles.phone (collecté au paiement Stripe).
  await notifierAlice("reservation", {
    type,
    startsAt,
    endsAt,
    clientNom: clientLabel,
    clientEmail: user.email ?? null,
    clientTel: await resoudreTelClient(service, user.id, telClient(user)),
  });

  await logEvent(
    user.id,
    "booking_created",
    { booking_id: booking.id, type, creneau_id: googleEventId, starts_at: startsAt, ticket_id: ticket.id },
    { source: "reserver", service },
  );

  await attribuerTicketGratuitConsomme(service, user.id, ticket, booking.id);

  return NextResponse.json({ ok: true, booking });
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers partagés (modes A & B)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sélectionne le ticket valide le plus ancien (FIFO) du `type` voulu pour le
 * user : quantite_restante>0, non expiré.
 *
 * @returns `{ ticket }` (peut être null = aucun ticket dispo → 402) ou
 *          `{ error: true }` sur ERREUR DB (→ 500 : on ne dit PAS « rachetez un
 *          ticket » à un client qui en a peut-être un, sur un simple blip DB).
 */
/**
 * ATTRIBUTION ADS — TICKET GRATUIT CONSOMMÉ.
 * Si la résa consomme un ticket GRATUIT (welcome/referral), on enregistre une
 * conversion ~10€ (≈ valeur d'une séance) attribuée au gclid du user. On ne compte
 * PAS les tickets `paid` ici (déjà comptés comme `purchase` au webhook Stripe) ni
 * `admin`. Idempotent sur booking_id (une résa = une conversion). Best-effort.
 */
async function attribuerTicketGratuitConsomme(
  service: SupabaseClient,
  userId: string,
  ticket: Ticket,
  bookingId: string,
): Promise<void> {
  if (ticket.source !== "welcome" && ticket.source !== "referral") return;
  const gclid = await getUserGclid(service, userId);
  await recordAdsConversion(service, {
    userId,
    kind: "free_ticket_used",
    sourceRef: bookingId,
    gclid,
    valueEur: FREE_TICKET_VALUE_EUR,
  });
}

async function selectionnerTicket(
  service: SupabaseClient,
  userId: string,
  type: TicketType,
): Promise<{ ticket: Ticket | null } | { error: true }> {
  const nowIso = new Date().toISOString();
  const { data: tickets, error } = await service
    .from("tickets")
    .select("*")
    .eq("user_id", userId)
    .eq("type", type)
    .gt("quantite_restante", 0)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    log.error("Lecture des tickets échouée", {
      user_id: userId,
      type,
      db: error.message,
    });
    return { error: true };
  }
  return { ticket: (tickets?.[0] as Ticket | undefined) ?? null };
}

/**
 * Décrémente le ticket d'une unité avec garde anti-course (quantite_restante>0).
 * @returns `true` si une ligne a bien été décrémentée, `false` sinon (course perdue).
 */
async function decrementerTicket(
  service: SupabaseClient,
  ticket: Ticket,
): Promise<boolean> {
  const { data, error } = await service
    .from("tickets")
    .update({ quantite_restante: ticket.quantite_restante - 1 })
    .eq("id", ticket.id)
    .gt("quantite_restante", 0)
    .select("id")
    .maybeSingle();
  if (error) {
    log.error("Décrément ticket échoué", {
      ticket_id: ticket.id,
      db: error.message,
    });
    return false;
  }
  return Boolean(data);
}

/**
 * Recrédite (+1) un ticket, en lecture fraîche + plafond `quantite_initiale`.
 * Sert au rollback du mode B quand la création de l'event Google échoue APRÈS le
 * décrément. Best-effort (on log mais on n'échoue pas le rollback lui-même).
 */
async function recrediterTicket(
  service: SupabaseClient,
  ticketId: string,
): Promise<void> {
  const { data: row, error: loadErr } = await service
    .from("tickets")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();
  if (loadErr || !row) {
    if (loadErr)
      log.error("Recrédit (lecture) échoué", {
        ticket_id: ticketId,
        db: loadErr.message,
      });
    return;
  }
  const t = row as Ticket;
  const recredite = Math.min(t.quantite_restante + 1, t.quantite_initiale);
  const { error: updErr } = await service
    .from("tickets")
    .update({ quantite_restante: recredite })
    .eq("id", ticketId);
  if (updErr)
    log.error("Recrédit (update) échoué", {
      ticket_id: ticketId,
      db: updErr.message,
    });
}

// La réservation se fait uniquement en POST. Tout autre verbe → 405 explicite.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
