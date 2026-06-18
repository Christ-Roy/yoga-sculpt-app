import { NextResponse } from "next/server";
import { scanAndSendReminders } from "@/lib/reminders";

/**
 * GET /api/cron — déclencheur des rappels mail automatiques (J-1 / H-2).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI UNE ROUTE HTTP (et pas le handler `scheduled` natif Cloudflare) ?│
 * │                                                                           │
 * │ Sur OpenNext (Next 16 → Cloudflare Workers), le `worker.js` GÉNÉRÉ par    │
 * │ `opennextjs-cloudflare build` expose le handler `fetch` (le routeur Next) │
 * │ et NE route PAS de façon fiable un event `scheduled` vers notre code Next.│
 * │ Brancher un handler `scheduled` natif demanderait de patcher ce worker    │
 * │ généré (régénéré à chaque build → fragile, déconseillé).                  │
 * │                                                                           │
 * │ Approche retenue (robuste, garantie) : une route HTTP protégée par un     │
 * │ secret partagé `CRON_SECRET`. Le Cron Trigger Cloudflare (déclaré dans    │
 * │ `wrangler.jsonc`, toutes les 15 min) déclenche l'exécution ; côté infra,  │
 * │ le tick appelle cette URL en passant le secret. Deux façons de brancher   │
 * │ le tick → cette route (à finaliser au déploiement) :                      │
 * │   (a) un petit Worker `scheduled` séparé qui `fetch()` cette URL avec le   │
 * │       header `x-cron-secret` (recommandé, 100% Cloudflare) ;              │
 * │   (b) un appel HTTP externe planifié (Workflows / cron système) tapant    │
 * │       `https://app.yoga-sculpt.fr/api/cron?secret=...`.                   │
 * │ La route est sûre dans les deux cas : sans secret valide → 401.           │
 * │                                                                           │
 * │ Si une version future d'OpenNext expose proprement le handler `scheduled`,│
 * │ on pourra le faire appeler `scanAndSendReminders()` directement et         │
 * │ supprimer la dépendance au secret HTTP — mais ce n'est pas garanti à ce   │
 * │ jour, donc on reste sur la route protégée.                                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ AUTH — `CRON_SECRET` (secret serveur, `wrangler secret put CRON_SECRET`). │
 * │   Accepté via le header `x-cron-secret` OU le query param `?secret=`.     │
 * │   Comparaison à temps constant. Sans secret CONFIGURÉ → 503 (fail-safe :  │
 * │   on n'envoie pas d'emails depuis un endpoint non protégé). Secret        │
 * │   absent/faux dans la requête → 401. Sinon n'importe qui pourrait         │
 * │   déclencher des envois en boucle.                                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge). Web standard only.                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

// Pas de mise en cache : ce endpoint a des effets de bord (envoi d'emails).
export const dynamic = "force-dynamic";

/** Comparaison à temps constant de deux chaînes (anti timing-attack). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;

  // Fail-safe : sans secret configuré, on REFUSE de tourner (un endpoint
  // d'envoi de masse non protégé serait une porte ouverte).
  if (!expected) {
    console.error("[cron] CRON_SECRET manquant — déclenchement refusé (503).");
    return NextResponse.json(
      { error: "Cron non configuré." },
      { status: 503 },
    );
  }

  // Secret accepté via header (préféré) ou query param (fallback déclencheur).
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-cron-secret") ??
    url.searchParams.get("secret") ??
    "";

  if (!timingSafeEqual(provided, expected)) {
    console.warn("[cron] Secret absent ou invalide — déclenchement rejeté (401).");
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  try {
    const resultat = await scanAndSendReminders();
    return NextResponse.json({ ok: true, ...resultat });
  } catch (err) {
    // scanAndSendReminders agrège déjà les erreurs d'envoi ; un throw ici =
    // défaillance plus profonde (client Supabase indisponible, etc.).
    console.error("[cron] Échec du passage des rappels :", err);
    return NextResponse.json(
      { ok: false, error: "Échec du traitement des rappels." },
      { status: 500 },
    );
  }
}
