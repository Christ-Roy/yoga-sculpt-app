import { NextResponse } from "next/server";
import { scanAndSendReminders } from "@/lib/reminders";
import { markPastBookingsAttended } from "@/lib/attendance";
import { scanAndSendRelances } from "@/lib/relance";
import { drainAdsConversions } from "@/lib/ads-attribution";
import { createServiceClient } from "@/lib/supabase/service";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("cron");

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
    log.error("CRON_SECRET manquant — déclenchement refusé (503)");
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
    log.warn("Secret absent ou invalide — déclenchement rejeté (401)");
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  try {
    // Trois passes indépendantes au même tick :
    //   1. Rappels mail J-1 / H-2 (avant un cours DÉJÀ réservé).
    //   2. Émission des events booking_attended pour les séances passées
    //      (tracking timeline ; le compteur de séances reste dérivé de bookings).
    //   3. Relance des INACTIFS (rétention : ceux qui n'ont RIEN de prévu —
    //      jamais réservé / dormant / ticket dormant). cf. src/lib/relance.ts.
    // Chaque passe est best-effort et ne doit pas faire échouer les autres :
    // on isole les passes 2 et 3 dans leur propre try/catch.
    const resultat = await scanAndSendReminders();

    let attendance;
    try {
      attendance = await markPastBookingsAttended();
    } catch (attErr) {
      log.error("Passe attendance échouée (rappels OK)", {
        err: serializeError(attErr),
      });
      attendance = { marquees: 0, erreurs: 1 };
    }

    let relances;
    try {
      relances = await scanAndSendRelances();
    } catch (relErr) {
      log.error("Passe relances échouée (rappels OK)", {
        err: serializeError(relErr),
      });
      relances = {
        jamaisReserve: 0,
        dormant: 0,
        ticketDormant: 0,
        erreurs: 1,
      };
    }

    // 4. Drain des conversions Google Ads en attente (upload offline via gclid).
    //    L'écriture du journal ads_conversions est synchrone (webhook/résa/parrainage) ;
    //    l'upload réseau vers l'API Ads se fait ici, en arrière-plan, idempotent.
    let adsConversions;
    try {
      adsConversions = await drainAdsConversions(createServiceClient(), process.env);
    } catch (adsErr) {
      log.error("Passe drain Ads échouée (rappels OK)", {
        err: serializeError(adsErr),
      });
      adsConversions = { uploaded: 0, failed: 1, skipped: 0 };
    }

    return NextResponse.json({
      ok: true,
      ...resultat,
      attendance,
      relances,
      adsConversions,
    });
  } catch (err) {
    // scanAndSendReminders agrège déjà les erreurs d'envoi ; un throw ici =
    // défaillance plus profonde (client Supabase indisponible, etc.).
    log.error("Échec du passage des rappels", { err: serializeError(err) });
    return NextResponse.json(
      { ok: false, error: "Échec du traitement des rappels." },
      { status: 500 },
    );
  }
}
