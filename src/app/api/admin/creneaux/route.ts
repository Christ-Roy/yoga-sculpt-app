import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  deleteEvent,
  getEvent,
  insertEvent,
  listEvents,
  patchEvent,
  type EventWriteBody,
} from "@/lib/google-calendar";
import {
  eventVersCreneau,
  fenetreCreneaux,
  type Creneau,
} from "@/lib/reservation";
import {
  buildEventBody,
  buildSummary,
  buildDescription,
  creneauInputSchema,
  creneauPatchSchema,
  isoFromCivil,
  validerCoherence,
  type CreneauPatch,
} from "./lib";
import { compterReservations } from "./data";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("admin/creneaux");

/**
 * /api/admin/creneaux — CRUD des créneaux dans le Google Calendar d'Alice.
 *
 * TOUTES les méthodes sont gatées par `requireAdmin()` (défense en profondeur,
 * indépendante du middleware edge — cf CVE-2025-29927). Les écritures passent
 * par les wrappers `src/lib/google-calendar.ts` (insert/patch/delete) et
 * RESPECTENT le contrat de `reservation.ts` (cf `./lib.ts`) pour que les
 * créneaux écrits soient relisibles par `/api/creneaux`.
 *
 * ┌─ CONTRAT (réponses) ──────────────────────────────────────────────────────┐
 * │ GET    → 200 { creneaux: (Creneau & { inscrits })[] }                       │
 * │ POST   → 201 { ok:true, creneau }            (créneau créé)                 │
 * │ PATCH  → 200 { ok:true, creneau, inscrits }  (créneau édité)                │
 * │ DELETE → 200 { ok:true, inscrits }           (créneau supprimé)             │
 * │         ?force=0 + inscrits>0 → 409 { error, inscrits, needsForce:true }    │
 * │ 400 input invalide · 401/403 via requireAdmin (redirect) · 404 absent ·     │
 * │ 502 Google KO                                                               │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * RUNTIME — Cloudflare Workers (edge). `fetch` Google + Supabase REST.
 */

// Page/route dynamique : données live (agenda Google), jamais mises en cache.
export const dynamic = "force-dynamic";

/** Vrai si l'erreur Google correspond à un event introuvable (404/410). */
function estIntrouvable(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return m.includes("HTTP 404") || m.includes("HTTP 410");
}

// ============================================================================
// GET — liste les créneaux à venir (avec nb d'inscrits par créneau).
// ============================================================================
export async function GET() {
  await requireAdmin();

  const { timeMin, timeMax } = fenetreCreneaux();
  let events;
  try {
    events = await listEvents({
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });
  } catch (err) {
    log.error("Lecture agenda échouée", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Impossible de charger l'agenda." },
      { status: 502 },
    );
  }

  // Compte des inscrits confirmés par créneau (best-effort, informatif).
  const creneaux: Array<Creneau> = [];
  for (const event of events) {
    let inscrits = 0;
    if (event.id) {
      try {
        inscrits = await compterReservations(event.id);
      } catch (err) {
        log.error("Comptage inscrits échoué", { err: serializeError(err) });
      }
    }
    const creneau = eventVersCreneau(event, inscrits);
    if (creneau) creneaux.push(creneau);
  }

  return NextResponse.json({ creneaux });
}

// ============================================================================
// POST — crée un créneau (date + heures civiles Paris).
// ============================================================================
export async function POST(request: Request) {
  await requireAdmin();

  let body: EventWriteBody;
  try {
    const json = await request.json();
    const parsed = creneauInputSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const coherence = validerCoherence(
      parsed.data.heureDebut,
      parsed.data.heureFin,
    );
    if (coherence) {
      return NextResponse.json({ error: coherence }, { status: 400 });
    }
    body = buildEventBody(parsed.data);
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  try {
    const created = await insertEvent(body);
    const creneau = eventVersCreneau(created, 0);
    return NextResponse.json({ ok: true, creneau }, { status: 201 });
  } catch (err) {
    log.error("Création event échouée", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Création du créneau impossible." },
      { status: 502 },
    );
  }
}

// ============================================================================
// PATCH — édite un créneau existant.
// ============================================================================
export async function PATCH(request: Request) {
  await requireAdmin();

  let parsedData: CreneauPatch;
  try {
    const json = await request.json();
    const parsed = creneauPatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: parsed.error.issues },
        { status: 400 },
      );
    }
    parsedData = parsed.data;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  // On charge l'event courant pour recomposer les champs non fournis (et pour
  // valider la cohérence horaire éventuelle après merge).
  let current;
  try {
    current = await getEvent(parsedData.eventId);
  } catch (err) {
    if (estIntrouvable(err)) {
      return NextResponse.json({ error: "Créneau introuvable." }, { status: 404 });
    }
    log.error("Lecture event échouée", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Service agenda indisponible." },
      { status: 502 },
    );
  }

  // Déduit type courant (sert si l'admin ne change pas le type mais le titre).
  const typeCourant = (current.summary ?? "").toLowerCase().includes("particulier")
    ? "particulier"
    : "collectif";
  const type = parsedData.type ?? typeCourant;

  // Recompose les bornes uniquement si date/heures fournies. On exige date +
  // 2 heures ensemble (on ne reconstruit pas une borne à partir d'une moitié
  // ambiguë de l'ISO existant — plus sûr de demander le trio complet).
  const partialBody: Partial<EventWriteBody> = {};
  if (parsedData.date || parsedData.heureDebut || parsedData.heureFin) {
    if (!parsedData.date || !parsedData.heureDebut || !parsedData.heureFin) {
      return NextResponse.json(
        {
          error:
            "Pour modifier l'horaire, fournissez date + heureDebut + heureFin ensemble.",
        },
        { status: 400 },
      );
    }
    const coherence = validerCoherence(
      parsedData.heureDebut,
      parsedData.heureFin,
    );
    if (coherence) {
      return NextResponse.json({ error: coherence }, { status: 400 });
    }
    partialBody.start = {
      dateTime: isoFromCivil(parsedData.date, parsedData.heureDebut),
      timeZone: "Europe/Paris",
    };
    partialBody.end = {
      dateTime: isoFromCivil(parsedData.date, parsedData.heureFin),
      timeZone: "Europe/Paris",
    };
  }

  // Type / titre : on re-dérive un summary cohérent avec le type.
  if (parsedData.type !== undefined || parsedData.summary !== undefined) {
    partialBody.summary = buildSummary(type, parsedData.summary);
  }
  if (parsedData.type !== undefined || parsedData.capacite !== undefined) {
    partialBody.description = buildDescription(type, parsedData.capacite ?? undefined);
  }
  if (parsedData.lieu !== undefined) {
    partialBody.location = parsedData.lieu;
  }

  if (Object.keys(partialBody).length === 0) {
    return NextResponse.json(
      { error: "Aucune modification fournie." },
      { status: 400 },
    );
  }

  try {
    const updated = await patchEvent(parsedData.eventId, partialBody);
    let inscrits = 0;
    try {
      inscrits = await compterReservations(parsedData.eventId);
    } catch {
      /* compteur informatif : ignoré si KO */
    }
    const creneau = eventVersCreneau(updated, inscrits);
    return NextResponse.json({ ok: true, creneau, inscrits });
  } catch (err) {
    if (estIntrouvable(err)) {
      return NextResponse.json({ error: "Créneau introuvable." }, { status: 404 });
    }
    log.error("Édition event échouée", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Édition du créneau impossible." },
      { status: 502 },
    );
  }
}

// ============================================================================
// DELETE — supprime un créneau (garde : prévient si des inscrits existent).
// ============================================================================
export async function DELETE(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  // `force=1` confirme la suppression malgré des inscrits.
  const force = url.searchParams.get("force") === "1";

  if (!eventId) {
    return NextResponse.json(
      { error: "Paramètre `eventId` requis." },
      { status: 400 },
    );
  }

  // GARDE : on compte les réservations confirmées sur ce créneau. S'il y en a et
  // que `force` n'est pas posé → 409 (l'UI demande confirmation avant de purger
  // un cours auquel des clientes sont inscrites).
  let inscrits = 0;
  try {
    inscrits = await compterReservations(eventId);
  } catch (err) {
    log.error("Comptage avant suppression échoué", { err: serializeError(err) });
  }

  if (inscrits > 0 && !force) {
    return NextResponse.json(
      {
        error: `Ce créneau a ${inscrits} réservation(s) confirmée(s). Confirmez la suppression.`,
        inscrits,
        needsForce: true,
      },
      { status: 409 },
    );
  }

  try {
    await deleteEvent(eventId);
    return NextResponse.json({ ok: true, inscrits });
  } catch (err) {
    if (estIntrouvable(err)) {
      // Idempotent : déjà supprimé côté Google → on considère l'opération faite.
      return NextResponse.json({ ok: true, inscrits, alreadyDeleted: true });
    }
    log.error("Suppression event échouée", { err: serializeError(err) });
    return NextResponse.json(
      { error: "Suppression du créneau impossible." },
      { status: 502 },
    );
  }
}
