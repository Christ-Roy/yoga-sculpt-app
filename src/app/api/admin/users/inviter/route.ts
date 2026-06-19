import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createLogger, serializeError } from "@/lib/log";
import { inviterBodySchema } from "../_lib/validation";
import { inviterEmail } from "../_lib/auth-admin";

const log = createLogger("admin/inviter");

/**
 * POST /api/admin/users/inviter — (ré)invite un e-mail (PRÉ-CRÉATION de compte).
 *
 * Body (zod strict) : `{ email }`.
 *
 * Effet : crée l'utilisateur côté GoTrue (s'il n'existe pas) ET déclenche
 * l'envoi de l'e-mail d'invitation par Supabase (SMTP du projet). On renvoie
 * aussi le lien d'action en secours si GoTrue le fournit.
 *
 * Réponses :
 *   - 200 `{ ok, emailSent, actionLink, message }` : invitation envoyée.
 *   - 400 `{ error, details? }`                     : e-mail invalide / body invalide.
 *   - 401 / redirect                                : non authentifié.
 *   - 409 `{ error }`                               : e-mail déjà inscrit.
 *   - 500 `{ error }`                               : échec GoTrue.
 *
 * Gate `requireAdmin()` en tête. Runtime edge (Cloudflare Workers).
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();

  // ── Validation du corps ─────────────────────────────────────────────────────
  let email: string;
  try {
    const json = await request.json();
    const result = inviterBodySchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: result.error.issues },
        { status: 400 },
      );
    }
    email = result.data.email;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  // ── Invitation (GoTrue crée le compte + envoie l'e-mail). ───────────────────
  try {
    const result = await inviterEmail(email);

    log.info("Admin a invité un utilisateur", { adminId: admin.userId });

    return NextResponse.json({
      ok: true,
      emailSent: result.emailSent,
      actionLink: result.actionLink,
      message:
        "Invitation envoyée. Le membre recevra un e-mail pour créer son accès.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // GoTrue renvoie une erreur si l'e-mail est déjà enregistré.
    if (/already|registered|exist/i.test(message)) {
      return NextResponse.json(
        { error: "Cet e-mail a déjà un compte." },
        { status: 409 },
      );
    }
    log.error("GoTrue a échoué", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Invitation impossible. Réessayez." },
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
