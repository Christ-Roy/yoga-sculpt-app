import { test, expect } from "./helpers/fixtures";

/**
 * E2E — RELAIS One Tap cross-domaine `/auth/onetap` (fix `29be158`, vague 1).
 *
 * Cette route reçoit le `credential` (id_token Google) relayé depuis le VITRINE
 * (`yoga-sculpt.fr`) et l'échange contre une session Supabase sur l'app, puis
 * redirige. Le contrat CRITIQUE remonté dans le fix : un credential
 * ABSENT / MALFORMÉ — ou un échange qui échoue (provider Google non configuré en
 * staging, token expiré, refus) — NE DOIT JAMAIS produire un 500 nu. La route
 * retombe TOUJOURS proprement sur `/login?error=...` (« au pire, login Google
 * normal sur l'app »). C'est le fallback sur lequel le vitrine compte.
 *
 * On teste ici le chemin FAIL-SAFE, qui ne requiert AUCUNE session ni secret
 * Supabase (un visiteur non connecté / un bot / un lien cassé tombe exactement
 * sur ces cas). Le flux NOMINAL (vrai id_token → session ouverte) nécessite un
 * id_token Google signé → non reproductible sans infra OAuth réelle ; il est
 * couvert par le test unitaire de forme + le smoke manuel post-déploiement.
 *
 * Playwright suit les redirects : `page.goto` rend l'URL FINALE après les 3xx.
 * On vérifie donc : URL finale = `/login`, et la réponse finale n'est pas un 5xx.
 */

const CAS_INVALIDES: { nom: string; query: string }[] = [
  { nom: "credential absent", query: "" },
  { nom: "credential vide", query: "?credential=" },
  { nom: "credential non-JWT (1 segment)", query: "?credential=pas-un-jwt" },
  {
    nom: "credential non-JWT (2 segments)",
    query: "?credential=aaa.bbb",
  },
  {
    nom: "credential avec caractères interdits",
    query: "?credential=aaa.bbb.ccc%20ddd",
  },
];

for (const { nom, query } of CAS_INVALIDES) {
  test(`/auth/onetap — ${nom} → redirige vers /login (pas de 500)`, async ({
    page,
  }) => {
    const response = await page.goto(`/auth/onetap${query}`);

    // URL finale = page de login (fallback propre).
    await expect(page).toHaveURL(/\/login/);

    // La réponse finale ne doit JAMAIS être une erreur serveur.
    expect(response).not.toBeNull();
    const status = response!.status();
    expect(status, `status final inattendu pour « ${nom} »`).toBeLessThan(500);
  });
}

test("/auth/onetap — un credential de FORME valide mais non signé → fallback /login (pas de 500)", async ({
  page,
}) => {
  // 3 segments base64url plausibles (passe le filtre de forme JWT_SHAPE) mais
  // signature/issuer invalides → `signInWithIdToken` échoue côté Supabase →
  // la route DOIT retomber sur /login, pas planter en 500.
  const faux =
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-bidon_-AZ09";
  const response = await page.goto(`/auth/onetap?credential=${faux}`);

  await expect(page).toHaveURL(/\/login/);
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
});

test("/auth/onetap — credential invalide + redirectTo hostile n'ouvre PAS d'open-redirect", async ({
  page,
}) => {
  // Même avec un redirectTo malveillant, le credential invalide route vers
  // /login AVANT toute prise en compte du redirectTo. On reste sur notre origine.
  const response = await page.goto(
    `/auth/onetap?credential=pas-un-jwt&redirectTo=${encodeURIComponent("//evil.com")}`,
  );

  await expect(page).toHaveURL(/\/login/);
  // On n'a pas quitté l'origine de l'app.
  const finalUrl = new URL(page.url());
  expect(finalUrl.host).not.toBe("evil.com");
  expect(response!.status()).toBeLessThan(500);
});
