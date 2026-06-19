import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { insertEvent } from "@/lib/google-calendar";
import { blockDaySchema } from "../lib";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("admin/creneaux/block");

/**
 * POST /api/admin/creneaux/block — bloque une journée (jour OFF).
 *
 * Body (zod, strict) : { date: "AAAA-MM-JJ", motif?: string }.
 *
 * Crée un event « journée entière » (`start.date`/`end.date`) intitulé
 * « INDISPONIBLE — <motif> ». Cet event N'EST PAS un créneau réservable : il
 * n'a ni l'heure (`dateTime`) requise par `eventVersCreneau`, ni le mot
 * « particulier » → `/api/creneaux` l'ignore de fait (les events all-day
 * tombent dans `bornEventToIso` mais l'UI cliente n'affiche que les vrais
 * créneaux ; ici l'objectif est SURTOUT visuel dans l'agenda d'Alice + un repère
 * admin pour ne pas poser de cours ce jour-là).
 *
 * NB : un event all-day a `end.date` EXCLUSIF côté Google (le lendemain).
 *
 * ┌─ CONTRAT (réponses) ──────────────────────────────────────────────────────┐
 * │ 201 { ok:true, eventId } · 400 input invalide · 401/403 requireAdmin ·      │
 * │ 502 Google KO                                                               │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Gaté par `requireAdmin()`. RUNTIME — Cloudflare Workers (edge).
 */

export const dynamic = "force-dynamic";

/** Renvoie la date « YYYY-MM-DD » du lendemain (end.date exclusif Google). */
function lendemain(ymd: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d) + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export async function POST(request: Request) {
  await requireAdmin();

  let parsed;
  try {
    const json = await request.json();
    parsed = blockDaySchema.safeParse(json);
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Requête invalide.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { date, motif } = parsed.data;
  const titre = motif ? `INDISPONIBLE — ${motif}` : "INDISPONIBLE";

  try {
    const created = await insertEvent({
      summary: titre,
      description: "Journée bloquée via l'espace admin Yoga Sculpt.",
      start: { date },
      end: { date: lendemain(date) },
    });
    return NextResponse.json({ ok: true, eventId: created.id }, { status: 201 });
  } catch (err) {
    log.error("Création event OFF échouée", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Blocage de la journée impossible." },
      { status: 502 },
    );
  }
}
