import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrCreateCode } from "@/lib/referral";

/**
 * GET /api/parrainage — état du parrainage du membre connecté.
 *
 * Renvoie :
 *   - `code`     : son code de parrainage (généré/persisté à la 1re demande).
 *   - `filleuls` : la liste de SES referrals (e-mail + statut + crédité ?).
 *
 * Auth requise. Utilisé par la page /espace/parrainer (agent UI) pour afficher
 * le lien d'invitation (`https://app.yoga-sculpt.fr/login?ref=<code>`) et le
 * suivi des filleuls.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ CONTRAT (pour l'agent UI) — réponse 200 :                                │
 * │ {                                                                         │
 * │   "code": "ABCD2345",                                                     │
 * │   "filleuls": [                                                           │
 * │     { "email": "x@y.fr", "status": "completed", "ticketCredite": true,    │
 * │       "createdAt": "2026-…", "completedAt": "2026-…" },                   │
 * │     { "email": "z@y.fr", "status": "pending",   "ticketCredite": false,   │
 * │       "createdAt": "2026-…", "completedAt": null }                        │
 * │   ],                                                                      │
 * │   "ticketsGagnes": 1   // nb de filleuls ayant rapporté un ticket         │
 * │ }                                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Runtime edge (Cloudflare Workers).
 */
export async function GET() {
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

  const service = createServiceClient();

  // ── Code de parrainage (généré/persisté si absent). ─────────────────────────
  const code = await getOrCreateCode(service, user.id);
  if (!code) {
    return NextResponse.json(
      { error: "Impossible de générer votre code de parrainage." },
      { status: 500 },
    );
  }

  // ── Liste des filleuls du parrain. ──────────────────────────────────────────
  const { data: rows, error: rowsErr } = await service
    .from("referrals")
    .select("filleul_email, status, ticket_credite, created_at, completed_at")
    .eq("parrain_user_id", user.id)
    .order("created_at", { ascending: false });

  if (rowsErr) {
    console.error("[parrainage] Lecture referrals échouée :", rowsErr.message);
    return NextResponse.json(
      { error: "Impossible de charger vos filleuls." },
      { status: 500 },
    );
  }

  const filleuls = (rows ?? []).map((r) => ({
    email: r.filleul_email as string,
    status: r.status as "pending" | "completed",
    ticketCredite: Boolean(r.ticket_credite),
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
  }));
  const ticketsGagnes = filleuls.filter((f) => f.ticketCredite).length;

  return NextResponse.json({ code, filleuls, ticketsGagnes });
}
