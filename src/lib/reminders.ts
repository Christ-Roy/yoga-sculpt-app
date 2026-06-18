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
import type { TicketType } from "@/lib/db-types";

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

/**
 * Coque HTML commune (charte NOIR & OR, titres Anton via Google Fonts).
 * Inline styles : obligatoire en email (pas de <style> fiable selon les clients).
 */
function coqueHtml(titre: string, corps: string): string {
  const ink = "#0E0E0E";
  const gold = "#D4AD6A";
  const paper = "#F2F0EC";
  const border = "#2A2A2A";
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre}</title>
</head>
<body style="margin:0;padding:0;background:${ink};color:${paper};font-family:'Inter',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ink};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141414;border:1px solid ${border};border-radius:4px;">
        <!-- En-tête / monogramme -->
        <tr><td align="center" style="padding:28px 32px 8px;">
          <div style="font-family:'Anton','Arial Narrow',sans-serif;font-size:28px;letter-spacing:2px;color:${gold};text-transform:uppercase;">YOGA&nbsp;SCULPT</div>
        </td></tr>
        <!-- Titre -->
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0;font-family:'Anton','Arial Narrow',sans-serif;font-weight:400;font-size:24px;line-height:1.2;color:${paper};text-transform:uppercase;letter-spacing:1px;">${titre}</h1>
        </td></tr>
        <!-- Corps -->
        <tr><td style="padding:16px 32px 28px;font-size:15px;line-height:1.6;color:${paper};">
          ${corps}
        </td></tr>
        <!-- Pied -->
        <tr><td style="padding:20px 32px;border-top:1px solid ${border};font-size:12px;line-height:1.6;color:#8A8A8A;">
          Yoga Sculpt — Lyon<br>
          Vous recevez cet email car vous avez réservé un cours sur votre espace client.<br>
          Pour gérer vos réservations : <a href="${APP_URL}/espace/reservations" style="color:${gold};text-decoration:underline;">votre espace client</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Bloc HTML « carte » récapitulant le cours (date/heure/type/lieu). */
function carteCoursHtml(ctx: ContexteRappel): string {
  const gold = "#D4AD6A";
  const border = "#2A2A2A";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid ${border};border-radius:4px;">
    <tr><td style="padding:16px 18px;">
      <div style="font-family:'Anton','Arial Narrow',sans-serif;font-size:18px;color:${gold};text-transform:uppercase;letter-spacing:1px;">${libelleType(ctx.type)}</div>
      <div style="margin-top:8px;font-size:16px;color:#F2F0EC;"><strong>${dateLongueFr(ctx.startsAt)}</strong></div>
      <div style="margin-top:2px;font-size:15px;color:#F2F0EC;">${heureFr(ctx.startsAt)} — ${heureFr(ctx.endsAt)}</div>
      <div style="margin-top:8px;font-size:14px;color:#8A8A8A;">Lyon</div>
    </td></tr>
  </table>`;
}

/** Construit le HTML + texte d'un rappel J-1. */
function templateJ1(ctx: ContexteRappel): { html: string; text: string } {
  const salut = ctx.prenom ? `Bonjour ${ctx.prenom},` : "Bonjour,";
  const corps = `
    <p style="margin:0 0 12px;">${salut}</p>
    <p style="margin:0 0 4px;">Petit rappel : vous avez un cours <strong>demain</strong>.</p>
    ${carteCoursHtml(ctx)}
    <p style="margin:0 0 12px;">Pensez à prévoir une tenue confortable et une bouteille d'eau.</p>
    <p style="margin:16px 0 0;">
      <a href="${APP_URL}/espace/reservations" style="display:inline-block;background:#D4AD6A;color:#0E0E0E;font-family:'Anton','Arial Narrow',sans-serif;font-size:14px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 22px;border-radius:3px;">Voir ma réservation</a>
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:#8A8A8A;">À demain !</p>
  `;
  const html = coqueHtml("Votre cours de demain", corps);

  const text = [
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
    `Voir ma réservation : ${APP_URL}/espace/reservations`,
    "",
    "À demain !",
    "",
    "—",
    "Yoga Sculpt — Lyon",
    "Vous recevez cet email car vous avez réservé un cours sur votre espace client.",
  ].join("\n");

  return { html, text };
}

/** Construit le HTML + texte d'un rappel H-2. */
function templateH2(ctx: ContexteRappel): { html: string; text: string } {
  const salut = ctx.prenom ? `Bonjour ${ctx.prenom},` : "Bonjour,";
  const corps = `
    <p style="margin:0 0 12px;">${salut}</p>
    <p style="margin:0 0 4px;">C'est bientôt l'heure — votre cours commence <strong>dans 2 heures</strong>. On vous attend !</p>
    ${carteCoursHtml(ctx)}
    <p style="margin:16px 0 0;">
      <a href="${APP_URL}/espace/reservations" style="display:inline-block;background:#D4AD6A;color:#0E0E0E;font-family:'Anton','Arial Narrow',sans-serif;font-size:14px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 22px;border-radius:3px;">Voir ma réservation</a>
    </p>
  `;
  const html = coqueHtml("C'est dans 2h !", corps);

  const text = [
    salut,
    "",
    "C'est bientôt l'heure — votre cours commence dans 2 heures. On vous attend !",
    "",
    `${libelleType(ctx.type)}`,
    `${dateLongueFr(ctx.startsAt)}`,
    `${heureFr(ctx.startsAt)} — ${heureFr(ctx.endsAt)}`,
    "Lieu : Lyon",
    "",
    `Voir ma réservation : ${APP_URL}/espace/reservations`,
    "",
    "—",
    "Yoga Sculpt — Lyon",
  ].join("\n");

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
    console.error("[reminders] Chargement des profils échoué :", error.message);
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
    console.error(
      `[reminders] Scan ${kind} échoué :`,
      error.message,
    );
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
      console.error(
        `[reminders] ${kind} : aucun email pour user=${booking.user_id} ` +
          `(booking=${booking.id}) — ignoré.`,
      );
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
      console.error(
        `[reminders] ${kind} : envoi échoué pour ${email} ` +
          `(booking=${booking.id}) :`,
        err,
      );
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
      console.error(
        `[reminders] ${kind} : email envoyé mais horodatage ${colonne} ` +
          `échoué pour booking=${booking.id} (risque de doublon) :`,
        updErr.message,
      );
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

  console.info(
    `[reminders] Passage terminé — J-1: ${resultat.j1Envoyes}, ` +
      `H-2: ${resultat.h2Envoyes}, erreurs: ${resultat.erreurs}.`,
  );

  return resultat;
}
