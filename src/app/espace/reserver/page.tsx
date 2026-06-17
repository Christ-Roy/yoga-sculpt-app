import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { CALCOM_BOOKING_URL, TICKET_PRICE_EUR } from "@/lib/booking";

export const metadata: Metadata = {
  title: "Réserver un ticket — Yoga Sculpt",
};

export default async function ReserverPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const userLabel = profile?.full_name || profile?.email || user.email || "";

  return (
    <>
      <AppHeader userLabel={userLabel} />

      <main className="mx-auto max-w-2xl px-5 py-10">
        <Link
          href="/espace"
          className="text-sm text-text-secondary transition-colors hover:text-text"
        >
          ← Retour à mon espace
        </Link>

        <div className="mt-6 rounded-[4px] border border-border bg-surface/60 p-7 sm:p-9 animate-fade-in-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs uppercase tracking-widest text-accent">
            Bientôt disponible
          </span>

          <h1 className="mt-5 font-display text-3xl text-text">
            Ticket séance — {TICKET_PRICE_EUR} €
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            Le paiement en ligne des tickets de séance arrive très bientôt.
            En attendant, vous pouvez réserver directement une séance avec
            Alice via le calendrier.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a
              href={CALCOM_BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-[4px] bg-accent px-5 py-3 text-sm font-medium tracking-wide text-[#0e0e0e] transition-colors hover:bg-accent-dark"
            >
              Réserver une séance maintenant
            </a>
            <Link
              href="/espace"
              className="inline-flex items-center justify-center rounded-[4px] border border-border bg-surface px-5 py-3 text-sm font-medium tracking-wide text-text transition-colors hover:border-accent/60 hover:bg-surface-2"
            >
              Plus tard
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
