import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { attendanceBodySchema, attendanceToColumn } from "../_logic";

/**
 * POST /api/admin/bookings/attendance — Alice pointe la présence d'un client
 * sur une séance (présent / absent / réinitialisation).
 *
 * Body : `{ bookingId, attendance: 'attended' | 'no_show' | 'pending' }`.
 *   - 'attended' → présent ; 'no_show' → absent ; 'pending' → réinitialise (NULL).
 *
 * Réponses :
 *   - 200 `{ ok: true, attendance }`  : pointage enregistré.
 *   - 400 `{ error }`                 : body invalide.
 *   - 404 `{ error }`                 : booking inexistant.
 *   - (401/redirect géré par requireAdmin)
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ IDEMPOTENCE — le pointage est un simple SET d'état : pointer deux fois     │
 * │ « présent » donne le même résultat. On met aussi `attendance_marked_at`    │
 * │ à NULL quand on réinitialise (cohérence d'audit).                          │
 * │                                                                            │
 * │ On NE touche PAS au `status` (confirmed/cancelled) ni au ticket : la        │
 * │ présence est orthogonale à l'annulation. Marquer un no-show ne recrédite    │
 * │ pas (la cliente a consommé son créneau en ne venant pas).                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — Cloudflare Workers (edge) : Supabase REST uniquement.
 */
export async function POST(request: Request) {
  // ── Gate admin. ─────────────────────────────────────────────────────────────
  await requireAdmin();

  // ── Validation du corps (zod, strict). ──────────────────────────────────────
  let body: { bookingId: string; attendance: "attended" | "no_show" | "pending" };
  try {
    const json = await request.json();
    const result = attendanceBodySchema.safeParse(json);
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

  const service = createServiceClient();

  // ── 1) Vérifie l'existence du booking (404 sinon). ──────────────────────────
  const { data: bookingRow, error: loadErr } = await service
    .from("bookings")
    .select("id")
    .eq("id", body.bookingId)
    .maybeSingle();

  if (loadErr) {
    console.error("[admin/attendance] Lecture du booking échouée :", loadErr.message);
    return NextResponse.json(
      { error: "Impossible de charger la réservation." },
      { status: 500 },
    );
  }
  if (!bookingRow) {
    return NextResponse.json({ error: "Réservation introuvable." }, { status: 404 });
  }

  // ── 2) Pose l'état de présence (idempotent). ────────────────────────────────
  const colValue = attendanceToColumn(body.attendance);
  const markedAt = colValue === null ? null : new Date().toISOString();

  const { error: updateErr } = await service
    .from("bookings")
    .update({ attendance: colValue, attendance_marked_at: markedAt })
    .eq("id", body.bookingId);

  if (updateErr) {
    console.error("[admin/attendance] Update présence échoué :", updateErr.message);
    return NextResponse.json(
      { error: "Enregistrement de la présence impossible." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, attendance: body.attendance });
}

// Le pointage de présence se fait uniquement en POST.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
