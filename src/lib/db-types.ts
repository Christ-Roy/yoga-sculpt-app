/**
 * Types DB du moteur de réservation maison (tables `tickets` + `bookings`).
 * Calqués 1:1 sur `supabase/migrations/0002_booking.sql`.
 *
 * Convention dates : Supabase renvoie les `timestamptz` en chaîne ISO 8601.
 */

/** Nature d'un cours : collectif (carnet partagé, créneaux d'Alice) ou particulier. */
export type TicketType = "collectif" | "particulier";

/** Origine d'un ticket (cf colonne `tickets.source`, migration 0009). */
export type TicketSource = "welcome" | "referral" | "paid" | "admin";

/** Statut d'une réservation. */
export type BookingStatus = "confirmed" | "cancelled";

/**
 * Carnet de séances acheté via Stripe.
 * `quantite_restante` est décrémentée à chaque réservation (côté serveur / service_role).
 */
export type Ticket = {
  id: string;
  user_id: string;
  type: TicketType;
  /** Nombre de séances dans le carnet acheté. */
  quantite_initiale: number;
  /** Séances encore disponibles (>= 0, <= quantite_initiale). */
  quantite_restante: number;
  /** Checkout Session / PaymentIntent Stripe (traçabilité). */
  stripe_payment_id: string | null;
  /** Id de session Stripe pour matcher le webhook (idempotence). */
  stripe_session_id: string | null;
  /** ISO 8601. `null` = pas d'expiration. */
  expires_at: string | null;
  /**
   * Origine du ticket : `welcome` (1ère séance offerte), `referral` (parrainage),
   * `paid` (Stripe), `admin` (ajustement). `null` pour les tickets historiques
   * (colonne additive, cf migration 0009).
   */
  source: TicketSource | null;
  /** ISO 8601. */
  created_at: string;
};

/**
 * Réservation effective, liée à un event Google Calendar.
 */
export type Booking = {
  id: string;
  user_id: string;
  type: TicketType;
  /** Id de l'event créé dans Google Calendar. */
  google_event_id: string;
  /** Id du créneau source réservé (posé par Alice). `null` pour le particulier. */
  google_calendar_creneau_id: string | null;
  /** ISO 8601. */
  starts_at: string;
  /** ISO 8601. */
  ends_at: string;
  status: BookingStatus;
  /** Ticket consommé (pour recréditer à l'annulation). `null` si aucun. */
  ticket_id: string | null;
  /** ISO 8601. */
  created_at: string;
  /** ISO 8601. Renseigné quand status = 'cancelled'. */
  cancelled_at: string | null;
};
