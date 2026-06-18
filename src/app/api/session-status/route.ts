import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/session-status — détection d'auth CROSS-DOMAINE pour la vitrine.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI                                                                  │
 * │   Le site vitrine (https://yoga-sculpt.fr — STATIQUE, domaine séparé)     │
 * │   veut adapter ses CTA « Tarifs » selon que le visiteur est DÉJÀ connecté │
 * │   à l'espace client (https://app.yoga-sculpt.fr) :                        │
 * │     - connecté  → bouton « Prendre mon ticket » qui lance le checkout ;    │
 * │     - sinon      → CTA générique.                                          │
 * │   Comme ce sont deux origines distinctes, la LP interroge cet endpoint en │
 * │   `fetch(..., { credentials: "include" })` et il faut donc du CORS         │
 * │   avec credentials (origine reflétée — JAMAIS `*` avec credentials).      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Réponse 200 (TOUJOURS 200, même non connecté — l'auth n'est pas une erreur) :
 *   { authed: boolean, prenom?: string }
 *   `prenom` est best-effort (dérivé du profil / des metadata) pour personnaliser
 *   le bouton ; son absence ne bloque rien.
 *
 * ┌─ ⚠️ PRÉREQUIS COOKIE (le point qui conditionne que ça marche) ────────────┐
 * │ Pour que la session soit visible ici depuis un fetch lancé par             │
 * │ yoga-sculpt.fr, le cookie de session Supabase doit être ENVOYÉ en          │
 * │ cross-site. Deux façons :                                                  │
 * │   (a) cookie scopé `Domain=.yoga-sculpt.fr` → partagé apex + sous-domaine, │
 * │       envoyé aux deux sans `SameSite=None` (RECOMMANDÉ, registrable domain  │
 * │       commun) ;                                                            │
 * │   (b) sinon `SameSite=None; Secure` (cross-site générique, plus exposé).   │
 * │ Tant que le cookie reste en `SameSite=Lax` SANS `Domain` parent, ce        │
 * │ endpoint répondra `authed:false` depuis la LP (cookie non transmis). Voir  │
 * │ le ticket todo/ associé. L'endpoint, lui, est correct quoi qu'il arrive :  │
 * │ il fonctionnera dès que le cookie est correctement scopé.                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME — Cloudflare Workers (edge, via OpenNext). Comme les autres routes │
 * │ API (checkout, parrainage, creneaux), pas d'`export const runtime` : le    │
 * │ défaut OpenNext est déjà edge (fetch-only, aucun API Node).                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Origines autorisées à appeler cet endpoint avec credentials.
 *
 * Construit à partir de `NEXT_PUBLIC_SITE_URL` (apex de la vitrine, déjà présent
 * dans wrangler.jsonc / .env.example) + sa variante `www.`. On NE renvoie JAMAIS
 * `Access-Control-Allow-Origin: *` car la requête porte des credentials (cookie
 * de session) : avec credentials, `*` est interdit par la spec CORS — il faut
 * refléter l'origine exacte de l'appelant si elle est dans l'allowlist.
 */
function allowedOrigins(): Set<string> {
  const origins = new Set<string>();

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (site) {
    origins.add(site);
    // Ajoute la variante www./apex correspondante.
    try {
      const u = new URL(site);
      const host = u.host;
      if (host.startsWith("www.")) {
        origins.add(`${u.protocol}//${host.slice(4)}`);
      } else {
        origins.add(`${u.protocol}//www.${host}`);
      }
    } catch {
      // NEXT_PUBLIC_SITE_URL malformé : on garde au moins la valeur brute.
    }
  }

  // Filet de sécurité : les origines de prod connues, même si l'env manque.
  origins.add("https://yoga-sculpt.fr");
  origins.add("https://www.yoga-sculpt.fr");

  return origins;
}

/**
 * Construit les headers CORS à apposer sur TOUTE réponse (préflight + GET).
 * Si l'origine de l'appelant est dans l'allowlist, on la reflète et on autorise
 * les credentials ; sinon on n'émet aucun header `Allow-Origin` (le navigateur
 * bloquera la lecture côté LP, comportement voulu pour une origine non listée).
 * `Vary: Origin` est TOUJOURS posé pour que les caches ne mélangent pas les
 * réponses par origine.
 */
function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  headers.set("Vary", "Origin");

  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }

  return headers;
}

/**
 * Dérive un prénom affichable (best-effort) depuis le profil ou les metadata.
 * On prend le 1er mot du `full_name`. Renvoie `undefined` si rien d'exploitable.
 */
function prenomFrom(
  fullName: string | null | undefined,
): string | undefined {
  if (!fullName) return undefined;
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : undefined;
}

export async function GET(request: Request) {
  const headers = corsHeaders(request);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ authed: false }, { headers });
  }

  // ── Prénom best-effort : profil (full_name) puis metadata du provider. ─────
  // Toute erreur de lecture est avalée : `authed:true` ne doit JAMAIS dépendre
  // de la disponibilité du prénom.
  let prenom: string | undefined;
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();

    prenom =
      prenomFrom(profile?.full_name as string | null | undefined) ??
      prenomFrom(
        (user.user_metadata?.full_name ??
          user.user_metadata?.name) as string | null | undefined,
      );
  } catch {
    prenom = prenomFrom(
      (user.user_metadata?.full_name ??
        user.user_metadata?.name) as string | null | undefined,
    );
  }

  return NextResponse.json(
    prenom ? { authed: true, prenom } : { authed: true },
    { headers },
  );
}

/**
 * Préflight CORS. Le navigateur l'envoie avant un GET cross-origin avec
 * credentials. On répond 204 avec les headers CORS (origine reflétée si listée).
 */
export function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
