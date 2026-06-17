import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Artefacts de build Cloudflare/OpenNext (bundle Worker généré) — ne pas
    // linter, sinon eslint parcourt du code généré (faux positifs + OOM).
    ".open-next/**",
    ".wrangler/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;
