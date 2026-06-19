import { test, expect } from "./helpers/fixtures";
import {
  grantTickets,
  ticketBalance,
  confirmedBookings,
} from "./helpers/supabase";

/**
 * E2E — RÉSERVATION (parcours réels contre staging).
 *
 *   - COLLECTIF : on crédite 1 ticket collectif, on voit le créneau du dimanche
 *     19h (Parc de la Tête d'Or) déjà posé dans le Google Calendar staging, on
 *     réserve → un booking est créé ET le ticket est CONSOMMÉ (vérif DB).
 *   - PARTICULIER (créneau libre) : on crédite 1 ticket particulier, on choisit
 *     un créneau horaire libre (9h-21h) et on réserve → booking créé + ticket
 *     consommé.
 *
 * On asserte la VÉRITÉ DB (service_role) en plus de l'UI : c'est ce qui prouve
 * que la réservation a réellement eu lieu (pas juste un toast optimiste).
 */

test("collectif : réserve le créneau dimanche 19h et consomme un ticket", async ({
  page,
  testUser,
  loginAs,
}) => {
  await grantTickets(testUser.id, "collectif", 1);
  await loginAs(testUser);

  await page.goto("/espace/reserver");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Le créneau collectif récurrent (dimanche 19h, Parc de la Tête d'Or) doit être
  // listé (posé dans le Google Calendar staging).
  await expect(page.getByText(/COURS COLLECTIF/i).first()).toBeVisible();
  await expect(page.getByText(/Parc de la Tête d'Or/i).first()).toBeVisible();

  expect(await confirmedBookings(testUser.id)).toBe(0);
  expect(await ticketBalance(testUser.id, "collectif")).toBe(1);

  // Réserve le premier créneau collectif proposé.
  const reserver = page
    .locator("text=COURS COLLECTIF")
    .first()
    .locator("xpath=ancestor::*[.//button][1]")
    .getByRole("button", { name: /Réserver/i })
    .first();
  // Fallback robuste : si la structure DOM diffère, on prend le 1er « Réserver ».
  const btn = (await reserver.count())
    ? reserver
    : page.getByRole("button", { name: /^Réserver$/i }).first();
  await btn.click();

  // Vérité DB : le booking est créé et le ticket consommé.
  await expect
    .poll(() => confirmedBookings(testUser.id), { timeout: 20_000 })
    .toBe(1);
  await expect
    .poll(() => ticketBalance(testUser.id, "collectif"), { timeout: 20_000 })
    .toBe(0);
});

test("particulier libre : réserve un créneau 9h-21h et consomme un ticket", async ({
  page,
  testUser,
  loginAs,
}) => {
  await grantTickets(testUser.id, "particulier", 1);
  await loginAs(testUser);

  await page.goto("/espace/reserver");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Section cours particulier : un sélecteur de jours + des slots horaires.
  await expect(page.getByText(/COURS PARTICULIER/i).first()).toBeVisible();

  expect(await confirmedBookings(testUser.id)).toBe(0);

  // Choisit un jour bien futur (au-delà des 24h mini) dans la barre de jours,
  // puis un slot horaire ENCORE LIBRE. Les onglets portent un libellé « Sam.
  // 20/06 » → on les repère par le motif date dd/mm. On vise un jour assez loin
  // (~14j) pour réduire les collisions avec d'autres bookings de la suite sur le
  // même calendrier staging partagé. Les slots déjà pris sont `disabled` (grisés)
  // → on clique le premier slot ACTIVÉ (`:not([disabled])`).
  const dayTabs = page.locator("button", { hasText: /\d{2}\/\d{2}/ });
  const tabCount = await dayTabs.count();
  test.skip(tabCount < 6, "Pas assez d'onglets de jours particulier sur staging.");
  await dayTabs.nth(Math.min(14, tabCount - 1)).click();
  await page.waitForTimeout(1000);

  // Slots horaires « 9h », « 10h », … ENCORE LIBRES (non disabled).
  const hourSlot = page
    .locator("button:not([disabled])")
    .filter({ hasText: /^\s*\d{1,2}h\s*$/ })
    .first();
  test.skip(
    (await hourSlot.count()) === 0,
    "Aucun slot horaire particulier libre sur le jour choisi (Alice occupée ?).",
  );
  await hourSlot.click();
  await page.waitForTimeout(500);

  // Un bouton de confirmation « Réserver » apparaît pour le slot choisi.
  const confirmer = page.getByRole("button", { name: /Réserver/i }).first();
  await confirmer.click();

  await expect
    .poll(() => confirmedBookings(testUser.id), { timeout: 25_000 })
    .toBe(1);
  await expect
    .poll(() => ticketBalance(testUser.id, "particulier"), { timeout: 25_000 })
    .toBe(0);
});
