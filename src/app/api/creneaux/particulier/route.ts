import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { freeBusyQuery } from "@/lib/google-calendar";
import {
  genererSlotsLibres,
  PARTICULIER_HORIZON_JOURS,
  type SlotLibre,
} from "@/lib/reservation";

/**
 * GET /api/creneaux/particulier — créneaux LIBRES pour un cours particulier.
 *
 * Décision Robert 2026-06-19 : le cours particulier n'a PAS de créneaux figés.
 * Le client choisit librement entre 9h et 21h (heure de Paris), SAUF sur les
 * plages où Alice est déjà occupée. On expose donc la plage 9h-21h sur ~30
 * jours, MOINS les intervalles `busy` lus via l'API `freebusy` de Google
 * Calendar, et MOINS le passé proche (délai mini de réservation = 24h).
 *
 * Réponse : `{ slots: SlotLibre[] }` triés par début croissant, chaque slot =
 * `{ starts_at, ends_at }` (ISO 8601, durée 60 min). La réservation se fait
 * ensuite via `POST /api/reserver` avec `{ type:"particulier", startsAt }`.
 *
 * Auth : espace client privé → user connecté requis (`getUser()`).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). `fetch` Google freebusy.            │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export async function GET() {
  // ── Garde-fou auth (espace client privé). ──────────────────────────────────
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

  // ── Fenêtre de génération : maintenant → maintenant + horizon (~30 jours). ──
  const maintenant = new Date();
  const timeMin = maintenant.toISOString();
  const timeMax = new Date(
    maintenant.getTime() + PARTICULIER_HORIZON_JOURS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // ── 1) Lit les indisponibilités d'Alice (freebusy). ─────────────────────────
  // Un échec ici DOIT remonter en 502 : ouvrir tout 9h-21h alors que le
  // calendrier est illisible exposerait Alice à des doubles réservations.
  let busy;
  try {
    busy = await freeBusyQuery(timeMin, timeMax);
  } catch (err) {
    console.error("[creneaux/particulier] freebusy échoué :", err);
    return NextResponse.json(
      { error: "Impossible de charger les disponibilités." },
      { status: 502 },
    );
  }

  // ── 2) Génère les slots libres (logique pure). ──────────────────────────────
  const slots: SlotLibre[] = genererSlotsLibres({ busy, maintenant });

  return NextResponse.json({ slots });
}
