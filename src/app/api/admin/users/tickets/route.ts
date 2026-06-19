import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/log";
import { ticketsBodySchema } from "../_lib/validation";
import { crediterTickets, debiterTickets } from "../_lib/tickets-admin";
import { lireUtilisateur } from "../_lib/auth-admin";

const log = createLogger("admin/tickets");

/**
 * POST /api/admin/users/tickets — CRÉDIT / DÉBIT manuel de séances par l'admin.
 *
 * Body (zod strict) : `{ userId, type, sens, quantite, opId }`.
 * Réponses :
 *   - 200 `{ ok, soldeApres, message }` : opération appliquée (ou idempotente).
 *   - 400 `{ error, details? }`          : body invalide.
 *   - 401 / redirect                     : non authentifié (requireAdmin → /login).
 *   - 404 `{ error }`                    : userId inconnu côté auth.
 *   - 409 `{ error }`                    : débit refusé (solde insuffisant / concurrence).
 *   - 500 `{ error }`                    : échec d'écriture.
 *
 * Gate : `requireAdmin()` EN TÊTE (défense en profondeur, indépendante du
 * middleware). Idempotent sur `opId` (cf tickets-admin.ts). Tracé en log.
 * Runtime edge (Cloudflare Workers).
 */
export async function POST(request: Request) {
  // ── Garde admin serveur (redirige tout non-admin avant toute action). ───────
  const admin = await requireAdmin();

  // ── Validation du corps ─────────────────────────────────────────────────────
  let body;
  try {
    const json = await request.json();
    const result = ticketsBodySchema.safeParse(json);
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

  // ── Le compte cible doit exister (on ne crédite/débite pas un id fantôme). ──
  const { exists } = await lireUtilisateur(body.userId);
  if (!exists) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  // ── Application ─────────────────────────────────────────────────────────────
  const res =
    body.sens === "credit"
      ? await crediterTickets(body)
      : await debiterTickets(body);

  // Trace (sans donnée sensible) : qui a fait quoi, sur qui.
  log.info("Admin a ajusté des tickets", {
    adminId: admin.userId,
    cibleId: body.userId,
    sens: body.sens,
    quantite: body.quantite,
    type: body.type,
    opId: body.opId,
    message: res.message,
  });

  if (!res.ok) {
    // Refus métier (solde insuffisant / concurrence) → 409 ; échec d'écriture → 500.
    const status = res.message.startsWith("Solde insuffisant") ? 409 : 500;
    return NextResponse.json({ error: res.message }, { status });
  }

  return NextResponse.json({
    ok: true,
    soldeApres: res.soldeApres,
    message: res.message,
  });
}

/** Seul POST est autorisé. */
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
