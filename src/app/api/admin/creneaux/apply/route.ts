import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { insertEvent } from "@/lib/google-calendar";
import { eventVersCreneau } from "@/lib/reservation";
import {
  applyPresetSchema,
  buildEventBodyFromPreset,
  expanserDatesHebdo,
} from "../lib";
import { chargerPreset } from "../data";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("admin/creneaux/apply");

/**
 * POST /api/admin/creneaux/apply — applique un PRESET à une date (1..N events).
 *
 * Body (zod, strict) :
 *   { presetId, date, recurrence?: { frequence:"hebdomadaire", occurrences, jour? } }
 *
 * Effet : génère 1 event (sans récurrence) ou N events hebdomadaires consécutifs
 * (récurrence) dans le Google Calendar d'Alice, au format relisible par
 * `/api/creneaux`. La récurrence du PRESET sert de défaut si `recurrence` n'est
 * pas fourni dans le body.
 *
 * RÉCURRENCE COUVERTE (V1) : hebdomadaire (« tous les 7 jours, N fois » à partir
 * de `date`). Mensuel / quotidien : NON couverts (cf rapport).
 *
 * ┌─ CONTRAT (réponses) ──────────────────────────────────────────────────────┐
 * │ 201 { ok:true, creneaux: Creneau[], crees: n, echecs: m }                   │
 * │ 207-like : si une partie échoue, on renvoie quand même 201 avec `echecs`>0  │
 * │   (les events déjà créés ne sont PAS rollback — Alice peut les voir/éditer).│
 * │ 400 input invalide · 404 preset introuvable · 401/403 requireAdmin          │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * TOUTES les méthodes sont gatées par `requireAdmin()`.
 * RUNTIME — Cloudflare Workers (edge).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await requireAdmin();

  let parsed;
  try {
    const json = await request.json();
    parsed = applyPresetSchema.safeParse(json);
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Requête invalide.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { presetId, date, recurrence } = parsed.data;

  // Charge le preset (source des heures/lieu/type/capacité).
  let preset;
  try {
    preset = await chargerPreset(presetId);
  } catch (err) {
    log.error("Lecture preset échouée", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Impossible de charger le modèle." },
      { status: 500 },
    );
  }
  if (!preset) {
    return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  }

  // Récurrence effective : override du body, sinon celle du preset, sinon 1 occ.
  const rec = recurrence ?? preset.recurrence ?? null;
  const dates =
    rec && rec.frequence === "hebdomadaire"
      ? expanserDatesHebdo(date, rec.occurrences)
      : [date];

  // Génère les events séquentiellement (volume faible : ≤ 52). On NE rollback
  // PAS en cas d'échec partiel : un event déjà posé est visible/éditable par
  // Alice. On remonte le compte de réussites/échecs.
  const creneaux = [];
  let echecs = 0;
  for (const d of dates) {
    const body = buildEventBodyFromPreset(
      {
        type: preset.type,
        dureeMin: preset.dureeMin,
        heureDebut: preset.heureDebut,
        lieu: preset.lieu,
        capacite: preset.capacite,
        label: preset.label,
      },
      d,
    );
    try {
      const created = await insertEvent(body);
      const creneau = eventVersCreneau(created, 0);
      if (creneau) creneaux.push(creneau);
    } catch (err) {
      echecs++;
      log.error("Création event échouée", { date: d, err: serializeError(err) });
    }
  }

  // Si TOUT a échoué et qu'on devait créer au moins 1 event → 502 (pb Google).
  if (creneaux.length === 0 && dates.length > 0) {
    return NextResponse.json(
      { error: "Aucun créneau n'a pu être créé (agenda indisponible)." },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, creneaux, crees: creneaux.length, echecs },
    { status: 201 },
  );
}
