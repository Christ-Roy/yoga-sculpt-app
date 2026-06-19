import { test, expect } from "./helpers/fixtures";
import {
  seedConsumedBooking,
  bookingStatus,
  ticketRestante,
} from "./helpers/supabase";

/**
 * E2E — ANNULATION (cycle complet contre staging).
 *
 * Le trou identifié : l'annulation était couverte UNITAIREMENT (Vitest sur la
 * route /api/annuler) mais jamais bout-en-bout. Ce spec ferme le cycle :
 *
 *   1. >24h → RESTITUTION : on sème un ticket DÉJÀ CONSOMMÉ (restante=0) + un
 *      booking confirmé à +48h, on annule VIA L'UI (« Mes réservations »), et on
 *      asserte en DB (service_role) que le booking passe `cancelled` ET que le
 *      ticket est RECRÉDITÉ (quantite_restante → 1).
 *   2. <24h → REFUS : booking confirmé à +2h. La règle 24h s'applique des DEUX
 *      côtés — l'UI DÉSACTIVE le bouton « Annuler » (garde-fou client) et le
 *      serveur RENVOIE 409 `{ tooLate }` (garde-fou autoritatif). On vérifie le
 *      bouton désactivé PUIS, par un fetch direct dans le navigateur authentifié,
 *      que la route REFUSE (409) et que le ticket N'EST PAS restitué (reste 0) et
 *      le booking reste `confirmed`.
 *
 * Comme pour reservation.spec, on asserte la VÉRITÉ DB en plus de l'UI : c'est ce
 * qui prouve la restitution (ou son refus), pas juste un toast optimiste.
 *
 * Les bookings sont semés avec un google_event_id `pending-e2e-…` : la route
 * /api/annuler ignore les ids `pending-` côté Google → le test ne dépend pas de
 * l'agenda Google (on valide la vérité métier : statut booking + recrédit ticket).
 */

/** Décalage horaire en millisecondes (lisible : HOURS * h). */
const h = 60 * 60 * 1000;

test(">24h : annule via l'UI → booking cancelled + ticket RESTITUÉ", async ({
  page,
  testUser,
  loginAs,
}) => {
  // Séance dans 48h (bien au-delà du seuil 24h) → annulation autorisée.
  const { bookingId, ticketId } = await seedConsumedBooking(testUser.id, {
    type: "collectif",
    startsAt: new Date(Date.now() + 48 * h),
  });

  // État initial : booking confirmé, ticket consommé (0 restant).
  expect(await bookingStatus(bookingId)).toBe("confirmed");
  expect(await ticketRestante(ticketId)).toBe(0);

  await loginAs(testUser);
  await page.goto("/espace/reservations");
  await page.waitForLoadState("networkidle").catch(() => {});

  // La réservation est listée. Le bouton « Annuler » porte un aria-label explicite
  // « Annuler la réservation du <date> » (le label gagne sur le texte visible pour
  // l'accessible name) et est ACTIF (>24h).
  const annuler = page
    .getByRole("button", { name: /^Annuler la réservation/i })
    .first();
  await expect(annuler).toBeVisible();
  await expect(annuler).toBeEnabled();

  await annuler.click();

  // Vérité DB : le booking est annulé ET le ticket recrédité (restante → 1).
  await expect.poll(() => bookingStatus(bookingId), { timeout: 20_000 }).toBe(
    "cancelled",
  );
  await expect.poll(() => ticketRestante(ticketId), { timeout: 20_000 }).toBe(1);
});

test("<24h : annulation REFUSÉE (409) → booking confirmé + ticket NON restitué", async ({
  page,
  testUser,
  loginAs,
}) => {
  // Séance dans 2h (sous le seuil 24h) → annulation refusée des deux côtés.
  const { bookingId, ticketId } = await seedConsumedBooking(testUser.id, {
    type: "collectif",
    startsAt: new Date(Date.now() + 2 * h),
  });

  expect(await bookingStatus(bookingId)).toBe("confirmed");
  expect(await ticketRestante(ticketId)).toBe(0);

  await loginAs(testUser);
  await page.goto("/espace/reservations");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Garde-fou UI : la carte est là mais le bouton « Annuler » est DÉSACTIVÉ.
  // Quand la séance est sous le seuil, l'aria-label du bouton bascule sur
  // « Annulation impossible (moins de 24h avant la séance) ».
  const annuler = page
    .getByRole("button", { name: /Annulation impossible/i })
    .first();
  await expect(annuler).toBeVisible();
  await expect(annuler).toBeDisabled();
  await expect(
    page.getByText(/jusqu'à 24h avant/i).first(),
  ).toBeVisible();

  // Garde-fou serveur (autoritatif) : un appel DIRECT à /api/annuler — comme le
  // ferait un client qui contourne le bouton désactivé — doit renvoyer 409.
  // On l'émet DEPUIS la page (cookies de session inclus automatiquement).
  const status = await page.evaluate(async (id) => {
    const res = await fetch("/api/annuler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: id }),
    });
    return res.status;
  }, bookingId);
  expect(status).toBe(409);

  // Vérité DB : rien n'a bougé — booking toujours confirmé, ticket toujours à 0
  // (aucune restitution sous 24h). On attend un court instant pour laisser le
  // temps à un éventuel effet de bord (il ne doit PAS y en avoir).
  await page.waitForTimeout(1000);
  expect(await bookingStatus(bookingId)).toBe("confirmed");
  expect(await ticketRestante(ticketId)).toBe(0);
});
