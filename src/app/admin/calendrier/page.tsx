import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { listEvents } from "@/lib/google-calendar";
import {
  eventVersCreneau,
  fenetreCreneaux,
  type Creneau,
} from "@/lib/reservation";
import { listerPresets, compterReservations, type SlotPreset } from "@/app/api/admin/creneaux/data";
import { CalendrierClient } from "./CalendrierClient";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("admin/calendrier");

export const metadata: Metadata = {
  title: "Calendrier — Yoga Sculpt",
};

// Données live (agenda Google + presets) : jamais de cache statique.
export const dynamic = "force-dynamic";

/** Créneau enrichi du nombre d'inscrits (pour la garde de suppression côté UI). */
export interface CreneauAdmin extends Creneau {
  inscrits: number;
}

/**
 * Page admin « Calendrier » — gestion des créneaux d'Alice.
 *
 * Server Component : `requireAdmin()` EN TÊTE (défense en profondeur, cf
 * CVE-2025-29927) AVANT toute lecture de données. On charge en parallèle :
 *   - les créneaux à venir (events Google, source de vérité), enrichis du
 *     nombre d'inscrits confirmés (garde de suppression) ;
 *   - les presets (modèles réutilisables, table `slot_presets`).
 * Toute l'interactivité (formulaires, fetch des routes /api/admin/creneaux) vit
 * dans le composant client `CalendrierClient`.
 *
 * Tolérance aux pannes : si l'agenda Google est indisponible (clé SA absente en
 * dev, quota, réseau), la liste des créneaux est vide mais la page (et la
 * gestion des presets) reste utilisable.
 */
export default async function CalendrierAdminPage() {
  await requireAdmin();

  const [creneaux, presets] = await Promise.all([
    chargerCreneauxAdmin(),
    chargerPresets(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
      <div className="mb-8 animate-fade-in-up">
        <p className="text-sm text-text-secondary">Gestion</p>
        <h1 className="font-display text-3xl text-text">Calendrier</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Créez et gérez vos créneaux. Ils sont écrits dans votre Google Agenda
          (la source de vérité des réservations). Utilisez les modèles pour poser
          un cours récurrent en un clic.
        </p>
      </div>

      <CalendrierClient
        creneauxInitiaux={creneaux}
        presetsInitiaux={presets}
      />
    </div>
  );
}

/** Charge les créneaux à venir + leur nombre d'inscrits (dégradé si Google KO). */
async function chargerCreneauxAdmin(): Promise<CreneauAdmin[]> {
  try {
    const { timeMin, timeMax } = fenetreCreneaux();
    const events = await listEvents({
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const result: CreneauAdmin[] = [];
    for (const event of events) {
      let inscrits = 0;
      if (event.id) {
        try {
          inscrits = await compterReservations(event.id);
        } catch {
          /* compteur informatif : ignoré si KO */
        }
      }
      const creneau = eventVersCreneau(event, inscrits);
      if (creneau) result.push({ ...creneau, inscrits });
    }
    return result;
  } catch (err) {
    log.error("lecture agenda indisponible", { err: serializeError(err) });
    return [];
  }
}

/** Charge les presets (dégradé en [] si la lecture échoue). */
async function chargerPresets(): Promise<SlotPreset[]> {
  try {
    return await listerPresets();
  } catch (err) {
    log.error("lecture presets indisponible", { err: serializeError(err) });
    return [];
  }
}
