import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { crediterParrainsApresSeanceHonoree } from "@/lib/referral";
import { attendanceBodySchema, attendanceToColumn } from "../_logic";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("admin/attendance");

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

  // ── 1) Vérifie l'existence du booking (404 sinon). On lit aussi `user_id`
  //       (filleul potentiel) et l'état d'attendance ACTUEL pour ne déclencher
  //       le crédit de parrainage QUE sur une TRANSITION vers 'attended'. ───────
  const { data: bookingRow, error: loadErr } = await service
    .from("bookings")
    .select("id, user_id, attendance")
    .eq("id", body.bookingId)
    .maybeSingle();

  if (loadErr) {
    log.error("Lecture du booking échouée", { db: loadErr.message });
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
    log.error("Update présence échoué", { db: updateErr.message });
    return NextResponse.json(
      { error: "Enregistrement de la présence impossible." },
      { status: 500 },
    );
  }

  // ── 3) ANTI-FARMING — crédit du parrainage à la 1re séance HONORÉE. ──────────
  // C'est ICI (et plus à l'inscription) que tombe le ticket du parrain : quand le
  // filleul est pointé PRÉSENT pour la 1re fois. On ne déclenche que sur une
  // TRANSITION vers 'attended' (pas si c'était déjà 'attended' → évite le travail
  // inutile ; le crédit est de toute façon idempotent via `ticket_credite`).
  // Best-effort ABSOLU : un échec de crédit ne doit jamais faire échouer le
  // pointage de présence d'Alice (la réponse reste 200).
  const previousAttendance = (bookingRow as { attendance: string | null }).attendance;
  const userId = (bookingRow as { user_id: string | null }).user_id;
  if (colValue === "attended" && previousAttendance !== "attended" && userId) {
    try {
      const credites = await crediterParrainsApresSeanceHonoree(service, userId);
      if (credites > 0) {
        log.info("Parrain(s) crédité(s) après séance honorée", {
          filleul_user_id: userId,
          booking_id: body.bookingId,
          credites,
        });
      }
    } catch (refErr) {
      // crediterParrainsApresSeanceHonoree est déjà best-effort, mais on isole
      // par sûreté : le pointage reste un succès quoi qu'il arrive.
      log.error("Crédit parrainage post-séance échoué (pointage OK)", {
        filleul_user_id: userId,
        err: serializeError(refErr),
      });
    }
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
