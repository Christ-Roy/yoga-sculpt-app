/**
 * Helper d'envoi d'email transactionnel via Brevo (ex-Sendinblue).
 *
 * Brevo expose une API HTTP simple (`POST /v3/smtp/email`) authentifiée par un
 * header `api-key`. Pas de SDK : un `fetch` suffit, ce qui le rend nativement
 * compatible avec le runtime Cloudflare Workers (edge) — aucune dépendance Node.
 *
 * Domaine `yoga-sculpt.fr` authentifié côté Brevo (SPF/DKIM OK), expéditeur
 * `notifications@yoga-sculpt.fr`. La clé API vit dans l'env `BREVO_API_KEY`
 * (secret serveur — `wrangler secret put BREVO_API_KEY` en prod, jamais commité).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). `fetch` + Web standard uniquement.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { createLogger } from "@/lib/log";

const log = createLogger("brevo");

/** Endpoint d'envoi transactionnel Brevo. */
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

/** Expéditeur unique de toutes les notifications Yoga Sculpt. */
const SENDER = {
  name: "Yoga Sculpt",
  email: "notifications@yoga-sculpt.fr",
} as const;

/** Paramètres d'un envoi transactionnel. */
export interface SendTransactionalEmailParams {
  /** Destinataire (adresse email). */
  to: string;
  /** Nom affiché du destinataire (optionnel, pour l'en-tête To). */
  toName?: string;
  /** Objet du mail. */
  subject: string;
  /** Corps HTML (version riche). */
  htmlContent: string;
  /** Corps texte brut (fallback accessibilité / clients sans HTML). */
  textContent: string;
}

/**
 * Envoie un email transactionnel via Brevo.
 *
 * @throws si `BREVO_API_KEY` est absent, ou si l'API Brevo répond non-2xx.
 *         (L'appelant — le cron de rappels — log et n'arrête pas le batch pour
 *         une seule erreur d'envoi, cf. `scanAndSendReminders`.)
 */
export async function sendTransactionalEmail(
  params: SendTransactionalEmailParams,
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;

  // Fail-fast explicite : sans clé, l'envoi échouerait avec un 401 cryptique.
  if (!apiKey) {
    throw new Error("Envoi Brevo impossible : BREVO_API_KEY manquant.");
  }

  const { to, toName, subject, htmlContent, textContent } = params;

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: SENDER,
      to: [toName ? { email: to, name: toName } : { email: to }],
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!response.ok) {
    // On lit le corps d'erreur pour un log exploitable (Brevo renvoie un JSON
    // `{ code, message }`). On ne propage pas la clé API dans le message.
    const detail = await response.text().catch(() => "");
    // PII : on ne logge PAS l'email destinataire `to`. Le status + le détail
    // Brevo (code/message d'erreur, jamais la clé API) suffisent au debug.
    log.error("Envoi transactionnel échoué", { status: response.status, detail });
    throw new Error(`Brevo a répondu ${response.status}.`);
  }
}
