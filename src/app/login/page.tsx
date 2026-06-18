import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";
import { sanitizeRefCode } from "@/lib/ref-code";

export const metadata: Metadata = {
  title: "Connexion — Yoga Sculpt",
};

/**
 * Durée de vie du cookie de parrainage (30 min). Couvre largement le temps
 * d'une inscription (y compris un aller-retour OAuth Google/Microsoft) sans
 * traîner indéfiniment sur l'appareil du filleul.
 */
const REF_COOKIE_MAX_AGE = 60 * 30;

// In Next.js 16, searchParams is a Promise.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ref?: string }>;
}) {
  const { error, ref } = await searchParams;

  // ── PARRAINAGE (V2b) — capter le code `?ref=` à l'arrivée du filleul. ───────
  // Le parrain partage `https://app.yoga-sculpt.fr/login?ref=<CODE>`. On dépose
  // le code en cookie AVANT le login pour qu'il survive au flow d'auth (y
  // compris le redirect OAuth), puis soit consommé après l'inscription.
  //
  // DEUX cookies, par design (cf. /lib/ref-code.ts) :
  //   - `ys_ref`     httpOnly   → lu par le SERVEUR (auth/callback/route.ts).
  //   - `ys_ref_pub` JS-lisible → lu par le CLIENT (FingerprintCollector) pour
  //                  POST /api/parrainage/completer avec le fingerprint device.
  // Le fingerprint n'est captable que côté client : c'est la seule voie qui
  // amène l'empreinte au moment de la décision de crédit (anti-abus R3).
  const code = sanitizeRefCode(ref);
  if (code) {
    const cookieStore = await cookies();
    const isProd = process.env.NODE_ENV === "production";
    // Cookie serveur (httpOnly) — contrat existant du callback.
    cookieStore.set("ys_ref", code, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax", // requis pour survivre au redirect OAuth retour.
      path: "/",
      maxAge: REF_COOKIE_MAX_AGE,
    });
    // Cookie client (lisible JS) — porte le MÊME code jusqu'au collector.
    cookieStore.set("ys_ref_pub", code, {
      httpOnly: false,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: REF_COOKIE_MAX_AGE,
    });
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm animate-fade-in-up">
        {/* Logo */}
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="text-2xl" />
          <p className="mt-4 text-sm text-text-secondary">
            Votre espace personnel
          </p>
        </div>

        {/* Carte de connexion */}
        <div className="rounded-[4px] border border-border bg-surface/60 p-6 backdrop-blur-sm sm:p-8">
          <h1 className="mb-1 font-display text-2xl text-text">Connexion</h1>
          <p className="mb-6 text-sm text-text-secondary">
            Connectez-vous pour accéder à votre espace.
          </p>

          <LoginForm initialError={error} />
        </div>

        <p className="mt-6 text-center text-xs text-text-secondary/70">
          En continuant, vous acceptez nos conditions d&apos;utilisation.
        </p>
      </div>
    </main>
  );
}
