/**
 * Relance email automatique des INACTIFS (rétention / réactivation).
 *
 * Déclenché par le même Cloudflare Cron Trigger que les rappels J-1/H-2 (toutes
 * les 15 min, cf. `wrangler.jsonc`) via la route protégée GET /api/cron. Ce
 * module est une 3ᵉ passe indépendante : il relance ceux qui n'ont RIEN de prévu
 * (l'inverse des rappels, qui visent un cours DÉJÀ réservé).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ TROIS SEGMENTS (priorité décroissante — 1 relance MAX par user / tick).   │
 * │   1. "jamais réservé"  : compte créé > SEUIL_JAMAIS_RESERVE_J, 0 booking.  │
 * │   2. "dormant"         : a eu des résas confirmées, la dernière remonte à  │
 * │                          > SEUIL_DORMANT_J, aucune résa à venir.           │
 * │   3. "ticket dormant"  : tickets en solde (quantite_restante>0, non        │
 * │                          expirés), aucune résa à venir.                    │
 * │  Un user qui matche plusieurs segments n'est relancé que par le 1er (ordre │
 * │  ci-dessus) : on ne le re-traite pas dans les passes suivantes du même tick.│
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ IDEMPOTENCE / ANTI-SPAM — 1 relance / segment / fenêtre.                  │
 * │   3 colonnes timestamptz sur `profiles` (migration 0011) horodatent la     │
 * │   dernière relance de chaque segment. Le scan ne (re)prend un user QUE si  │
 * │   sa colonne est NULL ou antérieure à `RELANCE_COOLDOWN_MS`. La colonne    │
 * │   est posée APRÈS un envoi réussi → pas de re-spam au tick suivant. On     │
 * │   suit le pattern de reminders.ts (envoi PUIS horodatage) : on préfère un  │
 * │   risque infime de doublon (échec d'horodatage post-envoi, tracé) à la     │
 * │   perte d'une relance sur une erreur Brevo transitoire. Le cron est        │
 * │   mono-instance (tick toutes les 15 min) → pas de course concurrente.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). `fetch` (Brevo + PostgREST Supabase). │
 * │   Web standard only. Écriture via le client service_role (bypass RLS :    │
 * │   cron machine-to-machine, pas de session cookie).                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalEmail } from "@/lib/brevo";
import { logEvent } from "@/lib/events";
import { renderEmail, textFromBlocks, escapeHtml } from "@/lib/email-templates";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("relance");

// ============================================================================
// Constantes — fenêtres temporelles & garde-fous (configurables ici)
// ============================================================================

/** URL de l'espace client (CTA des relances → page de réservation). */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.yoga-sculpt.fr";

/** Page de réservation (CTA principal de toutes les relances). */
const URL_RESERVER = `${APP_URL}/espace/reserver`;

const JOUR_MS = 24 * 60 * 60 * 1000;

/** Segment 1 — un compte est "jamais réservé" relançable après ce délai. */
export const SEUIL_JAMAIS_RESERVE_J = 3;

/** Segment 2 — un client devient "dormant" sans résa depuis ce délai. */
export const SEUIL_DORMANT_J = 30;

/**
 * Anti-rejeu : on ne relance pas deux fois le MÊME user pour le MÊME segment
 * dans cette fenêtre. Volontairement large (prof solo, faible volume → mieux
 * vaut une relance bien ciblée qu'un drip agressif).
 */
export const RELANCE_COOLDOWN_J = 60;
const RELANCE_COOLDOWN_MS = RELANCE_COOLDOWN_J * JOUR_MS;

/**
 * Plafond d'envois par tick (toutes segments confondues). Borne le volume d'un
 * passage : sur un solo le backlog est minuscule, mais ça protège d'un envoi de
 * masse accidentel. Le reliquat éventuel partira aux ticks suivants.
 */
const LOT_MAX = 100;

/** Identifiants de segment (sert au choix de template + colonne + tracking). */
export type SegmentRelance =
  | "jamais_reserve"
  | "dormant"
  | "ticket_dormant";

/** Colonne d'anti-rejeu (sur profiles) associée à chaque segment. */
const COLONNE_SEGMENT: Record<SegmentRelance, string> = {
  jamais_reserve: "relance_jamais_reserve_sent_at",
  dormant: "relance_dormant_sent_at",
  ticket_dormant: "relance_ticket_dormant_sent_at",
};

// ============================================================================
// Types internes
// ============================================================================

/** Profil minimal chargé pour le scan (colonnes utiles + horodatages relance). */
interface ProfilRelance {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  relance_jamais_reserve_sent_at: string | null;
  relance_dormant_sent_at: string | null;
  relance_ticket_dormant_sent_at: string | null;
}

/** Booking minimal pour le calcul des segments (statut + dates). */
interface BookingScan {
  user_id: string;
  status: string;
  starts_at: string;
}

/** Ticket minimal pour le segment "ticket dormant". */
interface TicketScan {
  user_id: string;
  quantite_restante: number;
  expires_at: string | null;
}

/** Résultat agrégé d'un passage (pour le log / la réponse HTTP du cron). */
export interface ResultatRelances {
  jamaisReserve: number;
  dormant: number;
  ticketDormant: number;
  erreurs: number;
}

// ============================================================================
// Helpers purs
// ============================================================================

/** Prénom à partir du `full_name` ("Alice Gaudry" → "Alice"). */
function prenomDepuis(fullName: string | null): string | null {
  if (!fullName) return null;
  const prenom = fullName.trim().split(/\s+/)[0];
  return prenom || null;
}

/** Salutation texte brut. */
function salutation(prenom: string | null): string {
  return prenom ? `Bonjour ${prenom},` : "Bonjour,";
}

/** Salutation HTML (prénom échappé : provient du profil utilisateur). */
function salutationHtml(prenom: string | null): string {
  return prenom ? `Bonjour ${escapeHtml(prenom)},` : "Bonjour,";
}

/**
 * Un horodatage de relance est-il "frais" (dans la fenêtre de cooldown) ?
 * Si oui, on NE relance PAS ce segment pour ce user.
 */
function relanceRecente(sentAt: string | null, now: number): boolean {
  if (!sentAt) return false;
  const t = new Date(sentAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < RELANCE_COOLDOWN_MS;
}

// ============================================================================
// Templates email (charte NOIR & OR, via le layout factorisé)
// ============================================================================

/** Sujet par segment. */
function sujet(segment: SegmentRelance, soldeTickets: number): string {
  switch (segment) {
    case "jamais_reserve":
      return "Prêt(e) pour votre première séance ? — Yoga Sculpt";
    case "dormant":
      return "On ne vous a pas vu(e) depuis un moment — Yoga Sculpt";
    case "ticket_dormant":
      return soldeTickets > 1
        ? `Il vous reste ${soldeTickets} séances — Yoga Sculpt`
        : "Il vous reste une séance — Yoga Sculpt";
  }
}

/** Note de footer (raison de l'envoi) par segment. */
function footerNote(segment: SegmentRelance): string {
  switch (segment) {
    case "jamais_reserve":
      return "Vous recevez cet email car vous avez créé un compte Yoga Sculpt et n'avez pas encore réservé de séance.";
    case "dormant":
      return "Vous recevez cet email car vous êtes inscrit(e) sur l'espace client Yoga Sculpt.";
    case "ticket_dormant":
      return "Vous recevez cet email car il vous reste des séances non utilisées sur votre compte Yoga Sculpt.";
  }
}

/** Construit le {html, text} d'une relance selon le segment. */
function template(
  segment: SegmentRelance,
  prenom: string | null,
  soldeTickets: number,
): { html: string; text: string } {
  const salut = salutation(prenom);
  const salutH = salutationHtml(prenom);
  const note = footerNote(segment);

  let titre: string;
  let preheader: string;
  let accrocheHtml: string;
  let accrocheText: string;
  let ctaLabel: string;

  switch (segment) {
    case "jamais_reserve":
      titre = "Votre première séance vous attend";
      preheader = "Réservez votre première séance de Yoga Sculpt.";
      ctaLabel = "Réserver ma séance";
      accrocheHtml = `
        <p style="margin:0 0 12px;">${salutH}</p>
        <p style="margin:0 0 10px;">Vous avez créé votre compte, il ne reste plus qu'une étape : réserver votre <strong>première séance</strong>.</p>
        <p style="margin:0 0 10px;">Yoga, Pilates, renforcement en douceur — Alice vous accompagne pas à pas, quel que soit votre niveau. Choisissez un créneau qui vous arrange, le reste suivra.</p>
      `;
      accrocheText = [
        "Vous avez créé votre compte, il ne reste plus qu'une étape : réserver votre première séance.",
        "",
        "Yoga, Pilates, renforcement en douceur — Alice vous accompagne pas à pas, quel que soit votre niveau. Choisissez un créneau qui vous arrange, le reste suivra.",
      ].join("\n");
      break;

    case "dormant":
      titre = "On remet ça ?";
      preheader = "Ça fait un moment — votre prochaine séance vous attend.";
      ctaLabel = "Réserver un créneau";
      accrocheHtml = `
        <p style="margin:0 0 12px;">${salutH}</p>
        <p style="margin:0 0 10px;">Ça fait un moment qu'on ne vous a pas vu(e) en cours, et votre corps s'en souvient sûrement.</p>
        <p style="margin:0 0 10px;">Reprendre, c'est plus facile qu'on ne le pense : un créneau, une séance, et on repart. Alice serait ravie de vous retrouver sur le tapis.</p>
      `;
      accrocheText = [
        "Ça fait un moment qu'on ne vous a pas vu(e) en cours, et votre corps s'en souvient sûrement.",
        "",
        "Reprendre, c'est plus facile qu'on ne le pense : un créneau, une séance, et on repart. Alice serait ravie de vous retrouver sur le tapis.",
      ].join("\n");
      break;

    case "ticket_dormant": {
      const n = soldeTickets > 1 ? `${soldeTickets} séances` : "une séance";
      titre = "Vos séances vous attendent";
      preheader = `Il vous reste ${n} à utiliser.`;
      ctaLabel = "Réserver maintenant";
      accrocheHtml = `
        <p style="margin:0 0 12px;">${salutH}</p>
        <p style="margin:0 0 10px;">Il vous reste <strong>${escapeHtml(n)}</strong> sur votre compte, et aucune réservation à venir pour l'instant.</p>
        <p style="margin:0 0 10px;">Ne les laissez pas dormir : posez votre prochain créneau dès maintenant, c'est l'affaire de quelques secondes.</p>
      `;
      accrocheText = [
        `Il vous reste ${n} sur votre compte, et aucune réservation à venir pour l'instant.`,
        "",
        "Ne les laissez pas dormir : posez votre prochain créneau dès maintenant, c'est l'affaire de quelques secondes.",
      ].join("\n");
      break;
    }
  }

  const { html } = renderEmail({
    preheader,
    titre,
    corpsHtml: accrocheHtml,
    cta: { label: ctaLabel, url: URL_RESERVER },
    footerNote: note,
  });

  const text = textFromBlocks([
    salut,
    "",
    accrocheText,
    "",
    `${ctaLabel} : ${URL_RESERVER}`,
    "",
    "—",
    "Yoga Sculpt — Lyon",
    note,
  ]);

  return { html, text };
}

// ============================================================================
// Chargement des données (PostgREST — pas de jointure FK directe, cf. reminders)
// ============================================================================

/**
 * Charge les profils ÉLIGIBLES : email présent ET au moins un segment dont
 * l'horodatage est NULL ou hors cooldown. On filtre côté SQL sur `email not null`
 * et on plafonne à LOT_MAX*5 candidats (le tri JS final retient LOT_MAX envois) ;
 * le filtrage fin par segment se fait en JS (3 colonnes OR + cooldown).
 */
async function chargerProfilsCandidats(
  service: SupabaseClient,
  nowIso: string,
): Promise<ProfilRelance[]> {
  const cutoff = new Date(Date.now() - RELANCE_COOLDOWN_MS).toISOString();

  // Un user est candidat s'il a au moins une colonne de relance NULL OU plus
  // ancienne que le cooldown. PostgREST `.or(...)` exprime ce filtre.
  const orFiltre = [
    `relance_jamais_reserve_sent_at.is.null`,
    `relance_jamais_reserve_sent_at.lt.${cutoff}`,
    `relance_dormant_sent_at.is.null`,
    `relance_dormant_sent_at.lt.${cutoff}`,
    `relance_ticket_dormant_sent_at.is.null`,
    `relance_ticket_dormant_sent_at.lt.${cutoff}`,
  ].join(",");

  const { data, error } = await service
    .from("profiles")
    .select(
      "id, email, full_name, created_at, relance_jamais_reserve_sent_at, relance_dormant_sent_at, relance_ticket_dormant_sent_at",
    )
    .not("email", "is", null)
    .lt("created_at", nowIso)
    .or(orFiltre)
    .order("created_at", { ascending: true })
    .limit(LOT_MAX * 5);

  if (error) {
    log.error("Chargement des profils échoué", { db: error.message });
    return [];
  }
  return (data ?? []) as ProfilRelance[];
}

/**
 * Charge les bookings (statut + dates) des users donnés. Map user_id → bookings.
 * On ne joint pas profiles↔bookings (pas de FK directe → PostgREST ne sait pas
 * embed), on fait une 2ᵉ requête `user_id IN (...)` comme dans reminders.ts.
 */
async function chargerBookings(
  service: SupabaseClient,
  userIds: string[],
): Promise<Map<string, BookingScan[]>> {
  const map = new Map<string, BookingScan[]>();
  if (userIds.length === 0) return map;

  const { data, error } = await service
    .from("bookings")
    .select("user_id, status, starts_at")
    .in("user_id", userIds);

  if (error) {
    log.error("Chargement des bookings échoué", { db: error.message });
    return map;
  }
  for (const b of (data ?? []) as BookingScan[]) {
    const arr = map.get(b.user_id) ?? [];
    arr.push(b);
    map.set(b.user_id, arr);
  }
  return map;
}

/**
 * Charge les tickets ACTIFS (solde > 0, non expirés) des users donnés.
 * Map user_id → solde total de séances restantes.
 */
async function chargerSoldesTickets(
  service: SupabaseClient,
  userIds: string[],
  nowIso: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;

  const { data, error } = await service
    .from("tickets")
    .select("user_id, quantite_restante, expires_at")
    .in("user_id", userIds)
    .gt("quantite_restante", 0)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

  if (error) {
    log.error("Chargement des tickets échoué", { db: error.message });
    return map;
  }
  for (const t of (data ?? []) as TicketScan[]) {
    map.set(t.user_id, (map.get(t.user_id) ?? 0) + t.quantite_restante);
  }
  return map;
}

// ============================================================================
// Classification d'un user dans un segment (pur)
// ============================================================================

/** Le user a-t-il une résa confirmée À VENIR ? (exclut tous les segments "à relancer"). */
function aResaFuture(bookings: BookingScan[], now: number): boolean {
  return bookings.some(
    (b) => b.status === "confirmed" && new Date(b.starts_at).getTime() >= now,
  );
}

/** Date (ms) de la dernière résa confirmée passée, ou null si aucune. */
function derniereResaConfirmee(
  bookings: BookingScan[],
  now: number,
): number | null {
  let max: number | null = null;
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    const t = new Date(b.starts_at).getTime();
    if (Number.isNaN(t) || t > now) continue; // on ne compte que les passées
    if (max === null || t > max) max = t;
  }
  return max;
}

/**
 * Détermine le segment de relance d'un user (ou null) — PRIORITÉ décroissante :
 * jamais_reserve > dormant > ticket_dormant. Respecte le cooldown par segment.
 *
 * @returns le segment à relancer, ou null si aucun (ou tous en cooldown).
 */
export function classerSegment(
  profil: ProfilRelance,
  bookings: BookingScan[],
  soldeTickets: number,
  now: number,
): SegmentRelance | null {
  const aBooking = bookings.length > 0;
  const futur = aResaFuture(bookings, now);

  // ── Segment 1 : inscrit jamais réservé (compte assez vieux, 0 booking). ──
  if (
    !aBooking &&
    now - new Date(profil.created_at).getTime() >=
      SEUIL_JAMAIS_RESERVE_J * JOUR_MS &&
    !relanceRecente(profil.relance_jamais_reserve_sent_at, now)
  ) {
    return "jamais_reserve";
  }

  // ── Segment 2 : dormant (a eu des résas, la dernière > seuil, rien à venir). ──
  if (!futur) {
    const derniere = derniereResaConfirmee(bookings, now);
    if (
      derniere !== null &&
      now - derniere >= SEUIL_DORMANT_J * JOUR_MS &&
      !relanceRecente(profil.relance_dormant_sent_at, now)
    ) {
      return "dormant";
    }
  }

  // ── Segment 3 : ticket dormant (solde > 0, rien à venir). ──
  if (
    !futur &&
    soldeTickets > 0 &&
    !relanceRecente(profil.relance_ticket_dormant_sent_at, now)
  ) {
    return "ticket_dormant";
  }

  return null;
}

// ============================================================================
// Envoi + horodatage (idempotence)
// ============================================================================

/**
 * Envoie une relance à un user pour un segment, puis horodate la colonne
 * correspondante (idempotence). Best-effort : log + compteur d'erreur, jamais
 * de throw. @returns true si l'email est parti (même si l'horodatage rate).
 */
async function envoyerRelance(
  service: SupabaseClient,
  profil: ProfilRelance,
  segment: SegmentRelance,
  soldeTickets: number,
): Promise<boolean> {
  const email = profil.email;
  if (!email) return false; // garde-fou (déjà filtré côté SQL)

  const prenom = prenomDepuis(profil.full_name);
  const { html, text } = template(segment, prenom, soldeTickets);

  try {
    await sendTransactionalEmail({
      to: email,
      toName: profil.full_name ?? undefined,
      subject: sujet(segment, soldeTickets),
      htmlContent: html,
      textContent: text,
    });
  } catch (err) {
    log.error("envoi échoué", {
      segment,
      user_id: profil.id,
      err: serializeError(err),
    });
    return false;
  }

  // Horodatage APRÈS envoi réussi → anti-spam (cf. en-tête de module).
  const colonne = COLONNE_SEGMENT[segment];
  const { error: updErr } = await service
    .from("profiles")
    .update({ [colonne]: new Date().toISOString() })
    .eq("id", profil.id);

  if (updErr) {
    log.error(
      "email envoyé mais horodatage échoué (risque de doublon au prochain cooldown)",
      { segment, colonne, user_id: profil.id, db: updErr.message },
    );
    // L'email est PARTI : on le compte comme envoyé (best-effort tracking).
  }

  // Tracking best-effort (ne bloque pas, ne throw pas).
  void logEvent(
    profil.id,
    "reactivation_sent",
    { segment, solde_tickets: soldeTickets },
    { source: "cron", service },
  );

  return true;
}

// ============================================================================
// Point d'entrée — appelé par la route cron
// ============================================================================

/**
 * Scanne les 3 segments d'inactifs et envoie les relances dues. Idempotent
 * (anti-spam via colonnes profiles + cooldown). Ne lève jamais : agrège les
 * compteurs et erreurs pour le log / la réponse HTTP.
 */
export async function scanAndSendRelances(
  now: Date = new Date(),
): Promise<ResultatRelances> {
  const service = createServiceClient();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const resultat: ResultatRelances = {
    jamaisReserve: 0,
    dormant: 0,
    ticketDormant: 0,
    erreurs: 0,
  };

  const profils = await chargerProfilsCandidats(service, nowIso);
  if (profils.length === 0) {
    log.info("Aucun profil candidat à relancer");
    return resultat;
  }

  const userIds = profils.map((p) => p.id);
  const [bookingsParUser, soldesParUser] = await Promise.all([
    chargerBookings(service, userIds),
    chargerSoldesTickets(service, userIds, nowIso),
  ]);

  let envois = 0;
  for (const profil of profils) {
    if (envois >= LOT_MAX) break; // garde-fou volume

    const bookings = bookingsParUser.get(profil.id) ?? [];
    const solde = soldesParUser.get(profil.id) ?? 0;

    const segment = classerSegment(profil, bookings, solde, nowMs);
    if (!segment) continue;

    const ok = await envoyerRelance(service, profil, segment, solde);
    if (!ok) {
      resultat.erreurs += 1;
      continue;
    }

    envois += 1;
    if (segment === "jamais_reserve") resultat.jamaisReserve += 1;
    else if (segment === "dormant") resultat.dormant += 1;
    else resultat.ticketDormant += 1;
  }

  log.info("Passage terminé", {
    jamais_reserve: resultat.jamaisReserve,
    dormant: resultat.dormant,
    ticket_dormant: resultat.ticketDormant,
    erreurs: resultat.erreurs,
  });

  return resultat;
}
