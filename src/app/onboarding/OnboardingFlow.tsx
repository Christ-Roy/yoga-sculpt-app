"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";
import { BuyTicketButton } from "@/components/BuyTicketButton";
import { ONBOARDING_STEPS } from "@/lib/onboarding";
import { CALCOM_BOOKING_URL } from "@/lib/booking";
import { saveOnboarding } from "./actions";

type Answers = Record<string, string>;

export function OnboardingFlow({ firstName }: { firstName?: string | null }) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const total = ONBOARDING_STEPS.length;
  const step = ONBOARDING_STEPS[stepIndex];
  const isLast = stepIndex === total - 1;
  const progress = done
    ? 100
    : Math.round(((stepIndex + (answers[step.key] ? 1 : 0)) / total) * 100);

  function select(value: string) {
    setError(null);
    const next = { ...answers, [step.key]: value };
    setAnswers(next);

    if (!isLast) {
      // Petite respiration avant de passer à la question suivante.
      window.setTimeout(() => setStepIndex((i) => i + 1), 220);
    } else {
      submit(next);
    }
  }

  function submit(finalAnswers: Answers) {
    startSaving(async () => {
      const res = await saveOnboarding(finalAnswers);
      if (res.ok) {
        setDone(true);
      } else {
        setError(res.error ?? "Une erreur est survenue.");
      }
    });
  }

  function back() {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  // ───────────────────────── Écran de conclusion ─────────────────────────
  if (done) {
    return (
      <div className="w-full max-w-lg animate-fade-in-up">
        <div className="mb-8 text-center">
          <Logo className="text-xl" />
        </div>
        <div className="rounded-[4px] border border-border bg-surface/60 p-7 sm:p-9">
          <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h1 className="font-display text-3xl text-text">
            C&apos;est parti{firstName ? `, ${firstName}` : ""} !
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            Votre profil est prêt. Réservez votre première séance avec Alice,
            ou prenez un ticket pour pratiquer quand vous voulez.
          </p>

          <div className="mt-7 flex flex-col gap-3">
            <a
              href={CALCOM_BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-[4px] bg-accent px-5 py-3 text-sm font-medium tracking-wide text-[#0e0e0e] transition-colors hover:bg-accent-dark"
            >
              Réserver une première séance
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M7 17L17 7M17 7H8M17 7v9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>

            <BuyTicketButton className="w-full" />

            <Button
              variant="ghost"
              onClick={() => router.push("/espace")}
              className="w-full"
            >
              Accéder à mon espace
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ───────────────────────── Étapes du questionnaire ─────────────────────
  return (
    <div className="w-full max-w-lg">
      {/* En-tête : logo + progression */}
      <div className="mb-8">
        <div className="mb-5 flex items-center justify-between">
          <Logo className="text-lg" />
          <span className="text-xs uppercase tracking-widest text-text-secondary">
            Étape {stepIndex + 1} / {total}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
            style={{ width: `${Math.max(progress, 6)}%` }}
          />
        </div>
      </div>

      {/* Question (re-montée à chaque étape via key → animation) */}
      <div key={step.key} className="animate-fade-in-up">
        <h1 className="font-display text-2xl leading-tight text-text sm:text-3xl">
          {step.question}
        </h1>
        {step.subtitle && (
          <p className="mt-2 text-sm text-text-secondary">{step.subtitle}</p>
        )}

        <div className="mt-7 flex flex-col gap-3">
          {step.options.map((opt) => {
            const selected = answers[step.key] === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => select(opt.value)}
                disabled={saving}
                className={[
                  "group flex items-center justify-between rounded-[4px] border px-5 py-4 text-left transition-all duration-150",
                  selected
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-accent/50 hover:bg-surface-2",
                ].join(" ")}
              >
                <span>
                  <span className="block text-sm font-medium text-text">
                    {opt.label}
                  </span>
                  {opt.hint && (
                    <span className="mt-0.5 block text-xs text-text-secondary">
                      {opt.hint}
                    </span>
                  )}
                </span>
                <span
                  className={[
                    "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                    selected
                      ? "border-accent bg-accent text-[#0e0e0e]"
                      : "border-border text-transparent group-hover:border-accent/60",
                  ].join(" ")}
                  aria-hidden
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-7 flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={stepIndex === 0 || saving}
            className="text-sm text-text-secondary transition-colors hover:text-text disabled:opacity-30"
          >
            ← Retour
          </button>
          {saving && (
            <span className="text-sm text-text-secondary">Enregistrement…</span>
          )}
        </div>
      </div>
    </div>
  );
}
