import { Logo } from "@/components/Logo";
import { ConfirmClient } from "./ConfirmClient";

export const metadata = { title: "Connexion — Yoga Sculpt" };

/**
 * Page de confirmation des liens e-mail (magic-link / signup / recovery).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI UNE PAGE (et plus une route qui verifyOtp au GET) ?             │
 * │                                                                           │
 * │ Le token d'un lien e-mail est À USAGE UNIQUE. Or les liens passent par    │
 * │ le tracking de clics de Brevo (sendibt2.com/tr/cl/...) ET sont parfois    │
 * │ pré-ouverts par Gmail/antivirus/scanners. Si on consomme le token au GET, │
 * │ ce pré-clic le brûle AVANT l'utilisateur → "lien invalide".               │
 * │                                                                           │
 * │ Solution (pattern officiel Supabase anti-prefetch) : le GET affiche une   │
 * │ page avec un bouton ; le `verifyOtp` n'est déclenché qu'au CLIC HUMAIN,   │
 * │ côté client. Un bot/tracker qui charge la page ne consomme pas le token.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
    redirectTo?: string;
  }>;
}) {
  const sp = await searchParams;
  const tokenHash = sp.token_hash ?? "";
  const type = sp.type ?? "magiclink";
  const redirectTo =
    sp.redirectTo && sp.redirectTo.startsWith("/") ? sp.redirectTo : "/espace";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-5 py-10">
      <Logo title="Yoga Sculpt — confirmation" />
      <div className="mt-8 w-full max-w-sm rounded-[4px] border border-border bg-surface/60 p-8 text-center">
        <ConfirmClient
          tokenHash={tokenHash}
          type={type}
          redirectTo={redirectTo}
        />
      </div>
    </main>
  );
}
