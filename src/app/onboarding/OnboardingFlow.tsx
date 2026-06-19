"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dumbbell,
  Wind,
  Leaf,
  Sparkles,
  Sprout,
  TrendingUp,
  Award,
  Calendar,
  CalendarDays,
  CalendarHeart,
  CalendarRange,
  Sunrise,
  Sun,
  Sunset,
  Shuffle,
  User,
  Users,
  Heart,
  Gift,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";
import { ShareInvitation } from "@/components/ShareInvitation";
import { TicketIcon } from "@/components/TicketIcon";
import { ONBOARDING_STEPS, type OnboardingDraft } from "@/lib/onboarding";
import { saveOnboarding, saveOnboardingProgress } from "./actions";

/** Mapping nom d'icône (lib/onboarding) → composant lucide. */
const ICONS: Record<string, LucideIcon> = {
  Dumbbell,
  Wind,
  Leaf,
  Sparkles,
  Sprout,
  TrendingUp,
  Award,
  Calendar,
  CalendarDays,
  CalendarHeart,
  CalendarRange,
  Sunrise,
  Sun,
  Sunset,
  Shuffle,
  User,
  Users,
  Heart,
};

type Answers = Record<string, string>;

/** Infos de profil transmises à l'écran de fin d'onboarding (pré-remplissage). */
type BookingPrefill = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

/** Réponses (state) reconstruites depuis un brouillon de reprise. */
function answersFromDraft(draft?: OnboardingDraft | null): Answers {
  const a: Answers = {};
  if (!draft) return a;
  for (const key of ["goal", "level", "availability", "format"] as const) {
    const v = draft[key];
    if (v) a[key] = v;
  }
  return a;
}

export function OnboardingFlow({
  firstName,
  prefill,
  initialDraft,
  invitedBy,
}: {
  firstName?: string | null;
  prefill: BookingPrefill;
  /** Brouillon de reprise chargé côté serveur (profiles.onboarding_draft). */
  initialDraft?: OnboardingDraft | null;
  /**
   * Prénom du parrain (si le filleul est arrivé via un lien d'invitation,
   * cookie `ys_ref_pub` re-résolu côté serveur). Affiché en rappel discret en
   * tête de l'onboarding. `null`/absent → pas de badge (parcours normal).
   */
  invitedBy?: string | null;
}) {
  const router = useRouter();
  // Index de la question courante — repris du brouillon (déjà borné côté serveur).
  const [stepIndex, setStepIndex] = useState(
    () => initialDraft?.stepIndex ?? 0,
  );
  const [answers, setAnswers] = useState<Answers>(() =>
    answersFromDraft(initialDraft),
  );
  // phase du flow : "questions" (étapes 1-4) → "invite" (5) → "final" (6).
  const [phase, setPhase] = useState<"questions" | "invite" | "final">(
    () => initialDraft?.phase ?? "questions",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  // Lien d'invitation (parrainage) récupéré une fois les questions terminées.
  const [lienParrainage, setLienParrainage] = useState<string | null>(null);

  useEffect(() => {
    if (phase === "questions") return;
    let annule = false;
    fetch("/api/parrainage", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!annule && d?.lienParrainage) setLienParrainage(d.lienParrainage);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [phase]);

  const nbQuestions = ONBOARDING_STEPS.length; // 4
  const TOTAL_ETAPES = nbQuestions + 2; // 4 questions + invite + final = 6
  // Borne l'index dans le tableau : évite `step` undefined → crash `step.key`.
  const safeIndex = Math.min(Math.max(stepIndex, 0), nbQuestions - 1);
  const step = ONBOARDING_STEPS[safeIndex];
  const isLastQuestion = safeIndex === nbQuestions - 1;

  // Numéro d'étape affiché (1..6) + progression.
  const etapeAffichee =
    phase === "questions"
      ? safeIndex + 1
      : phase === "invite"
        ? nbQuestions + 1 // 5
        : TOTAL_ETAPES; // 6
  const progress = Math.round((etapeAffichee / TOTAL_ETAPES) * 100);

  /**
   * Sauvegarde BEST-EFFORT du brouillon (reprise). Fire-and-forget : on n'attend
   * jamais le résultat, on avale toute erreur — la reprise est un confort, pas un
   * bloquant de l'UX.
   */
  function persistDraft(draft: OnboardingDraft) {
    void saveOnboardingProgress(draft).catch(() => {});
  }

  function select(value: string) {
    setError(null);
    const next = { ...answers, [step.key]: value };
    setAnswers(next);

    if (!isLastQuestion) {
      // Petite respiration avant de passer à la question suivante.
      const nextStep = safeIndex + 1;
      persistDraft({ ...next, phase: "questions", stepIndex: nextStep });
      window.setTimeout(() => setStepIndex((i) => i + 1), 220);
    } else {
      // Dernière question : on persiste avant la soumission finale (au cas où
      // saveOnboarding échouerait, la réponse n'est pas perdue).
      persistDraft({ ...next, phase: "questions", stepIndex: safeIndex });
      submit(next);
    }
  }

  function submit(finalAnswers: Answers) {
    // Garde-fou : on ne soumet QUE si les 4 réponses sont présentes. Si une
    // manque, on renvoie l'utilisateur sur la 1re étape non répondue.
    const manquante = ONBOARDING_STEPS.findIndex(
      (s) => !finalAnswers[s.key],
    );
    if (manquante !== -1) {
      setStepIndex(manquante);
      return;
    }
    startSaving(async () => {
      const res = await saveOnboarding(finalAnswers);
      if (res.ok) {
        // saveOnboarding a nettoyé le brouillon (onboarding_completed=true) :
        // on ne re-persiste PAS de draft ici, on avance juste l'écran.
        setPhase("invite"); // → étape 5 : inviter un ami
      } else {
        setError(res.error ?? "Une erreur est survenue.");
      }
    });
  }

  /** Passage à l'écran final (parrainage → "C'est parti"). */
  function goToFinal() {
    setPhase("final");
  }

  function back() {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  // En-tête commun (logo + barre de progression + "Étape X / 6").
  const Header = (
    <div className="mb-6 sm:mb-8">
      <div className="mb-4 flex items-center justify-between sm:mb-5">
        <Logo title="Yoga Sculpt — onboarding" />
        <span className="text-xs uppercase tracking-widest text-text-secondary">
          Étape {etapeAffichee} / {TOTAL_ETAPES}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${Math.max(progress, 6)}%` }}
        />
      </div>
    </div>
  );

  // Rappel discret du contexte d'invitation (parrainage), si présent. Purement
  // informatif — ne change RIEN au flow 6 étapes ni à la reprise du brouillon.
  const InviteBadge = invitedBy ? (
    <div className="mb-5 flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-text-secondary">
      <Gift className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.7} aria-hidden />
      <span>
        Invité(e) par <span className="text-accent">{invitedBy}</span>
      </span>
    </div>
  ) : null;

  // ───────────────── Étape 5 : Inviter un(e) ami(e) (page dédiée) ───────────
  if (phase === "invite") {
    return (
      <div className="w-full max-w-lg sm:max-w-2xl animate-fade-in-up">
        {Header}
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent sm:h-12 sm:w-12">
            <Gift className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.7} aria-hidden />
          </span>
          <h1 className="font-display text-2xl text-text sm:text-4xl">
            Parrainez vos ami(e)s
          </h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:mt-4 sm:text-base">
          <span className="text-accent">
            Gagnez une séance gratuite pour chaque ami(e) qui crée son compte
          </span>{" "}
          avec votre lien — jusqu&apos;à{" "}
          <span className="text-accent">3 séances offertes</span>. Le yoga,
          c&apos;est plus sympa entre ami(e)s&nbsp;!
        </p>

        {/* Les 3 tickets à gagner (mini-tickets sur une ligne) */}
        <div className="mt-4 flex items-center gap-2 sm:mt-5">
          {[0, 1, 2].map((i) => (
            <TicketIcon key={i} type="collectif" />
          ))}
          <span className="ml-1 text-sm text-text-secondary">
            3 séances à gagner
          </span>
        </div>

        <div className="mt-5 sm:mt-7">
          {lienParrainage ? (
            <ShareInvitation lienParrainage={lienParrainage} />
          ) : (
            <p className="text-sm text-text-secondary">
              Préparation de votre lien d&apos;invitation…
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:mt-8">
          <Button onClick={goToFinal} className="w-full">
            Continuer
          </Button>
          <button
            type="button"
            onClick={goToFinal}
            className="text-sm text-text-secondary transition-colors hover:text-text"
          >
            Plus tard
          </button>
        </div>
      </div>
    );
  }

  // ───────────────── Étape 6 : C'est parti — accéder / prendre un ticket ────
  if (phase === "final") {
    return (
      <div className="w-full max-w-lg sm:max-w-2xl animate-fade-in-up">
        {Header}
        <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent sm:mb-6 sm:h-12 sm:w-12">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="font-display text-2xl text-text sm:text-4xl">
          C&apos;est parti{firstName ? `, ${firstName}` : ""} !
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary sm:mt-3 sm:text-base">
          Votre profil est prêt. Prenez votre premier ticket pour réserver une
          séance, ou explorez votre espace.
        </p>

        {/* Prendre un ticket → Stripe (collectif ou particulier) */}
        <div className="mt-5 grid gap-3 sm:mt-7 sm:grid-cols-2">
          <a
            href="/checkout?formule=collectif"
            className="group flex items-center justify-between rounded-[4px] border border-accent bg-accent/10 px-5 py-4 transition-colors hover:bg-accent/15"
          >
            <span>
              <span className="block font-display text-lg text-text">
                Ticket collectif
              </span>
              <span className="text-xs text-text-secondary">Cours en groupe</span>
            </span>
            <span className="font-display text-2xl text-accent">20€</span>
          </a>
          <a
            href="/checkout?formule=particulier"
            className="group flex items-center justify-between rounded-[4px] border border-border bg-surface px-5 py-4 transition-colors hover:border-accent/60"
          >
            <span>
              <span className="block font-display text-lg text-text">
                Ticket particulier
              </span>
              <span className="text-xs text-text-secondary">Séance privée</span>
            </span>
            <span className="font-display text-2xl text-accent">60€</span>
          </a>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:mt-6">
          <Button
            variant="ghost"
            onClick={() => router.push("/espace")}
            className="w-full"
          >
            Accéder à mon espace
          </Button>
        </div>
      </div>
    );
  }

  // ───────────────────────── Étapes du questionnaire ─────────────────────
  return (
    <div className="w-full max-w-lg sm:max-w-2xl lg:max-w-3xl">
      {Header}
      {InviteBadge}

      {/* Question (re-montée à chaque étape via key → animation) */}
      <div key={step.key} className="animate-fade-in-up">
        <h1 className="font-display text-2xl leading-tight text-text sm:text-4xl lg:text-5xl">
          {step.question}
        </h1>
        {step.subtitle && (
          <p className="mt-2 text-sm text-text-secondary sm:mt-3 sm:text-base">
            {step.subtitle}
          </p>
        )}

        {step.layout === "split" ? (
          <SplitOptions
            options={step.options}
            selectedValue={answers[step.key]}
            disabled={saving}
            onSelect={select}
          />
        ) : (
        <div className="mt-6 flex flex-col gap-2.5 sm:mt-10 sm:gap-4">
          {step.options.map((opt) => {
            const selected = answers[step.key] === opt.value;
            const Icon = ICONS[opt.icon];
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => select(opt.value)}
                disabled={saving}
                className={[
                  "group flex items-center justify-between rounded-[4px] border px-4 py-3 text-left transition-all duration-150 sm:px-7 sm:py-6",
                  selected
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-accent/50 hover:bg-surface-2",
                ].join(" ")}
              >
                <span className="flex items-center gap-3.5 sm:gap-5">
                  {/* Icône illustrant le choix */}
                  <span
                    className={[
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border transition-colors sm:h-14 sm:w-14",
                      selected
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-border bg-surface-2 text-text-secondary group-hover:border-accent/40 group-hover:text-accent",
                    ].join(" ")}
                    aria-hidden
                  >
                    {Icon ? <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.6} /> : null}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-text sm:text-lg">
                      {opt.label}
                    </span>
                    {opt.hint && (
                      <span className="mt-0.5 block text-xs text-text-secondary sm:mt-1 sm:text-sm">
                        {opt.hint}
                      </span>
                    )}
                  </span>
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
        )}

        {error && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between sm:mt-7">
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

/* ───────────────────── Layout "split" (choix du format de cours) ─────────────
 * 2 grandes cartes-images côte à côte (gauche/droite) avec le texte par-dessus,
 * + l'option centrale ("Les deux !") en pleine largeur dessous. */
type SplitOption = {
  value: string;
  label: string;
  hint?: string;
  icon: string;
  image?: string;
};

function SplitOptions({
  options,
  selectedValue,
  disabled,
  onSelect,
}: {
  options: SplitOption[];
  selectedValue?: string;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const withImage = options.filter((o) => o.image);
  const center = options.find((o) => !o.image);

  return (
    <div className="mt-6 flex flex-col gap-3 sm:mt-10 sm:gap-4">
      {/* 2 grandes images gauche / droite. Sur mobile : ratio paysage (1 ligne
          de 2 cartes côte à côte) pour que tout tienne sans scroll ; desktop :
          portrait comme avant. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {withImage.map((opt) => {
          const selected = selectedValue === opt.value;
          const Icon = ICONS[opt.icon];
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              disabled={disabled}
              className={[
                "group relative flex aspect-[3/4] sm:aspect-[3/4] flex-col justify-end overflow-hidden rounded-[6px] border text-left transition-all duration-200",
                selected
                  ? "border-accent ring-2 ring-accent/40"
                  : "border-border hover:border-accent/60",
              ].join(" ")}
            >
              {/* image de fond N&B, couleur révélée au hover */}
              {opt.image && (
                <img
                  src={opt.image}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover grayscale transition-all duration-500 group-hover:grayscale-0 group-hover:scale-[1.03]"
                  loading="lazy"
                />
              )}
              {/* voile sombre pour la lisibilité du texte */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to top, rgba(8,8,8,0.92) 0%, rgba(8,8,8,0.45) 45%, rgba(8,8,8,0.12) 100%)",
                }}
                aria-hidden
              />
              {/* badge sélection */}
              {selected && (
                <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[#0e0e0e]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              {/* texte par-dessus */}
              <div className="relative z-10 p-3.5 sm:p-6">
                {/* icône décorative : masquée sur mobile (cartes étroites en 2
                    colonnes), réaffichée en desktop. */}
                {Icon && (
                  <span className="mb-3 hidden h-10 w-10 items-center justify-center rounded-[4px] border border-accent/50 bg-[#0e0e0e]/50 text-accent backdrop-blur-sm sm:inline-flex">
                    <Icon className="h-5 w-5" strokeWidth={1.6} />
                  </span>
                )}
                <span className="block font-display text-lg leading-tight text-text sm:text-3xl">
                  {opt.label}
                </span>
                {opt.hint && (
                  <span className="mt-1 block text-xs text-text-secondary sm:text-sm">
                    {opt.hint}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* option centrale "Les deux !" en pleine largeur */}
      {center && (() => {
        const selected = selectedValue === center.value;
        const Icon = ICONS[center.icon];
        return (
          <button
            type="button"
            onClick={() => onSelect(center.value)}
            disabled={disabled}
            className={[
              "group flex items-center justify-center gap-3 rounded-[6px] border px-5 py-3.5 text-center transition-all duration-150 sm:px-6 sm:py-5",
              selected
                ? "border-accent bg-accent/10"
                : "border-border bg-surface hover:border-accent/60 hover:bg-surface-2",
            ].join(" ")}
          >
            {Icon && (
              <Icon
                className={selected ? "h-5 w-5 text-accent" : "h-5 w-5 text-text-secondary group-hover:text-accent"}
                strokeWidth={1.7}
              />
            )}
            <span className="font-display text-lg text-text sm:text-xl">{center.label}</span>
            {center.hint && (
              <span className="hidden text-sm text-text-secondary sm:inline">— {center.hint}</span>
            )}
          </button>
        );
      })()}
    </div>
  );
}
