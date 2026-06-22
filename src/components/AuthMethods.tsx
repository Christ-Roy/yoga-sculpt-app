"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/Button";
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
 * ⚠️ POURQUOI on NE fait PLUS `signInWithIdToken` côté CLIENT ici (fix 2026-06-22)
 * ──────────────────────────────────────────────────────────────────────────────
 * Symptôme : sur iPhone, la bulle One Tap s'affichait sur `/login` MAIS au clic
 * l'utilisateur n'était PAS connecté (restait dehors / re-bounce vers /login),
 * ALORS QUE le One Tap du VITRINE marchait sur le même iPhone.
 *
 * Cause : Safari/Chrome iOS appliquent l'Intelligent Tracking Prevention (ITP).
 * Sous ITP, `supabase.auth.signInWithIdToken(...)` exécuté DANS LE NAVIGATEUR
 * (createClient browser) n'arrive pas à persister fiablement les cookies de
 * session → l'appel paraît OK mais la navigation suivante n'a pas de session.
 * Le VITRINE, lui, ne fait jamais ça : il RELAIE le credential vers la route
 * SERVEUR `/auth/onetap`, qui pose les cookies via une réponse HTTP serveur
 * (fiable sous ITP). D'où : ça marche depuis le vitrine, pas depuis /login.
 *
 * Fix : on aligne `/login` sur le vitrine. Le callback One Tap NE fait plus de
 * session côté client — il fait une REDIRECTION PLEINE PAGE vers la même route
 * serveur `/auth/onetap?credential=<JWT>` (same-origin ici, donc encore plus
 * simple). Cette route (déjà testée, déjà en prod) fait `signInWithIdToken` côté
 * serveur, pose les cookies, gère parrainage + gclid + onboarding, puis redirige
 * vers /espace (ou /onboarding). Plus AUCUN `signInWithIdToken` client dans l'app.
 *
 * Le bouton « Continuer avec Google » visible reste l'OAuth redirect classique
 * (signInWithOAuth) — robuste lui aussi. Le One Tap est un BONUS rapide.
 *
 * RGPD/perf : le SDK GSI n'est chargé et le prompt armé qu'APRÈS une 1ʳᵉ
 * interaction (scroll/clic/touch) — pas d'invite intrusive au 1er paint.
 *
 * STAGING : Google OAuth n'est PAS configuré sur le Supabase staging → la route
 * `/auth/onetap` renvoie un fallback `/login?error=...` (provider non supporté).
 * Le One Tap n'est donc réellement fonctionnel qu'en PROD ; les autres méthodes
 * (Microsoft, magic-link) restent dispo partout.
 */
/**
 * Arme le Google One Tap (bulle de connexion rapide) en BONUS. Au clic, on relaie
 * le credential vers la route SERVEUR `/auth/onetap` (flux qui marche sous ITP/iOS),
 * jamais un signInWithIdToken côté client. `onFallback` (OAuth redirect) reste le
 * filet si le SDK GSI lui-même ne se charge pas (réseau/bloqueur).
 */
function useGoogleSignin(onFallback: () => void) {
  // Garde la dernière ref du fallback sans re-déclencher l'effet GSI.
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let oneTapArmed = false;

    // Callback One Tap : on NE pose PAS la session côté client (KO sous ITP iOS).
    // On RELAIE le credential vers la route SERVEUR `/auth/onetap` par une
    // redirection pleine page — elle ouvre la session côté serveur (cookies
    // fiables) et redirige vers /espace ou /onboarding. C'est exactement le flux
    // du vitrine, qui marche sur iPhone.
    const handleCredential = (res: GoogleCredentialResponse) => {
      if (!res?.credential) {
        console.error("[google-signin] callback sans credential", res);
        return;
      }
      // Préserve un éventuel ?redirectTo (la route serveur le re-valide en
      // liste blanche anti open-redirect).
      const redirectTo = new URLSearchParams(window.location.search).get(
        "redirectTo",
      );
      const relay = new URL("/auth/onetap", window.location.origin);
      relay.searchParams.set("credential", res.credential as string);
      if (redirectTo) relay.searchParams.set("redirectTo", redirectTo);
      window.location.assign(relay.toString());
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
        // ⭐ One Tap armé IMMÉDIATEMENT (pas après interaction) : sur /login c'est
        // l'action principale, pas une intrusion. Avec auto_select=true, si le
        // visiteur a UN seul compte Google déjà consenti, Google le connecte
        // AUTOMATIQUEMENT sans clic (zéro friction). Sinon la bulle s'affiche et
        // le bouton « Continuer en tant que <Nom> » reste dispo en secours.
        armOneTap();
      } catch {
        // GSI KO (réseau/bloqueur) → le bouton de secours OAuth reste affiché.
      }
    };

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

    // Le SDK GSI se charge dès le montage : sur /login c'est l'action principale.
    // `init` rend le bouton ET arme le One Tap (auto-connexion) immédiatement.
    loadGsi(init);

    return () => {
      cancelled = true;
      try {
        window.google?.accounts?.id?.cancel();
      } catch {
        /* noop */
      }
    };
  }, []);
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

  function handleOAuth(provider: "google" | "azure") {
    setOauthError(undefined);
    startOAuth(async () => {
      const res = await signInWithOAuth(provider);
      // On success the action redirects; we only get here on error.
      if (res?.error) setOauthError(res.error);
    });
  }

  // Google One Tap (bulle de connexion rapide) en bonus. Le bouton Google visible
  // est l'OAuth redirect classique (ci-dessous). Si le One Tap échoue → fallback
  // sur ce même OAuth redirect.
  useGoogleSignin(() => handleOAuth("google"));

  const displayError = state.error ?? oauthError;

  return (
    <div className="flex flex-col gap-6">
      {/* Ancre du prompt Google One Tap (GSI y injecte son iframe). Aligné en
          haut du bloc d'auth ; vide tant que le One Tap n'est pas armé. */}
      <div id="onetap-anchor" className="flex justify-center empty:hidden" />

      {/* OAuth (Google / Microsoft) — prêts, activables côté Supabase */}
      <div className="flex flex-col gap-3">
        {/* Bouton Google = OAuth REDIRECT classique (signInWithOAuth → Google →
            /auth/callback). C'est le flux ROBUSTE qui REVIENT bien sur l'app.
            ⚠️ Le bouton GSI renderButton (signInWithIdToken / FedCM) restait coincé
            sur la page Google sans revenir — retiré. Le One Tap (bulle) reste armé
            en bonus pour la connexion rapide quand Google le permet. */}
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
