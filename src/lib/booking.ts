/**
 * Réservation & ticket séance — config centralisée.
 *
 * Cal.com : lien public de réservation d'une première séance.
 * Ticket  : "ticket séance" payant (Stripe = PHASE 2, placeholder pour l'instant).
 */

const CAL_USERNAME = process.env.CALCOM_USERNAME || "alice-cbmnu0";
// 2 events Cal existent : `cours-particulier` (60€, créneaux réservables) et
// `cours-collectif` (20€, dates pas encore fixées par Alice). Défaut = particulier
// (réservable tout de suite). L'ancien slug `yoga-sculpt` n'existe plus (404).
const CAL_EVENT = process.env.CALCOM_EVENT_SLUG || "cours-particulier";

/**
 * Identifiant du lien Cal (`username/event-slug`) attendu par l'embed Cal.com
 * (`calLink="alice-cbmnu0/cours-particulier"`).
 */
export const CALCOM_LINK = `${CAL_USERNAME}/${CAL_EVENT}`;

/** URL publique Cal.com (réservation d'une séance "Cours Yoga Sculpt", 60 min). */
export const CALCOM_BOOKING_URL = `https://cal.com/${CALCOM_LINK}`;

/** Infos de profil utilisées pour pré-remplir la réservation Cal. */
export type BookingPrefill = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

/**
 * Construit la config de pré-remplissage de l'embed Cal.com à partir du profil.
 *
 * Mapping vérifié en réel (juin 2026) sur `alice-cbmnu0/cours-particulier` :
 *   - `name`  → champ "Nom complet"  (pré-remplissage OK)
 *   - `email` → champ "Email"        (pré-remplissage OK)
 *   - `attendeePhoneNumber` → champ téléphone (slug standard Cal). Le champ
 *     n'est rendu QUE s'il est activé côté Cal sur l'event ; tant qu'il ne
 *     l'est pas, la clé est simplement ignorée par Cal — donc inoffensive.
 *
 * On omet toute clé vide pour ne pas écraser un défaut Cal par une chaîne vide.
 */
export function calPrefillConfig(prefill: BookingPrefill): Record<string, string> {
  const config: Record<string, string> = {};
  const name = prefill.name?.trim();
  const email = prefill.email?.trim();
  const phone = prefill.phone?.trim();

  if (name) config.name = name;
  if (email) config.email = email;
  if (phone) config.attendeePhoneNumber = phone;

  return config;
}

/**
 * URL Cal.com pré-remplie (mêmes clés que l'embed, en query params) — utilisée
 * pour le lien "Ouvrir dans un nouvel onglet" de secours si l'embed ne charge pas.
 */
export function calBookingUrlWithPrefill(prefill: BookingPrefill): string {
  const config = calPrefillConfig(prefill);
  const params = new URLSearchParams(config).toString();
  return params ? `${CALCOM_BOOKING_URL}?${params}` : CALCOM_BOOKING_URL;
}

/** Prix indicatif du ticket séance (affichage). Le vrai montant viendra de Stripe en phase 2. */
export const TICKET_PRICE_EUR = 25;
export const TICKET_LABEL = `Réserver une séance — ${TICKET_PRICE_EUR} €`;
