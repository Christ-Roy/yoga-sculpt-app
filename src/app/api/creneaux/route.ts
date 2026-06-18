import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listEvents } from "@/lib/google-calendar";
import {
  eventVersCreneau,
  fenetreCreneaux,
  type Creneau,
} from "@/lib/reservation";

/**
 * GET /api/creneaux — liste les créneaux réservables.
 *
 * Source de vérité : le Google Calendar d'Alice. Elle y pose les créneaux
 * (collectifs ET particuliers) et gère la capacité À LA MAIN (retire un créneau
 * quand c'est plein). On expose donc simplement les events FUTURS, sans calcul
 * de "places restantes" — juste le nombre d'inscrits (informatif).
 *
 * Réponse : `{ creneaux: Creneau[] }` triés par date de début croissante,
 * chaque créneau = `{ id, type, summary, starts_at, ends_at, inscrits }`.
 *
 * Auth : l'espace client est privé. On exige un user connecté (`getUser()`)
 * pour cohérence, même si la lecture des créneaux n'est pas un secret.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). `fetch` Google + PostgREST Supabase. │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export async function GET() {
  // ── Garde-fou auth (cohérence espace client privé). ────────────────────────
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

  // ── 1) Events futurs du Google Calendar sur l'horizon (~60 jours). ─────────
  const { timeMin, timeMax } = fenetreCreneaux();
  let events;
  try {
    events = await listEvents({
      timeMin,
      timeMax,
      singleEvents: true, // récurrences développées en instances individuelles
      orderBy: "startTime",
      maxResults: 250,
    });
  } catch (err) {
    console.error("[creneaux] Lecture Google Calendar échouée :", err);
    return NextResponse.json(
      { error: "Impossible de charger les créneaux." },
      { status: 502 },
    );
  }

  // ── 2) Compte des inscrits (bookings confirmés) par créneau. ───────────────
  // Une seule requête service_role (bypass RLS : on veut le total TOUS users,
  // pas seulement ceux du user courant) sur la fenêtre concernée, puis on
  // agrège en mémoire par `google_calendar_creneau_id`. Plus simple et tout
  // aussi correct qu'un group by côté PostgREST pour ce volume.
  const eventIds = events
    .map((e) => e.id)
    .filter((id): id is string => Boolean(id));

  const inscritsParCreneau = new Map<string, number>();
  if (eventIds.length > 0) {
    const service = createServiceClient();
    const { data: bookings, error } = await service
      .from("bookings")
      .select("google_calendar_creneau_id")
      .eq("status", "confirmed")
      .in("google_calendar_creneau_id", eventIds);

    if (error) {
      // On ne casse pas l'affichage des créneaux pour un simple compteur
      // informatif : on log et on continue avec `inscrits = 0`.
      console.error("[creneaux] Comptage des inscrits échoué :", error.message);
    } else {
      for (const b of bookings ?? []) {
        const cid = b.google_calendar_creneau_id;
        if (!cid) continue;
        inscritsParCreneau.set(cid, (inscritsParCreneau.get(cid) ?? 0) + 1);
      }
    }
  }

  // ── 3) Mapping event → créneau exposable (filtre les events inexploitables). ─
  const creneaux: Creneau[] = [];
  for (const event of events) {
    const inscrits = event.id ? (inscritsParCreneau.get(event.id) ?? 0) : 0;
    const creneau = eventVersCreneau(event, inscrits);
    if (creneau) creneaux.push(creneau);
  }

  return NextResponse.json({ creneaux });
}
