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
 * chaque créneau = `{ id, type, summary, starts_at, ends_at, inscrits, lieu? }`.
 * `lieu` vient du champ « Lieu » (`location`) de l'event Google d'Alice.
 *
 * ┌─ LIEU « obligatoire » (demande Robert) ──────────────────────────────────┐
 * │ Robert veut que chaque créneau ait un lieu. On ne peut pas le forcer côté │
 * │ Google Calendar (c'est Alice qui saisit). CHOIX retenu : on N'EXCLUT PAS  │
 * │ un créneau sans lieu (ne pas masquer un cours à cause d'une saisie         │
 * │ oubliée) — on le renvoie avec `lieu` absent, et l'UI affiche « Lieu à     │
 * │ confirmer » au lieu d'un lien Maps. On log juste un avertissement pour     │
 * │ qu'on repère les events à compléter. → Alice DOIT renseigner le champ      │
 * │ « Lieu » de chaque event de son agenda.                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
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
    if (!creneau) continue;
    creneaux.push(creneau);
    // Lieu manquant : on garde le créneau (cf. choix documenté en tête de
    // fichier) mais on le signale dans les logs pour qu'Alice complète l'event.
    if (!creneau.lieu) {
      console.warn(
        `[creneaux] Lieu manquant sur l'event ${creneau.id} — Alice doit renseigner le champ « Lieu » (UI affichera « Lieu à confirmer »).`,
      );
    }
  }

  return NextResponse.json({ creneaux });
}
