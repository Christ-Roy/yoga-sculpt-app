/**
 * Réservation & ticket séance — config centralisée.
 *
 * Cal.com : lien public de réservation d'une première séance.
 * Ticket  : "ticket séance" payant (Stripe = PHASE 2, placeholder pour l'instant).
 */

const CAL_USERNAME = process.env.CALCOM_USERNAME || "alice-cbmnu0";
const CAL_EVENT = process.env.CALCOM_EVENT_SLUG || "yoga-sculpt";

/** URL publique Cal.com (réservation d'une séance "Cours Yoga Sculpt", 60 min). */
export const CALCOM_BOOKING_URL = `https://cal.com/${CAL_USERNAME}/${CAL_EVENT}`;

/** Prix indicatif du ticket séance (affichage). Le vrai montant viendra de Stripe en phase 2. */
export const TICKET_PRICE_EUR = 25;
export const TICKET_LABEL = `Réserver une séance — ${TICKET_PRICE_EUR} €`;
