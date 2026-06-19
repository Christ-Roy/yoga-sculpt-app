import { test as base } from "@playwright/test";
import { e2eEnv } from "./env";
import {
  createConfirmedUser,
  sessionCookies,
  deleteUser,
  type TestUser,
} from "./supabase";

/**
 * Fixtures Playwright partagées.
 *
 *   - `testUser`     : un compte e-mail CONFIRMÉ jetable, créé avant le test et
 *                      supprimé après (cleanup auto, même en cas d'échec).
 *   - `authedContext`: injecte les cookies de session `@supabase/ssr` du testUser
 *                      dans le contexte navigateur → le test démarre AUTHENTIFIÉ
 *                      (pas de magic-link e-mail à cliquer).
 *
 * Les specs déclarent simplement `test('...', async ({ page, testUser }) => …)`
 * ou utilisent `authedContext` pour un parcours connecté.
 */

interface Fixtures {
  testUser: TestUser;
  /** Pose la session du `testUser` sur le contexte courant puis renvoie l'user. */
  loginAs: (user: TestUser) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  testUser: async ({}, use) => {
    const user = await createConfirmedUser();
    try {
      await use(user);
    } finally {
      await deleteUser(user.id);
    }
  },

  loginAs: async ({ context }, use) => {
    await use(async (user: TestUser) => {
      const cookies = await sessionCookies(user, e2eEnv.baseUrl);
      await context.addCookies(cookies);
    });
  },
});

export const expect = test.expect;
export { e2eEnv };
