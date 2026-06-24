import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { AuthBackground } from "@/components/AuthBackground";
import { AuthMethods } from "@/components/AuthMethods";
import FunnelGoal from "@/components/FunnelGoal";
import { createServiceClient } from "@/lib/supabase/service";
import { parrainPublicParCode, type ParrainPublic } from "@/lib/referral";
import { logEvent } from "@/lib/events";
import { sanitizeRefCode } from "@/lib/ref-code";
import { createLogger, serializeError } from "@/lib/log";

const log = createLogger("invitation");

export const metadata: Metadata = {
  title: "Vous êtes invité(e) — Yoga Sculpt",
  // Landing privée d'acquisition : pas d'intérêt à l'indexer (et elle dépend
  // d'un paramètre `?ref=`). On la garde hors index comme le reste de l'app.
  robots: { index: false, follow: false },
};

/**
 * Landing d'INVITATION — `/invitation?ref=<CODE>`.
 *
 * Route PUBLIQUE (pas d'auth requise) : c'est le 1er écran que voit un filleul
 * qui suit un lien de parrainage. Elle souhaite la bienvenue (« {Prénom} vous a
 * invité(e) à faire du yoga ! ») puis propose de s'authentifier DIRECTEMENT
 * (Google / Microsoft / magic-link) via le bloc d'auth partagé `AuthMethods`.
 * Après auth → `/auth/callback` (qui consomme le cookie `ys_ref`) → `/onboarding`.
 *
 * SÉCURITÉ / GARDE-FOUS :
 *   - Le cookie de parrainage (`ys_ref`/`ys_ref_pub`) est posé par le MIDDLEWARE
 *     sur le `?ref=` — cette page ne le re-pose PAS (écrire un cookie pendant le
 *     render lève un 500 sur Workers).
 *   - Cette page ne CRÉDITE RIEN : c'est une landing d'accueil + auth. Le crédit
 *     suit l'anti-abus existant au callback/completer (cap REFERRAL_MAX_CREDITS).
 *   - On expose le PRÉNOM + l'AVATAR + l'E-MAIL COMPLET du parrain (décision
 *     Robert 2026-06-19 : le parrain partage son lien volontairement → e-mail
 *     assumé). Lookup borné à ces 3 champs, JAMAIS de tél/id. Code inconnu /
 *     invalide → titre de repli + pas de bloc parrain, jamais d'erreur.
 *     (À surveiller : énumération de codes — cf. ticket passe-sécurité.)
 *   - L'avatar est une image DISTANTE (claim OAuth) simplement affichée :
 *     `referrerPolicy="no-referrer"`, décorative, pas de fetch serveur de l'image.
 *   - `?ref=` n'est PAS une URL → aucun risque d'open-redirect.
 *
 * Server Component. En Next 16, `searchParams` est une Promise.
 */
export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; error?: string }>;
}) {
  const { ref, error } = await searchParams;

  // Résolution des infos publiques du parrain (best-effort, borné : prénom +
  // avatar + e-mail uniquement, jamais d'autre PII).
  let parrain: ParrainPublic = { prenom: null, avatarUrl: null, email: null };
  try {
    const service = createServiceClient();
    parrain = await parrainPublicParCode(service, ref);

    // Tracking d'acquisition — best-effort, NE BLOQUE PAS le render (void).
    // On ne loggue que le code sanitisé (jamais de PII) ; null si code invalide.
    void logEvent(
      null,
      "invitation_landing_view",
      { code: sanitizeRefCode(ref), prenom_resolu: parrain.prenom !== null },
      { source: "invitation", service },
    );
  } catch (err) {
    // Page publique : un service client indisponible (env manquant) ne doit pas
    // la faire planter. On retombe sur le titre de repli, sans tracking.
    log.error("Init landing invitation échouée", { err: serializeError(err) });
  }

  const { prenom, avatarUrl, email } = parrain;
  const titre = prenom
    ? `${prenom} vous a invité(e) à faire du yoga !`
    : "Vous avez été invité(e) à faire du yoga !";
  const initiale = prenom ? prenom.charAt(0).toUpperCase() : "";

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-12">
      {/* Branche PARRAINAGE du tunnel : arrivée d'un filleul (porte d'entrée
          alternative au CTA vitrine). Goal côté tracker pour l'entonnoir analytics. */}
      <FunnelGoal action="referral_landing" />
      <AuthBackground />
      <div className="relative z-10 w-full max-w-md animate-fade-in-up">
        {/* Médaillon YS (cohérent /login + onboarding) */}
        <div className="mb-8 flex justify-center">
          <Logo showText={false} title="Yoga Sculpt — invitation" />
        </div>

        {/* Bloc PARRAIN — avatar + prénom + e-mail complet (décision Robert).
            Affiché seulement si on a résolu un parrain (prénom). Code inconnu →
            pas de bloc, on garde le titre de repli. */}
        {prenom && (
          <div
            className="mb-6 flex flex-col items-center gap-3 text-center"
            data-testid="parrain-card"
          >
            {/* Avatar médaillon (or). Taille fixe → pas de layout shift. */}
            <span
              className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2"
              style={{
                border: "1.5px solid var(--accent)",
                boxShadow:
                  "0 0 0 1px rgba(212,173,106,0.18) inset, 0 4px 14px rgba(0,0,0,0.28)",
              }}
            >
              {avatarUrl ? (
                // Image distante (claim OAuth) simplement affichée — décorative,
                // referrer masqué (Google n'exige pas de referer pour servir
                // l'avatar et on ne fuite pas l'URL de la landing).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  aria-hidden
                  referrerPolicy="no-referrer"
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                />
              ) : (
                // Fallback : initiale du prénom en or sur fond sombre.
                <span
                  aria-hidden
                  className="font-display text-2xl text-accent"
                >
                  {initiale}
                </span>
              )}
            </span>

            <div className="flex flex-col items-center">
              <span className="font-display text-lg leading-tight text-text">
                {prenom}
              </span>
              {email && (
                <span className="mt-0.5 text-sm text-text-secondary break-all">
                  {email}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Hero d'accueil chaleureux */}
        <div className="mb-6 text-center">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-accent">
            Invitation
          </p>
          <h1 className="font-display text-3xl leading-tight text-text sm:text-4xl">
            {titre}
          </h1>
          <p className="mt-4 text-base text-text-secondary">
            Le yoga, c&apos;est plus sympa entre ami(e)s{" "}
            <span aria-hidden>🧘</span>
          </p>
        </div>

        {/* Bénéfices sobres — alignés sur le discours du site (ne pas sur-promettre) */}
        <ul className="mx-auto mb-8 flex max-w-sm flex-col gap-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-accent" aria-hidden>
              ✓
            </span>
            Une première séance pour découvrir, sans engagement.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-accent" aria-hidden>
              ✓
            </span>
            Une ambiance bienveillante, à votre rythme.
          </li>
        </ul>

        {/* Carte d'auth intégrée — composant partagé avec /login */}
        <div className="rounded-[4px] border border-border bg-surface/60 p-6 backdrop-blur-sm sm:p-8">
          <h2 className="mb-1 font-display text-xl text-text">
            Créez votre compte pour commencer
          </h2>
          <p className="mb-6 text-sm text-text-secondary">
            Quelques secondes suffisent — on s&apos;occupe du reste.
          </p>

          <AuthMethods initialError={error} submitLabel="Recevoir mon lien" />
        </div>

        <p className="mt-6 text-center text-xs text-text-secondary/70">
          En continuant, vous acceptez nos conditions d&apos;utilisation.
        </p>
      </div>
    </main>
  );
}
