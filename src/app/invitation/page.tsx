import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { AuthBackground } from "@/components/AuthBackground";
import { AuthMethods } from "@/components/AuthMethods";
import { createServiceClient } from "@/lib/supabase/service";
import { prenomParrainParCode } from "@/lib/referral";
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
 *   - On n'expose QUE le prénom du parrain (lookup borné `full_name`, jamais
 *     d'e-mail/tél). Code inconnu/invalide → titre de repli, jamais d'erreur.
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

  // Résolution du prénom du parrain (best-effort, borné, jamais de PII).
  let prenom: string | null = null;
  try {
    const service = createServiceClient();
    prenom = await prenomParrainParCode(service, ref);

    // Tracking d'acquisition — best-effort, NE BLOQUE PAS le render (void).
    // On ne loggue que le code sanitisé (jamais de PII) ; null si code invalide.
    void logEvent(
      null,
      "invitation_landing_view",
      { code: sanitizeRefCode(ref), prenom_resolu: prenom !== null },
      { source: "invitation", service },
    );
  } catch (err) {
    // Page publique : un service client indisponible (env manquant) ne doit pas
    // la faire planter. On retombe sur le titre de repli, sans tracking.
    log.error("Init landing invitation échouée", { err: serializeError(err) });
  }

  const titre = prenom
    ? `${prenom} vous a invité(e) à faire du yoga !`
    : "Vous avez été invité(e) à faire du yoga !";

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-12">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-md animate-fade-in-up">
        {/* Médaillon YS (cohérent /login + onboarding) */}
        <div className="mb-8 flex justify-center">
          <Logo showText={false} title="Yoga Sculpt — invitation" />
        </div>

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
