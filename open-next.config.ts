// OpenNext → Cloudflare Workers config.
// Déploiement cible : app.yoga-sculpt.fr (Cloudflare Workers).
// PHASE 1 : config minimale, AUCUN déploiement effectué pour l'instant.
//
// Build local de prod (quand on déploiera) :
//   npx opennextjs-cloudflare build
//   npx wrangler deploy            (ou: npx opennextjs-cloudflare deploy)
//
// Doc : https://opennext.js.org/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Cache incrémental / tags : ajoutables plus tard (R2 / KV / D1) si besoin.
  // Laissé en défaut pour la phase 1 (app dynamique avec auth, peu de cache).
});
