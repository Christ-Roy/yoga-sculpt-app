import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { presetInputSchema } from "../lib";
import {
  creerPreset,
  listerPresets,
  majPreset,
  supprimerPreset,
} from "../data";

/**
 * /api/admin/creneaux/presets — CRUD des PRESETS (modèles de créneaux).
 *
 * Un preset persiste un modèle réutilisable (« Collectif vendredi 18h · Tête
 * d'Or · 8 places ») éditable par Alice. L'APPLICATION d'un preset à une date
 * (→ écriture d'event Google) se fait via la sous-route `./apply`.
 *
 * TOUTES les méthodes sont gatées par `requireAdmin()`. Stockage via
 * `service_role` (RLS deny-all, cf migration 0007).
 *
 * ┌─ CONTRAT (réponses) ──────────────────────────────────────────────────────┐
 * │ GET    → 200 { presets: SlotPreset[] }                                      │
 * │ POST   → 201 { ok:true, preset }                                            │
 * │ PATCH  → 200 { ok:true, preset }  | 404 si introuvable                      │
 * │ DELETE → 200 { ok:true }          (idempotent)                              │
 * │ 400 input invalide · 401/403 via requireAdmin (redirect)                    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — Cloudflare Workers (edge).
 */

export const dynamic = "force-dynamic";

// ============================================================================
// GET — liste les presets.
// ============================================================================
export async function GET() {
  await requireAdmin();
  try {
    const presets = await listerPresets();
    return NextResponse.json({ presets });
  } catch (err) {
    console.error("[admin/creneaux/presets] Lecture échouée :", err);
    return NextResponse.json(
      { error: "Impossible de charger les modèles." },
      { status: 500 },
    );
  }
}

// ============================================================================
// POST — crée un preset.
// ============================================================================
export async function POST(request: Request) {
  const admin = await requireAdmin();

  let parsed;
  try {
    const json = await request.json();
    parsed = presetInputSchema.safeParse(json);
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Requête invalide.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;
  try {
    const preset = await creerPreset(
      {
        label: d.label,
        type: d.type,
        dureeMin: d.dureeMin,
        heureDebut: d.heureDebut,
        lieu: d.lieu,
        capacite: d.capacite ?? null,
        recurrence: d.recurrence ?? null,
      },
      admin.userId,
    );
    return NextResponse.json({ ok: true, preset }, { status: 201 });
  } catch (err) {
    console.error("[admin/creneaux/presets] Création échouée :", err);
    return NextResponse.json(
      { error: "Création du modèle impossible." },
      { status: 500 },
    );
  }
}

// ============================================================================
// PATCH — édite un preset (body : { id, ...champs }).
// ============================================================================
export async function PATCH(request: Request) {
  await requireAdmin();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  // L'`id` est requis ; le reste = champs du preset (validés par le même schéma).
  const obj = (raw ?? {}) as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== "string" || id.length === 0) {
    return NextResponse.json({ error: "`id` requis." }, { status: 400 });
  }
  // On exclut `id` des champs validés (le schéma preset est strict et n'a pas
  // d'`id`) sans introduire de variable inutilisée.
  const champs: Record<string, unknown> = { ...obj };
  delete champs.id;
  const parsed = presetInputSchema.partial().strict().safeParse(champs);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Requête invalide.", details: parsed.error.issues },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: "Aucune modification fournie." },
      { status: 400 },
    );
  }

  try {
    const preset = await majPreset(id, {
      label: parsed.data.label,
      type: parsed.data.type,
      dureeMin: parsed.data.dureeMin,
      heureDebut: parsed.data.heureDebut,
      lieu: parsed.data.lieu,
      capacite: parsed.data.capacite === undefined ? undefined : parsed.data.capacite,
      recurrence: parsed.data.recurrence === undefined ? undefined : parsed.data.recurrence,
    });
    if (!preset) {
      return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, preset });
  } catch (err) {
    console.error("[admin/creneaux/presets] Édition échouée :", err);
    return NextResponse.json(
      { error: "Édition du modèle impossible." },
      { status: 500 },
    );
  }
}

// ============================================================================
// DELETE — supprime un preset (?id=...). Idempotent.
// ============================================================================
export async function DELETE(request: Request) {
  await requireAdmin();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Paramètre `id` requis." }, { status: 400 });
  }
  try {
    await supprimerPreset(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/creneaux/presets] Suppression échouée :", err);
    return NextResponse.json(
      { error: "Suppression du modèle impossible." },
      { status: 500 },
    );
  }
}
