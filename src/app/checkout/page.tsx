import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

/**
 * /checkout?formule=<collectif|particulier|carte10> — point d'entrée checkout
 * « par lien », destiné au site VITRINE (yoga-sculpt.fr).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI une PAGE et pas juste l'API POST /api/checkout                    │
 * │   La vitrine est statique : ses boutons « Tarifs » ne peuvent qu'ouvrir un │
 * │   lien (GET), pas faire un POST authentifié. Cette page sert de pont :      │
 * │     - pas connecté → redirige /login?redirectTo=/checkout?formule=X        │
 * │       (après login, l'utilisateur revient ICI et le checkout repart) ;      │
 * │     - connecté     → appelle le checkout existant (POST /api/checkout) et   │
 * │       redirige vers l'URL Stripe renvoyée.                                  │
 * │   On NE DUPLIQUE PAS la logique Stripe : on réutilise /api/checkout tel     │
 * │   quel (résolution formule → price, lien user, métadonnées webhook).        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Lien que la vitrine doit utiliser (formule stable, non devinable) :
 *   https://app.yoga-sculpt.fr/checkout?formule=collectif
 *   https://app.yoga-sculpt.fr/checkout?formule=particulier
 *   https://app.yoga-sculpt.fr/checkout?formule=carte10
 *
 * Runtime edge (Cloudflare Workers) : uniquement fetch + cookies, aucun API Node.
 */

/** Formules acceptées — DOIT rester aligné sur FORMULES dans /api/checkout. */
const FORMULES = ["collectif", "particulier", "carte10"] as const;
type Formule = (typeof FORMULES)[number];

function isFormule(v: string | undefined): v is Formule {
  return !!v && (FORMULES as readonly string[]).includes(v);
}

/** Origin public (prod / staging / dev) à partir des headers de forwarding. */
async function getOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.yoga-sculpt.fr";
}

export default async function CheckoutLinkPage({
  searchParams,
}: {
  // Next.js 16 : searchParams est une Promise.
  searchParams: Promise<{ formule?: string }>;
}) {
  const { formule } = await searchParams;

  // Formule absente/inconnue → on renvoie vers l'espace réservation plutôt que
  // de planter (le lien vitrine est censé toujours porter une formule valide).
  if (!isFormule(formule)) {
    redirect("/espace/reserver");
  }

  // ── Auth : non connecté → login, puis retour sur ce même lien checkout. ────
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);

  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/checkout?formule=${formule}`)}`);
  }

  // ── Connecté : on lance le checkout existant côté serveur. On réutilise
  //    POST /api/checkout (même origine) en transmettant les cookies de session
  //    pour qu'il voie l'utilisateur connecté. Pas de duplication de logique.
  const origin = await getOrigin();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  let stripeUrl: string | undefined;
  try {
    const res = await fetch(`${origin}/api/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({ formule }),
    });
    if (res.ok) {
      const data = (await res.json()) as { url?: string };
      stripeUrl = data.url;
    } else {
      console.error(
        `[checkout/page] /api/checkout a renvoyé ${res.status} pour la formule ${formule}.`,
      );
    }
  } catch (err) {
    console.error("[checkout/page] Appel /api/checkout échoué :", err);
  }

  // Stripe OK → on saute directement sur la page de paiement.
  if (stripeUrl) {
    redirect(stripeUrl);
  }

  // Paiement indisponible (clé manquante, erreur Stripe…) → on retombe sur la
  // page de réservation de l'espace, qui sait afficher l'état « paiement bientôt
  // disponible » plutôt que de laisser l'utilisateur sur une page blanche.
  redirect("/espace/reserver?status=indisponible");
}
