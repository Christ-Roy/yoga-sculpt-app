"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/Button";
import { createClient } from "@/lib/supabase/client";
import { safeInternalRedirect } from "@/lib/auth-redirect";
import {
  signInWithMagicLink,
  signInWithOAuth,
  type AuthState,
} from "@/app/login/actions";

/**
 * Bloc d'authentification PARTAGÉ — Google + Microsoft (OAuth) + magic-link
 * e-mail. Source UNIQUE des boutons d'auth de l'espace client : utilisé par
 * `/login` (LoginForm) ET par la landing d'invitation `/invitation`.
 *
 * Pourquoi un composant partagé ? Les deux écrans doivent offrir EXACTEMENT le
 * même contrat d'auth (mêmes actions serveur `signInWithOAuth` / `signInWithMagicLink`,
 * même callback `/auth/callback` qui consomme le cookie `ys_ref` du parrainage).
 * On factorise pour ne jamais diverger (un bouton qui marche ici mais pas là).
 *
 * Le contexte (cookie `ys_ref`/`ys_ref_pub`) est posé en amont par le middleware
 * sur `?ref=` ; ce composant n'a rien à savoir du parrainage : il authentifie,
 * point. Le crédit suit l'anti-abus au callback.
 *
 * Props :
 *   - initialError : message d'erreur OAuth à afficher au montage (ex. `?error=`
 *     renvoyé par /auth/callback sur un échec provider).
 *   - submitLabel  : libellé du bouton magic-link (personnalisable par contexte —
 *     « Recevoir le lien de connexion » sur /login, « Recevoir mon lien » ailleurs).
 */
const initialState: AuthState = {};

// Vrai logo Google officiel (G multicolore, 4 couleurs brand) — viewBox 0 0 48 48.
function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M47.532 24.552c0-1.566-.127-3.06-.366-4.5H24.48v8.515h12.96c-.558 3.006-2.255 5.552-4.806 7.262v6.038h7.774c4.546-4.186 7.124-10.354 7.124-17.315z"
      />
      <path
        fill="#34A853"
        d="M24.48 48c6.48 0 11.916-2.148 15.888-5.814l-7.774-6.038c-2.154 1.446-4.91 2.3-8.114 2.3-6.24 0-11.524-4.214-13.412-9.882H3.04v6.234C6.99 42.65 14.13 48 24.48 48z"
      />
      <path
        fill="#FBBC05"
        d="M11.068 28.566A14.43 14.43 0 0 1 10.32 24c0-1.584.27-3.12.748-4.566V13.2H3.04A23.98 23.98 0 0 0 .48 24c0 3.874.93 7.54 2.56 10.8l8.028-6.234z"
      />
      <path
        fill="#EA4335"
        d="M24.48 9.552c3.522 0 6.684 1.21 9.168 3.586l6.876-6.876C36.39 2.39 30.954 0 24.48 0 14.13 0 6.99 5.35 3.04 13.2l8.028 6.234c1.888-5.668 7.172-9.882 13.412-9.882z"
      />
    </svg>
  );
}

// Vrai logo Microsoft officiel (4 carrés rouge/vert/bleu/jaune).
function MicrosoftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 23 23"
      aria-hidden
      className="shrink-0"
    >
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  );
}

// ── Google One Tap (GSI) ──────────────────────────────────────────────────────
// client_id du projet GCP `yoga-sculpt-auth`. Surchargé par
// NEXT_PUBLIC_GOOGLE_CLIENT_ID au build (cf .env.example + workflows deploy-*).
const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "201393978914-0r5v4qnjkmh4jj6nrf6ulppscrj5me02.apps.googleusercontent.com";

const GSI_SRC = "https://accounts.google.com/gsi/client";

// Typage minimal de l'API Google Identity Services (window.google.accounts.id).
interface GoogleCredentialResponse {
  credential?: string;
}
interface GsiButtonConfig {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
}
interface GoogleIdApi {
  initialize: (config: {
    client_id: string;
    callback: (res: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    context?: string;
    ux_mode?: string;
    itp_support?: boolean;
    prompt_parent_id?: string;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  prompt: () => void;
  renderButton: (parent: HTMLElement, config: GsiButtonConfig) => void;
  cancel: () => void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

/**
 * Google One Tap pour l'espace client (auth LOCALE, cookies app).
 *
 * Contrairement au vitrine (cross-domain → relai `/auth/onetap`), ici la session
 * Supabase vit sur le MÊME domaine que cette page : on ouvre donc la session
 * DIRECTEMENT dans le callback via `signInWithIdToken({ provider:"google" })`,
 * sans relai. Au succès → navigation dure vers `safeInternalRedirect(?redirectTo,
 * "/espace")` : les Server Components re-tournent avec le cookie de session
 * fraîchement posé (et routent vers /onboarding si besoin). Le cookie `ys_ref`
 * (parrainage) est SAME-ORIGIN → il survit à la navigation sans qu'on y touche.
 *
 * RGPD/perf : le SDK GSI n'est chargé et le prompt armé qu'APRÈS une 1ʳᵉ
 * interaction (scroll/clic/touch) — pas d'invite intrusive au 1er paint.
 *
 * STAGING : Google OAuth n'est PAS configuré sur le Supabase staging →
 * `signInWithIdToken` renvoie une erreur (provider non supporté). On l'avale
 * SILENCIEUSEMENT (fallback : le bouton Google classique / le magic-link). Le One
 * Tap n'est donc réellement fonctionnel qu'en PROD.
 *
 * Aucune erreur n'est remontée à l'UI : l'échec One Tap est TOUJOURS silencieux
 * (les autres méthodes restent dispo).
 */
function useGoogleSignin(buttonRef: React.RefObject<HTMLDivElement | null>) {
  // Devient true quand le bouton GSI personnalisé est réellement rendu → on peut
  // alors masquer le bouton Google de secours (fallback OAuth classique).
  const [gsiButtonReady, setGsiButtonReady] = useState(false);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let oneTapArmed = false;

    // Callback partagé (bouton GSI ET One Tap) : ouvre la session Supabase
    // DIRECTEMENT à partir de l'id_token Google (same-origin, pas de relai).
    const handleCredential = (res: GoogleCredentialResponse) => {
      if (!res?.credential) return;
      void (async () => {
        try {
          const supabase = createClient();
          const { error } = await supabase.auth.signInWithIdToken({
            provider: "google",
            token: res.credential as string,
          });
          if (error) return; // staging / refus → fallback silencieux
          const redirectTo = new URLSearchParams(window.location.search).get(
            "redirectTo",
          );
          window.location.assign(safeInternalRedirect(redirectTo, "/espace"));
        } catch {
          // échec inattendu → fallback silencieux (autres méthodes dispo)
        }
      })();
    };

    // Initialise GSI + rend le BOUTON personnalisé tout de suite (immunisé au
    // cooldown One Tap : il s'affiche TOUJOURS). Quand l'utilisateur a une session
    // Google, Google y peint « Continuer en tant que <Nom> + photo ».
    const init = () => {
      if (cancelled) return;
      const id = window.google?.accounts?.id;
      if (!id) return;
      try {
        id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredential,
          // auto_select=true : zéro friction. Au clic de « Continuer en tant que
          // <Nom> », Google connecte DIRECTEMENT le compte affiché sans rouvrir le
          // sélecteur (et auto-connecte au chargement si 1 seul compte déjà consenti).
          // Google impose quand même un 1er écran de consentement la 1re fois (vie
          // privée, non bypassable) ; les fois suivantes c'est direct.
          auto_select: true,
          cancel_on_tap_outside: true,
          context: "signin",
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        const parent = buttonRef.current;
        if (parent) {
          parent.innerHTML = "";
          id.renderButton(parent, {
            type: "standard",
            theme: "filled_black", // le plus sobre vs la DA noir & or
            size: "large",
            text: "continue_with",
            shape: "pill",
            logo_alignment: "center",
            width: parent.offsetWidth || 320,
          });
          if (!cancelled) setGsiButtonReady(true);
        }
      } catch {
        // GSI KO (réseau/bloqueur) → le bouton de secours OAuth reste affiché.
      }
    };

    // One Tap (bulle auto) EN PLUS — armé après 1ʳᵉ interaction (RGPD/perf).
    const armOneTap = () => {
      if (oneTapArmed || cancelled) return;
      oneTapArmed = true;
      try {
        window.google?.accounts?.id?.prompt();
      } catch {
        /* la bulle ne s'affiche pas → le bouton GSI prend le relais */
      }
    };

    const loadGsi = (cb: () => void) => {
      if (window.google?.accounts?.id) return cb();
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${GSI_SRC}"]`,
      );
      if (existing) {
        existing.addEventListener("load", cb, { once: true });
        return;
      }
      const s = document.createElement("script");
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      s.addEventListener("load", cb, { once: true });
      document.head.appendChild(s);
    };

    // Le bouton se charge dès le montage (pas après interaction) : on VEUT qu'il
    // soit visible immédiatement. Le SDK GSI est petit ; sur /login c'est l'action
    // principale, le charger tout de suite est justifié (≠ vitrine où c'est différé).
    loadGsi(init);

    // One Tap : armé seulement après une 1ʳᵉ interaction.
    const events: (keyof DocumentEventMap)[] = [
      "scroll",
      "pointerdown",
      "keydown",
      "touchstart",
    ];
    const onFirst = () => {
      cleanup();
      loadGsi(armOneTap);
    };
    const cleanup = () =>
      events.forEach((e) => window.removeEventListener(e, onFirst));
    events.forEach((e) =>
      window.addEventListener(e, onFirst, { once: true, passive: true }),
    );

    return () => {
      cancelled = true;
      cleanup();
      try {
        window.google?.accounts?.id?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [buttonRef]);

  return gsiButtonReady;
}

export function AuthMethods({
  initialError,
  submitLabel = "Recevoir le lien de connexion",
}: {
  initialError?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(
    signInWithMagicLink,
    initialState,
  );
  const [oauthError, setOauthError] = useState<string | undefined>(
    initialError,
  );
  const [isOAuthPending, startOAuth] = useTransition();

  // Bouton Google Sign-In PERSONNALISÉ (GSI renderButton) : affiche « Continuer
  // en tant que <Nom> » quand le visiteur a une session Google, sinon un bouton
  // Google générique. Immunisé au cooldown du One Tap → toujours visible. Le One
  // Tap (bulle) reste armé en plus. `gsiReady` = le bouton GSI est bien rendu →
  // on masque alors le bouton OAuth de secours (sinon double bouton Google).
  const gsiButtonRef = useRef<HTMLDivElement | null>(null);
  const gsiReady = useGoogleSignin(gsiButtonRef);

  function handleOAuth(provider: "google" | "azure") {
    setOauthError(undefined);
    startOAuth(async () => {
      const res = await signInWithOAuth(provider);
      // On success the action redirects; we only get here on error.
      if (res?.error) setOauthError(res.error);
    });
  }

  const displayError = state.error ?? oauthError;

  return (
    <div className="flex flex-col gap-6">
      {/* Ancre du prompt Google One Tap (GSI y injecte son iframe). Aligné en
          haut du bloc d'auth ; vide tant que le One Tap n'est pas armé. */}
      <div id="onetap-anchor" className="flex justify-center empty:hidden" />

      {/* OAuth (Google / Microsoft) — prêts, activables côté Supabase */}
      <div className="flex flex-col gap-3">
        {/* Bouton Google PERSONNALISÉ (GSI) : « Continuer en tant que <Nom> » si
            session Google. Rendu par Google dans une iframe → on lui réserve la
            place. S'affiche toujours (pas de cooldown). */}
        <div
          ref={gsiButtonRef}
          className="flex w-full justify-center [color-scheme:light]"
          style={{ minHeight: gsiReady ? undefined : 0 }}
          aria-label="Se connecter avec Google"
        />
        {/* Bouton Google de SECOURS (OAuth redirect classique) : affiché tant que
            le bouton GSI n'est pas rendu (GSI bloqué, réseau, navigateur non
            compatible). Évite le double bouton Google une fois le GSI prêt. */}
        {!gsiReady && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOAuth("google")}
            disabled={isOAuthPending}
            className="w-full justify-center"
          >
            <span className="flex w-5 justify-center">
              <GoogleIcon />
            </span>
            Continuer avec Google
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleOAuth("azure")}
          disabled={isOAuthPending}
          className="w-full justify-center"
        >
          <span className="flex w-5 justify-center">
            <MicrosoftIcon />
          </span>
          Continuer avec Microsoft
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-widest text-text-secondary">
          ou par e-mail
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Magic link e-mail — fonctionnel dès maintenant */}
      {state.ok ? (
        <div
          className="rounded-[4px] border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text"
          role="status"
        >
          {state.message}
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <label htmlFor="email" className="sr-only">
            Adresse e-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="vous@exemple.com"
            className="w-full rounded-[4px] border border-border bg-surface px-4 py-3 text-sm text-text placeholder:text-text-secondary/70 focus:border-accent focus:outline-none"
          />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Envoi…" : submitLabel}
          </Button>
        </form>
      )}

      {displayError && (
        <p
          className="text-sm text-red-400"
          role="alert"
          aria-live="assertive"
        >
          {displayError}
        </p>
      )}
    </div>
  );
}
