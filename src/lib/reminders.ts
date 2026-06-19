/**
 * Rappels mail automatiques des cours réservés — J-1 (24h avant) et H-2 (2h
 * avant). Déclenché par le Cloudflare Cron Trigger (toutes les 15 min, cf.
 * `wrangler.jsonc`) qui tape la route HTTP `/api/cron/reminders`.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ IDEMPOTENCE — chaque rappel n'est envoyé QU'UNE FOIS.                      │
 * │   Deux colonnes sur `bookings` (`reminder_j1_sent_at`, `reminder_h2_sent_at`,
 * │   migration 0003) horodatent l'envoi. Le scan filtre sur `... IS NULL` et  │
 * │   pose `now()` juste APRÈS l'envoi réussi. Un cron qui repasse 15 min plus │
 * │   tard ne reverra donc pas un rappel déjà parti.                           │
 * │                                                                            │
 * │   La fenêtre de scan (±15 min autour de l'instant cible) est calquée sur  │
 * │   la cadence du cron : avec un tick toutes les 15 min, toute résa dont le  │
 * │   `starts_at` franchit T-24h ou T-2h tombe dans exactement une fenêtre.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ FUSEAU — le Worker tourne en UTC. Les comparaisons de fenêtre se font en  │
 * │   UTC (timestamptz côté Postgres → comparaison absolue, fuseau-agnostique).│
 * │   Le fuseau `Europe/Paris` n'intervient QUE pour l'affichage des dates    │
 * │   dans le corps de l'email (Intl.DateTimeFormat avec timeZone forcé).     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). `fetch` (Brevo + PostgREST Supabase),│
 * │   Web standard only. Écriture via le client service_role (bypass RLS :    │
 * │   pas de session cookie dans un cron machine-to-machine).                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { createServiceClient } from "@/lib/supabase/service";
import { sendTransactionalEmail } from "@/lib/brevo";
import {
  renderEmail,
  textFromBlocks,
  escapeHtml,
  COULEURS,
} from "@/lib/email-templates";
import type { TicketType } from "@/lib/db-types";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("reminders");

// ============================================================================
// Constantes
// ============================================================================

/** Fuseau d'affichage : Alice et ses clientes sont à Lyon. */
const TZ = "Europe/Paris";

/** URL de l'espace client (page des réservations). */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.yoga-sculpt.fr";

/** Demi-largeur de la fenêtre de scan, en millisecondes (±15 min). */
const FENETRE_MS = 15 * 60 * 1000;

/** Décalages cibles depuis maintenant, en millisecondes. */
const J1_MS = 24 * 60 * 60 * 1000; // 24h
const H2_MS = 2 * 60 * 60 * 1000; //  2h

/** Type d'un rappel à envoyer (sert à factoriser le traitement J-1 / H-2). */
type KindRappel = "j1" | "h2";

// ============================================================================
// Formatage des dates (FR, fuseau Paris) — purs
// ============================================================================

const fmtDateLongue = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});

const fmtHeure = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

/** "Mardi 23 juin" (initiale capitalisée). */
function dateLongueFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const brut = fmtDateLongue.format(d);
  return brut.charAt(0).toUpperCase() + brut.slice(1);
}

/** "19h00". */
function heureFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return fmtHeure.format(d).replace(":", "h");
}

/** Libellé humain du type de cours. */
function libelleType(type: TicketType): string {
  return type === "collectif" ? "Cours collectif" : "Cours particulier";
}

// ============================================================================
// Templates email (charte NOIR & OR)
// ============================================================================

/**
 * Données nécessaires pour composer un rappel (un booking + le client).
 */
interface ContexteRappel {
  prenom: string | null;
  type: TicketType;
  startsAt: string;
  endsAt: string;
}

/** Sujet selon le type de rappel. */
function sujetRappel(kind: KindRappel): string {
  return kind === "j1"
    ? "Votre cours de demain — Yoga Sculpt"
    : "C'est dans 2h ! On vous attend — Yoga Sculpt";
}

/** URL de la page « mes réservations » (CTA + footer). */
const URL_RESERVATIONS = `${APP_URL}/espace/reservations`;

/** Salutation personnalisée (texte brut) si le prénom est connu. */
function salutation(prenom: string | null): string {
  return prenom ? `Bonjour ${prenom},` : "Bonjour,";
}

/** Salutation pour le HTML : prénom échappé (provient du profil utilisateur). */
function salutationHtml(prenom: string | null): string {
  return prenom ? `Bonjour ${escapeHtml(prenom)},` : "Bonjour,";
}

/**
 * Bloc HTML « carte » récapitulant le cours (type / date / heure / lieu).
 * Styles inline, palette factorisée. Le prénom n'apparaît pas ici → pas de
 * valeur dynamique non maîtrisée à échapper (type, dates et lieu sont
 * contrôlés en interne).
 */
function carteCoursHtml(ctx: ContexteRappel): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid ${COULEURS.border};border-radius:4px;background:${COULEURS.ink};">
    <tr><td style="padding:16px 18px;">
      <div style="font-family:'Anton','Arial Narrow',Helvetica,Arial,sans-serif;font-size:18px;color:${COULEURS.gold};text-transform:uppercase;letter-spacing:1px;">${libelleType(ctx.type)}</div>
      <div style="margin-top:8px;font-size:16px;color:${COULEURS.paper};"><strong>${dateLongueFr(ctx.startsAt)}</strong></div>
      <div style="margin-top:2px;font-size:15px;color:${COULEURS.paper};">${heureFr(ctx.startsAt)} — ${heureFr(ctx.endsAt)}</div>
      <div style="margin-top:8px;font-size:14px;color:${COULEURS.muted};">Lyon</div>
    </td></tr>
  </table>`;
}

/** Construit le HTML + texte d'un rappel J-1, via le layout factorisé. */
function templateJ1(ctx: ContexteRappel): { html: string; text: string } {
  const salut = salutation(ctx.prenom);
  const corpsHtml = `
    <p style="margin:0 0 12px;">${salutationHtml(ctx.prenom)}</p>
    <p style="margin:0 0 4px;">Petit rappel : vous avez un cours <strong>demain</strong>.</p>
    ${carteCoursHtml(ctx)}
    <p style="margin:0 0 4px;">Pensez à prévoir une tenue confortable et une bouteille d'eau.</p>
    <p style="margin:16px 0 0;font-size:13px;color:${COULEURS.muted};">À demain !</p>
  `;
  const { html } = renderEmail({
    preheader: "Votre cours de Yoga Sculpt, c'est demain.",
    titre: "Votre cours de demain",
    corpsHtml,
    cta: { label: "Voir ma réservation", url: URL_RESERVATIONS },
    footerNote:
      "Vous recevez cet email car vous avez réservé un cours sur votre espace client.",
  });

  const text = textFromBlocks([
    salut,
    "",
    "Petit rappel : vous avez un cours demain.",
    "",
    `${libelleType(ctx.type)}`,
    `${dateLongueFr(ctx.startsAt)}`,
    `${heureFr(ctx.startsAt)} — ${heureFr(ctx.endsAt)}`,
    "Lieu : Lyon",
    "",
    "Pensez à prévoir une tenue confortable et une bouteille d'eau.",
    "",
    `Voir ma réservation : ${URL_RESERVATIONS}`,
    "",
    "À demain !",
    "",
    "—",
    "Yoga Sculpt — Lyon",
    "Vous recevez cet email car vous avez réservé un cours sur votre espace client.",
  ]);

  return { html, text };
}

/** Construit le HTML + texte d'un rappel H-2, via le layout factorisé. */
function templateH2(ctx: ContexteRappel): { html: string; text: string } {
  const salut = salutation(ctx.prenom);
  const corpsHtml = `
    <p style="margin:0 0 12px;">${salutationHtml(ctx.prenom)}</p>
    <p style="margin:0 0 4px;">C'est bientôt l'heure — votre cours commence <strong>dans 2 heures</strong>. On vous attend !</p>
    ${carteCoursHtml(ctx)}
  `;
  const { html } = renderEmail({
    preheader: "C'est dans 2h ! On vous attend.",
    titre: "C'est dans 2h !",
    corpsHtml,
    cta: { label: "Voir ma réservation", url: URL_RESERVATIONS },
    footerNote:
      "Vous recevez cet email car vous avez réservé un cours sur votre espace client.",
  });

  const text = textFromBlocks([
    salut,
    "",
    "C'est bientôt l'heure — votre cours commence dans 2 heures. On vous attend !",
    "",
    `${libelleType(ctx.type)}`,
    `${dateLongueFr(ctx.startsAt)}`,
    `${heureFr(ctx.startsAt)} — ${heureFr(ctx.endsAt)}`,
    "Lieu : Lyon",
    "",
    `Voir ma réservation : ${URL_RESERVATIONS}`,
    "",
    "—",
    "Yoga Sculpt — Lyon",
  ]);

  return { html, text };
}

// ============================================================================
// Scan + envoi
// ============================================================================

/** Booking minimal récupéré pour le scan (colonnes utiles uniquement). */
interface BookingRappel {
  id: string;
  user_id: string;
  type: TicketType;
  starts_at: string;
  ends_at: string;
}

/** Résultat agrégé d'un passage du cron (pour le log / la réponse HTTP). */
export interface ResultatRappels {
  j1Envoyes: number;
  h2Envoyes: number;
  erreurs: number;
}

/**
 * Charge un map `user_id → { email, full_name }` pour les bookings donnés.
 *
 * NB : on NE peut PAS joindre `bookings → profiles` en un seul appel PostgREST :
 * `bookings.user_id` et `profiles.id` référencent tous deux `auth.users(id)`,
 * mais il n'existe pas de FK DIRECTE entre les deux tables — PostgREST ne sait
 * donc pas faire l'embed automatique. On fait donc une 2ᵉ requête `id IN (...)`.
 */
async function chargerProfils(
  service: ReturnType<typeof createServiceClient>,
  userIds: string[],
): Promise<Map<string, { email: string | null; full_name: string | null }>> {
  const map = new Map<
    string,
    { email: string | null; full_name: string | null }
  >();
  if (userIds.length === 0) return map;

  const { data, error } = await service
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  if (error) {
    log.error("Chargement des profils échoué", { db: error.message });
    return map;
  }

  for (const p of data ?? []) {
    map.set(p.id, { email: p.email, full_name: p.full_name });
  }
  return map;
}

/** Prénom à partir du `full_name` ("Alice Gaudry" → "Alice"). */
function prenomDepuis(fullName: string | null): string | null {
  if (!fullName) return null;
  const prenom = fullName.trim().split(/\s+/)[0];
  return prenom || null;
}

/**
 * Traite un type de rappel (J-1 ou H-2) : scanne les bookings dont `starts_at`
 * tombe dans la fenêtre cible et dont le rappel n'a pas encore été envoyé,
 * envoie l'email, puis horodate la colonne correspondante (idempotence).
 *
 * @returns { envoyes, erreurs }
 */
async function traiterRappels(
  service: ReturnType<typeof createServiceClient>,
  kind: KindRappel,
  now: number,
): Promise<{ envoyes: number; erreurs: number }> {
  const decalage = kind === "j1" ? J1_MS : H2_MS;
  const colonne = kind === "j1" ? "reminder_j1_sent_at" : "reminder_h2_sent_at";

  // Fenêtre [cible-15min, cible+15min] exprimée en ISO (UTC) pour PostgREST.
  const cible = now + decalage;
  const debut = new Date(cible - FENETRE_MS).toISOString();
  const fin = new Date(cible + FENETRE_MS).toISOString();

  // Sélection : résas CONFIRMÉES, dans la fenêtre, rappel pas encore parti.
  const { data, error } = await service
    .from("bookings")
    .select("id, user_id, type, starts_at, ends_at")
    .eq("status", "confirmed")
    .gte("starts_at", debut)
    .lte("starts_at", fin)
    .is(colonne, null);

  if (error) {
    log.error("Scan échoué", { kind, db: error.message });
    return { envoyes: 0, erreurs: 1 };
  }

  const bookings = (data ?? []) as BookingRappel[];
  if (bookings.length === 0) return { envoyes: 0, erreurs: 0 };

  // Profils (email + nom) pour tous les users concernés.
  const userIds = [...new Set(bookings.map((b) => b.user_id))];
  const profils = await chargerProfils(service, userIds);

  let envoyes = 0;
  let erreurs = 0;

  for (const booking of bookings) {
    const profil = profils.get(booking.user_id);
    const email = profil?.email;

    if (!email) {
      // Pas d'email exploitable : on log et on passe (on N'horodate PAS, ainsi
      // un profil complété entre-temps pourra encore recevoir le rappel tant
      // qu'on est dans la fenêtre).
      log.error("aucun email pour le user — ignoré", {
        kind,
        user_id: booking.user_id,
        booking_id: booking.id,
      });
      continue;
    }

    const ctx: ContexteRappel = {
      prenom: prenomDepuis(profil?.full_name ?? null),
      type: booking.type,
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
    };
    const { html, text } =
      kind === "j1" ? templateJ1(ctx) : templateH2(ctx);

    try {
      await sendTransactionalEmail({
        to: email,
        toName: profil?.full_name ?? undefined,
        subject: sujetRappel(kind),
        htmlContent: html,
        textContent: text,
      });
    } catch (err) {
      // Échec d'envoi : on log et on continue le batch. On N'horodate PAS →
      // le prochain tick (dans 15 min) retentera tant que la résa est encore
      // dans la fenêtre. (Au-delà de la fenêtre, le rappel est définitivement
      // raté — acceptable, c'est un rappel, pas une transaction critique.)
      log.error("envoi échoué", {
        kind,
        booking_id: booking.id,
        err: serializeError(err),
      });
      erreurs += 1;
      continue;
    }

    // Horodatage APRÈS envoi réussi → idempotence : ce rappel ne repartira plus.
    const { error: updErr } = await service
      .from("bookings")
      .update({ [colonne]: new Date().toISOString() })
      .eq("id", booking.id);

    if (updErr) {
      // L'email est parti mais l'horodatage a échoué : risque de doublon au
      // prochain tick. On le signale explicitement (rare, mais traçable).
      log.error("email envoyé mais horodatage échoué (risque de doublon)", {
        kind,
        colonne,
        booking_id: booking.id,
        db: updErr.message,
      });
      erreurs += 1;
    }

    envoyes += 1;
  }

  return { envoyes, erreurs };
}

/**
 * Point d'entrée appelé par la route cron : envoie les rappels J-1 et H-2 dus.
 * Idempotent (cf. en-tête de module). Ne lève jamais : agrège les erreurs et
 * les renvoie pour log / réponse HTTP.
 */
export async function scanAndSendReminders(): Promise<ResultatRappels> {
  const service = createServiceClient();
  const now = Date.now();

  const j1 = await traiterRappels(service, "j1", now);
  const h2 = await traiterRappels(service, "h2", now);

  const resultat: ResultatRappels = {
    j1Envoyes: j1.envoyes,
    h2Envoyes: h2.envoyes,
    erreurs: j1.erreurs + h2.erreurs,
  };

  log.info("Passage terminé", {
    j1: resultat.j1Envoyes,
    h2: resultat.h2Envoyes,
    erreurs: resultat.erreurs,
  });

  return resultat;
}
