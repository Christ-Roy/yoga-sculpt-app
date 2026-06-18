import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Config Vitest — Yoga Sculpt espace client.
 *
 * Standard CI Veridian adapté à l'app : Next 16 + Supabase + Cloudflare Workers
 * (OpenNext). Contrairement au hub (composants React testés en happy-dom), on ne
 * teste ici QUE de la logique serveur PURE : routes API (`src/app/api/**`) et
 * modules métier (`src/lib/**`). D'où l'environnement `node` (plus rapide, pas de
 * DOM simulé) et l'absence de `@vitejs/plugin-react`.
 *
 * Les globals vitest (describe/it/expect/vi) NE sont PAS exposés en global :
 * chaque test les importe explicitement depuis "vitest". Raison : le `tsconfig.json`
 * inclut `**/*.ts` (donc les tests sont typecheckés par `tsc --noEmit` en CI/pre-push).
 * Les imports explicites évitent d'avoir à ajouter `vitest/globals` aux `types` du
 * tsconfig (et donc de polluer le typage de tout le code applicatif).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["src/app/api/**", "src/lib/**"],
    },
  },
  resolve: {
    alias: {
      // Aligne sur le `paths` du tsconfig : `@/*` → `src/*`.
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
