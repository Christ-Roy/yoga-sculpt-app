import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Connexion — Yoga Sculpt",
};

// In Next.js 16, searchParams is a Promise.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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
