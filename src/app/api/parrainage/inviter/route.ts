import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateCode, normaliserEmail } from "@/lib/referral";
import { isDisposableEmail } from "@/lib/anti-abuse";
import { renderEmail, textFromBlocks, escapeHtml } from "@/lib/email-templates";

/**
 * POST /api/parrainage/inviter — le membre connecté invite un filleul par e-mail.
 *
 * Body (zod, strict) : `{ email: string }`.
 *
 * Effet :
 *   1. crée (ou met à jour) un `referral` en statut 'pending' lié au parrain ;
 *   2. envoie un e-mail d'invitation au filleul (best-effort, cf ENVOI ci-bas).
 *
 * Le crédit du ticket NE se fait PAS ici : il se fera à l'inscription effective
 * du filleul (POST /api/parrainage/completer), sous réserve de l'anti-abus.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ CONTRAT (pour l'agent UI) — réponses :                                   │
 * │   200 { ok: true, code }       : invitation enregistrée.                 │
 * │   400 { error }                : e-mail invalide / corps invalide.       │
 * │   401 { error }                : non authentifié.                        │
 * │   409 { error: "deja_invite" } : ce filleul a déjà été invité par vous.  │
 * │   422 { error }                : on ne s'invite pas soi-même.            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ENVOI DE L'E-MAIL — DÉCOUPLAGE (contrat de territoire V2b)               │
 * │   On NE dépend PAS de src/lib/brevo.ts (propriété d'un autre agent). On  │
 * │   appelle l'API Brevo directement en fetch (edge-safe). Si BREVO_API_KEY │
 * │   n'est pas configurée, l'invitation est quand même ENREGISTRÉE et       │
 * │   l'envoi est un no-op loggé (le parrain peut partager son lien à la     │
 * │   main). TODO au merge : si l'équipe préfère centraliser l'envoi dans    │
 * │   brevo.ts, remplacer envoyerInvitation() par cet helper partagé.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Runtime edge (Cloudflare Workers).
 */

const bodySchema = z
  .object({
    // On normalise (trim + minuscules) AVANT de valider le format : un e-mail
    // collé avec des espaces/majuscules ne doit pas être rejeté en 400 — il est
    // nettoyé puis validé (sinon les checks self-invite/jetable en aval seraient
    // court-circuités par un faux 400 sur un e-mail pourtant valide).
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: "Adresse e-mail invalide." })),
  })
  .strict();

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
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

  // ── Validation du corps ─────────────────────────────────────────────────────
  let email: string;
  try {
    const json = await request.json();
    const result = bodySchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: result.error.issues },
        { status: 400 },
      );
    }
    email = normaliserEmail(result.data.email);
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  // On ne s'invite pas soi-même.
  if (user.email && normaliserEmail(user.email) === email) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas vous inviter vous-même." },
      { status: 422 },
    );
  }

  // Anti-spam basique : on n'envoie pas d'invitation vers une adresse jetable.
  // (Pas révélateur : on bloque l'invitation, pas un crédit.)
  if (isDisposableEmail(email)) {
    return NextResponse.json(
      { error: "Cette adresse e-mail n'est pas acceptée." },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  // ── Code du parrain (généré si besoin). ─────────────────────────────────────
  const code = await getOrCreateCode(service, user.id);
  if (!code) {
    return NextResponse.json(
      { error: "Impossible de générer votre code de parrainage." },
      { status: 500 },
    );
  }

  // ── Crée le referral pending (unicité (parrain, email) → 409 si déjà invité).
  const PG_UNIQUE_VIOLATION = "23505";
  const { error: insertErr } = await service.from("referrals").insert({
    parrain_user_id: user.id,
    filleul_email: email,
    code,
    status: "pending",
  });

  if (insertErr) {
    if (insertErr.code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: "deja_invite" },
        { status: 409 },
      );
    }
    console.error("[parrainage/inviter] Insert referral échoué :", insertErr.message);
    return NextResponse.json(
      { error: "Invitation impossible. Réessayez." },
      { status: 500 },
    );
  }

  // ── Envoi de l'e-mail d'invitation (best-effort, non bloquant). ─────────────
  const parrainNom =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  await envoyerInvitation({ filleulEmail: email, code, parrainNom }).catch(
    (err) => {
      // L'invitation est enregistrée : un échec d'e-mail ne doit pas la perdre.
      console.error("[parrainage/inviter] Envoi e-mail échoué (non bloquant) :", err);
    },
  );

  return NextResponse.json({ ok: true, code });
}

/**
 * Envoi de l'e-mail d'invitation via l'API Brevo (fetch direct, edge-safe).
 * No-op loggé si la config est absente. Le lien d'inscription embarque le code
 * (`?ref=<code>`) que le front (agent UI) déposera en cookie avant le login.
 */
async function envoyerInvitation(params: {
  filleulEmail: string;
  code: string;
  parrainNom: string | null;
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.yoga-sculpt.fr";
  // Expéditeur : variables dédiées au parrainage (pas de couplage avec un autre
  // flux). Valeurs par défaut raisonnables si non configuré.
  const senderEmail =
    process.env.BREVO_INVITE_SENDER_EMAIL ?? "contact@yoga-sculpt.fr";
  const senderName = process.env.BREVO_INVITE_SENDER_NAME ?? "Yoga Sculpt";

  if (!apiKey) {
    console.warn(
      "[parrainage/inviter] BREVO_API_KEY absente — e-mail d'invitation non envoyé (invitation enregistrée).",
    );
    return;
  }

  const lien = `${appUrl}/login?ref=${encodeURIComponent(params.code)}`;
  // Texte brut (pour la version texte + interpolation HTML échappée).
  const deLaPart = params.parrainNom ? ` de la part de ${params.parrainNom}` : "";
  // Variante HTML : le nom du parrain (donnée utilisateur) doit être échappé.
  const deLaPartHtml = params.parrainNom
    ? ` de la part de <strong>${escapeHtml(params.parrainNom)}</strong>`
    : "";

  const subject = `Un ami vous offre une séance de Yoga Sculpt 🎁`;

  const corpsHtml = `
    <p style="margin:0 0 12px;">Bonjour,</p>
    <p style="margin:0 0 12px;">Vous avez reçu une invitation${deLaPartHtml} à découvrir
    <strong>Yoga Sculpt</strong>, cours de yoga et pilates à Lyon.</p>
    <p style="margin:0;">Créez votre compte pour en profiter — on vous attend sur le tapis !</p>
  `;
  const { html: htmlContent } = renderEmail({
    preheader: "Une invitation à découvrir Yoga Sculpt vous attend.",
    titre: "Un ami vous offre une séance 🎁",
    corpsHtml,
    cta: { label: "Découvrir Yoga Sculpt", url: lien },
    footerNote:
      "Vous recevez cet email car un membre vous a invité·e à rejoindre Yoga Sculpt.",
  });
  const textContent = textFromBlocks([
    "Bonjour,",
    "",
    `Vous êtes invité·e${deLaPart} à découvrir Yoga Sculpt (yoga & pilates à Lyon).`,
    "",
    `Créer votre compte : ${lien}`,
    "",
    "À très vite sur le tapis !",
    "",
    "—",
    "Yoga Sculpt — Lyon",
  ]);

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: params.filleulEmail }],
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[parrainage/inviter] Brevo a renvoyé ${resp.status} : ${body}`);
  }
}

// L'invitation se fait uniquement en POST.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
