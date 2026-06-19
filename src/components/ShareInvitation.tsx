"use client";

import { useState, useSyncExternalStore } from "react";
import { Share2, Check } from "lucide-react";
import { InviteAmiForm } from "@/components/InviteAmiForm";

/**
 * ShareInvitation — bloc de partage d'une invitation de parrainage, adaptatif au
 * device. Composant client RÉUTILISABLE (page parrainage + widget dashboard, et
 * plus tard le « ticket cadeau » qui suivra la même mécanique).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ COMPORTEMENT ADAPTATIF                                                     │
 * │                                                                           │
 * │  Bouton « Partager mon lien » (visible PARTOUT) :                         │
 * │    • si le navigateur expose `navigator.share` (≈ mobiles iOS/Android) →  │
 * │      ouvre la FEUILLE DE PARTAGE NATIVE (WhatsApp, SMS, Instagram…) via   │
 * │      `navigator.share({ title, text, url })`. Bien meilleur taux de       │
 * │      conversion que l'e-mail sur le segment cible.                        │
 * │    • sinon (desktop sans Web Share) → COPIE le lien dans le presse-papier │
 * │      (`navigator.clipboard.writeText`, fallback `execCommand`) + retour   │
 * │      visuel « Lien copié ✓ ».                                             │
 * │                                                                           │
 * │  Bloc « Inviter par e-mail » (formulaire Brevo via /api/parrainage/inviter)│
 * │    • monté D'EMBLÉE sur desktop (≥ sm) — c'est la voie naturelle PC ;     │
 * │    • repliable sur mobile derrière un lien « Inviter par e-mail » (la voie │
 * │      privilégiée mobile étant le partage natif), mais TOUJOURS accessible. │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Le lien partagé est CELUI fourni par `GET /api/parrainage` (`lienParrainage`,
 * `https://app.yoga-sculpt.fr/login?ref=<code>`). On ne recrée RIEN ici.
 *
 * Tracking best-effort : à chaque partage natif réussi OU copie, on POST
 * `/api/parrainage/partage` (journalise `referral_invited` côté serveur, sans
 * créer de referral → aucun impact idempotence/anti-abus). Échec avalé.
 *
 * Charte NOIR & OR, boutons ≥ 44px, a11y (aria-live, aria-label, focus visible).
 */

const SHARE_TITLE = "Yoga Sculpt — yoga & pilates à Lyon";
const SHARE_TEXT =
  "Je t'offre une séance de Yoga Sculpt ! Crée ton compte avec mon lien :";

/** Abonnement no-op : ces capacités navigateur ne changent pas à l'exécution. */
const noSubscribe = () => () => {};

/**
 * Capacité Web Share lue via `useSyncExternalStore` : snapshot client = présence
 * de `navigator.share`, snapshot SERVEUR = `false` (dégradation « copie » sûre,
 * pas de mismatch d'hydration ni de setState-in-effect).
 */
function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
}

/**
 * Desktop (≥ 640px = breakpoint `sm` Tailwind) → le formulaire e-mail est déplié
 * d'emblée. Lu via store externe (même raison : pas de setState-in-effect, SSR=false).
 */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia("(min-width: 640px)");
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 640px)").matches,
    () => false,
  );
}

export function ShareInvitation({
  lienParrainage,
  /** Affiché après une invitation e-mail acceptée (toast côté parent). */
  onInvite,
  /** Variante compacte (widget dashboard) : titres plus discrets. */
  compact = false,
}: {
  lienParrainage: string;
  onInvite?: (email: string) => void;
  compact?: boolean;
}) {
  // Capacités navigateur lues sans effet (cf. helpers ci-dessus) : SSR → false.
  const canNativeShare = useCanNativeShare();
  const isDesktop = useIsDesktop();
  const [copie, setCopie] = useState(false);
  // Le formulaire e-mail est ouvert par défaut sur desktop ; sur mobile il est
  // replié derrière un toggle. `emailOuvertManuel` ne capture QUE l'ouverture
  // explicite de l'utilisateur (mobile) ; sinon on suit la largeur d'écran.
  const [emailOuvertManuel, setEmailOuvertManuel] = useState(false);
  const emailOuvert = isDesktop || emailOuvertManuel;

  /** Copie le lien (Clipboard API, fallback execCommand pour contextes legacy). */
  async function copierLien(): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(lienParrainage);
        return true;
      }
    } catch {
      /* on tente le fallback ci-dessous */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = lienParrainage;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  /** Tracking best-effort du geste de partage (ne bloque jamais l'UX). */
  function trackerPartage() {
    void fetch("/api/parrainage/partage", { method: "POST" }).catch(() => {
      /* best-effort : un échec de tracking ne doit rien casser */
    });
  }

  async function partager() {
    // 1) Partage natif si dispo (mobile) → feuille de partage de l'OS.
    if (canNativeShare) {
      try {
        await navigator.share({
          title: SHARE_TITLE,
          text: SHARE_TEXT,
          url: lienParrainage,
        });
        // Partagé : on track. (L'annulation utilisateur lève une AbortError →
        // on n'arrive pas ici, donc on ne track pas un partage avorté.)
        trackerPartage();
        return;
      } catch (err) {
        // AbortError = l'utilisateur a fermé la feuille → on ne fait rien.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Autre erreur (ex. NotAllowedError) → on retombe sur la copie.
      }
    }

    // 2) Fallback : copie dans le presse-papier + retour visuel.
    const ok = await copierLien();
    if (ok) {
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
      trackerPartage();
    }
  }

  const labelBouton = canNativeShare
    ? "Partager mon lien"
    : copie
      ? "Lien copié ✓"
      : "Copier mon lien";

  return (
    <div className="flex flex-col gap-4">
      {/* Bouton de partage principal — visible partout. */}
      <div>
        <button
          type="button"
          onClick={() => void partager()}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] bg-accent px-5 py-2.5 text-sm font-medium text-[#0e0e0e] transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
          aria-label={
            canNativeShare
              ? "Partager mon lien de parrainage"
              : "Copier mon lien de parrainage"
          }
        >
          {copie ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Share2 className="size-4" aria-hidden="true" />
          )}
          {labelBouton}
        </button>
        {/* Annonce lecteur d'écran : confirmation de copie sans voler le focus. */}
        <span className="sr-only" role="status" aria-live="polite">
          {copie ? "Lien copié dans le presse-papiers." : ""}
        </span>
      </div>

      {/* Inviter par e-mail (Brevo). Déplié d'emblée sur desktop ; sur mobile,
          repliable derrière un toggle (le partage natif y est privilégié). */}
      {emailOuvert ? (
        <section
          aria-labelledby={compact ? undefined : "share-email-title"}
          className="border-t border-border pt-4"
        >
          {!compact && (
            <h3
              id="share-email-title"
              className="font-display text-base text-text"
            >
              Inviter par e-mail
            </h3>
          )}
          <p className="mb-3 text-sm leading-relaxed text-text-secondary">
            Nous enverrons à votre ami une invitation avec votre lien.
          </p>
          <InviteAmiForm onInvite={onInvite} />
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setEmailOuvertManuel(true)}
          className="self-start text-sm text-accent underline-offset-2 transition-colors hover:text-accent-dark hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Plutôt inviter par e-mail
        </button>
      )}
    </div>
  );
}
