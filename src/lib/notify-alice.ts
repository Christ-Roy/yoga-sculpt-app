/**
 * Notifications ALICE — email Brevo sur chaque événement de réservation.
 *
 * Décision Robert 2026-06-19 : Alice reçoit un email pour TOUS les événements
 * (nouvelle réservation collectif ET particulier, annulation, …) afin d'avoir
 * une visibilité temps réel sur son activité.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BEST-EFFORT ABSOLU — une notif ratée ne casse JAMAIS la réservation.      │
 * │   `notifierAlice` est dans l'esprit de `logEvent` : tout échec (Brevo      │
 * │   indisponible, clé absente, réseau) est avalé + loggé, et la fonction     │
 * │   renvoie `false` SANS throw. Les routes (`/api/reserver`, `/api/annuler`) │
 * │   l'appellent sans try/catch et sans risquer de faire échouer le flux.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Expéditeur : `notifications@yoga-sculpt.fr` (domaine authentifié SPF/DKIM côté
 * Brevo) — géré par `sendTransactionalEmail`. Destinataire : Alice, via la var
 * d'env `ALICE_NOTIFY_EMAIL` avec fallback `gdry.alice@gmail.com`.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). `fetch` (Brevo) + Web standard only. │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { sendTransactionalEmail } from "@/lib/brevo";
import { createLogger, serializeError } from "@/lib/log";
import {
  renderEmail,
  textFromBlocks,
  escapeHtml,
  COULEURS,
} from "@/lib/email-templates";
import {
  formaterDateLongueFr,
  formaterPlageFr,
  libelleType,
} from "@/lib/reservation";
import type { TicketType } from "@/lib/db-types";

const log = createLogger("notify-alice");

/** Email d'Alice par défaut si `ALICE_NOTIFY_EMAIL` n'est pas configuré. */
const ALICE_EMAIL_FALLBACK = "gdry.alice@gmail.com";

/** Résout l'adresse de notification d'Alice (env ou fallback). */
function emailAlice(): string {
  const env = process.env.ALICE_NOTIFY_EMAIL?.trim();
  return env || ALICE_EMAIL_FALLBACK;
}

/** Nature de l'événement notifié à Alice. */
export type EvenementAlice = "reservation" | "annulation";

/** Données du client + du créneau pour composer la notification. */
export interface PayloadNotifAlice {
  /** Type de cours. */
  type: TicketType;
  /** Début du créneau (ISO 8601). */
  startsAt: string;
  /** Fin du créneau (ISO 8601). */
  endsAt: string;
  /** Nom affiché du client (peut être absent → on tombera sur l'email). */
  clientNom?: string | null;
  /** Email du client. */
  clientEmail?: string | null;
  /** Téléphone du client (si connu). */
  clientTel?: string | null;
}

/** Libellé humain de l'événement (objet + titre du mail). */
function libelleEvenement(evenement: EvenementAlice): {
  objet: string;
  titre: string;
  intro: string;
} {
  if (evenement === "annulation") {
    return {
      objet: "Annulation d'une réservation",
      titre: "Réservation annulée",
      intro: "Une réservation vient d'être annulée :",
    };
  }
  return {
    objet: "Nouvelle réservation",
    titre: "Nouvelle réservation",
    intro: "Une nouvelle réservation vient d'être enregistrée :",
  };
}

/**
 * Notifie Alice par email d'un événement de réservation. Best-effort, ne throw
 * jamais.
 *
 * @returns `true` si l'email est parti, `false` sinon (échec avalé + loggé).
 */
export async function notifierAlice(
  evenement: EvenementAlice,
  payload: PayloadNotifAlice,
): Promise<boolean> {
  try {
    const to = emailAlice();
    const { objet, titre, intro } = libelleEvenement(evenement);

    const clientLabel =
      payload.clientNom?.trim() ||
      payload.clientEmail?.trim() ||
      "Client inconnu";

    const dateLongue = formaterDateLongueFr(payload.startsAt);
    const plage = formaterPlageFr(payload.startsAt, payload.endsAt);
    const typeLabel = libelleType(payload.type);

    // ── Bloc « créneau » (carte or, charte email factorisée). ────────────────
    const carteHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid ${COULEURS.border};border-radius:4px;background:${COULEURS.ink};">
      <tr><td style="padding:16px 18px;">
        <div style="font-family:'Anton','Arial Narrow',Helvetica,Arial,sans-serif;font-size:18px;color:${COULEURS.gold};text-transform:uppercase;letter-spacing:1px;">${escapeHtml(typeLabel)}</div>
        <div style="margin-top:8px;font-size:16px;color:${COULEURS.paper};"><strong>${escapeHtml(dateLongue)}</strong></div>
        <div style="margin-top:2px;font-size:15px;color:${COULEURS.paper};">${escapeHtml(plage)}</div>
      </td></tr>
    </table>`;

    // ── Bloc « client ». ─────────────────────────────────────────────────────
    const ligneTel = payload.clientTel?.trim()
      ? `<div style="margin-top:4px;font-size:14px;color:${COULEURS.paper};">Tél : <a href="tel:${escapeHtml(payload.clientTel.trim())}" style="color:${COULEURS.gold};text-decoration:none;">${escapeHtml(payload.clientTel.trim())}</a></div>`
      : "";
    const ligneEmail = payload.clientEmail?.trim()
      ? `<div style="margin-top:4px;font-size:14px;color:${COULEURS.paper};">Email : <a href="mailto:${escapeHtml(payload.clientEmail.trim())}" style="color:${COULEURS.gold};text-decoration:none;">${escapeHtml(payload.clientEmail.trim())}</a></div>`
      : "";
    const clientHtml = `<div style="margin:8px 0 0;">
        <div style="font-size:14px;color:${COULEURS.muted};text-transform:uppercase;letter-spacing:1px;">Client</div>
        <div style="margin-top:6px;font-size:16px;color:${COULEURS.paper};"><strong>${escapeHtml(clientLabel)}</strong></div>
        ${ligneEmail}
        ${ligneTel}
      </div>`;

    const corpsHtml = `
      <p style="margin:0 0 4px;">${escapeHtml(intro)}</p>
      ${carteHtml}
      ${clientHtml}
    `;

    const { html } = renderEmail({
      preheader: `${objet} — ${typeLabel}, ${plage}.`,
      titre,
      corpsHtml,
      footerNote:
        "Notification automatique de votre espace de réservation Yoga Sculpt.",
      unsubscribeUrl: null,
    });

    const text = textFromBlocks([
      intro,
      "",
      typeLabel,
      dateLongue,
      plage,
      "",
      "Client :",
      clientLabel,
      payload.clientEmail?.trim() ? `Email : ${payload.clientEmail.trim()}` : "",
      payload.clientTel?.trim() ? `Tél : ${payload.clientTel.trim()}` : "",
      "",
      "—",
      "Yoga Sculpt — Lyon",
      "Notification automatique de votre espace de réservation.",
    ]);

    await sendTransactionalEmail({
      to,
      toName: "Alice Gaudry",
      subject: objet,
      htmlContent: html,
      textContent: text,
    });
    return true;
  } catch (err) {
    // Best-effort : on n'échoue JAMAIS le flux métier pour une notif ratée.
    log.error("notifierAlice échoué (non bloquant)", {
      evenement,
      err: serializeError(err),
    });
    return false;
  }
}
