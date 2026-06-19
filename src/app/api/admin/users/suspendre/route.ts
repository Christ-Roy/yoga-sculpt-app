import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { suspendBodySchema } from "../_lib/validation";
import {
  suspendreCompte,
  reactiverCompte,
  lireUtilisateur,
} from "../_lib/auth-admin";

/**
 * POST /api/admin/users/suspendre — SUSPEND ou RÉACTIVE un compte.
 *
 * Body (zod strict) : `{ userId, suspendre: boolean }`.
 *   - `suspendre: true`  → ban GoTrue (auth refusée + sessions invalidées).
 *   - `suspendre: false` → lève le ban (réactivation).
 *
 * Réponses :
 *   - 200 `{ ok, suspendu, message }` : appliqué.
 *   - 400 `{ error, details? }`        : body invalide.
 *   - 401 / redirect                   : non authentifié.
 *   - 403 `{ error }`                  : tentative d'auto-suspension d'un admin.
 *   - 404 `{ error }`                  : userId inconnu.
 *   - 500 `{ error }`                  : échec GoTrue.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ APPROCHE — suspension = `ban_duration` GoTrue (PAS un flag profil maison).│
 * │   GoTrue bloque alors l'auth ET coupe les sessions : garde fiable sans    │
 * │   avoir à patcher chaque chemin de login. Réversible (`ban_duration:none`)│
 * │ GARDE-FOU — un admin ne peut pas se suspendre lui-même (verrouillage du   │
 * │   back-office). On compare l'`userId` cible à l'admin courant.            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Gate `requireAdmin()` en tête. Runtime edge (Cloudflare Workers).
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();

  // ── Validation du corps ─────────────────────────────────────────────────────
  let body;
  try {
    const json = await request.json();
    const result = suspendBodySchema.safeParse(json);
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

  // ── Garde-fou : pas d'auto-suspension (on ne se verrouille pas dehors). ─────
  if (body.suspendre && body.userId === admin.userId) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas suspendre votre propre compte admin." },
      { status: 403 },
    );
  }

  // ── Le compte cible doit exister. ───────────────────────────────────────────
  const { exists } = await lireUtilisateur(body.userId);
  if (!exists) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  // ── Application ─────────────────────────────────────────────────────────────
  try {
    if (body.suspendre) {
      await suspendreCompte(body.userId);
    } else {
      await reactiverCompte(body.userId);
    }

    console.log(
      `[admin/suspendre] ${admin.email} → ${body.suspendre ? "suspend" : "réactive"} ${body.userId}.`,
    );

    return NextResponse.json({
      ok: true,
      suspendu: body.suspendre,
      message: body.suspendre ? "Compte suspendu." : "Compte réactivé.",
    });
  } catch (err) {
    console.error("[admin/suspendre] GoTrue a échoué :", err);
    return NextResponse.json(
      { error: "Opération impossible. Réessayez." },
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
