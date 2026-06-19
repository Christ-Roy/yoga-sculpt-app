import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createLogger, serializeError } from "@/lib/log";
import { authActionBodySchema } from "../_lib/validation";
import {
  genererLienRecovery,
  genererLienMagic,
  lireUtilisateur,
} from "../_lib/auth-admin";

const log = createLogger("admin/auth-action");

/**
 * POST /api/admin/users/auth-action — génère un lien d'auth pour un compte.
 *
 * Body (zod strict) : `{ userId, action: 'recovery' | 'magiclink' }`.
 *   - 'recovery'  : lien de RÉINITIALISATION de mot de passe.
 *   - 'magiclink' : lien de CONNEXION sans mot de passe.
 *
 * Réponses :
 *   - 200 `{ ok, actionLink, emailSent, message }` : lien généré (à copier).
 *   - 400 `{ error, details? }`                     : body invalide.
 *   - 401 / redirect                                : non authentifié.
 *   - 404 `{ error }`                               : userId inconnu.
 *   - 500 `{ error }`                               : échec GoTrue.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ENVOI — `generateLink` GÉNÈRE le lien sans envoyer d'e-mail. On renvoie   │
 * │ donc `actionLink` à l'admin (fallback sûr : il le copie/transmet). C'est  │
 * │ volontaire : indépendant de la config SMTP du projet Supabase.            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * On RELIT l'e-mail du compte côté serveur (par `userId`) : on ne fait pas
 * confiance à un e-mail fourni par le client. Gate `requireAdmin()` en tête.
 * Runtime edge (Cloudflare Workers).
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();

  // ── Validation du corps ─────────────────────────────────────────────────────
  let body;
  try {
    const json = await request.json();
    const result = authActionBodySchema.safeParse(json);
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

  // ── Relit l'e-mail réel du compte (source de vérité = GoTrue). ──────────────
  const { exists, email } = await lireUtilisateur(body.userId);
  if (!exists || !email) {
    return NextResponse.json(
      { error: "Compte introuvable ou sans e-mail." },
      { status: 404 },
    );
  }

  // ── Génération du lien ──────────────────────────────────────────────────────
  try {
    const result =
      body.action === "recovery"
        ? await genererLienRecovery(email)
        : await genererLienMagic(email);

    log.info("Admin a généré un lien d'auth", {
      adminId: admin.userId,
      cibleId: body.userId,
      action: body.action,
    });

    return NextResponse.json({
      ok: true,
      actionLink: result.actionLink,
      emailSent: result.emailSent,
      message:
        body.action === "recovery"
          ? "Lien de réinitialisation généré. Copiez-le et transmettez-le au membre."
          : "Magic-link de connexion généré. Copiez-le et transmettez-le au membre.",
    });
  } catch (err) {
    log.error("GoTrue a échoué", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Génération du lien impossible. Réessayez." },
      { status: 500 },
    );
  }
}

/** Seul POST est autorisé. */
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
