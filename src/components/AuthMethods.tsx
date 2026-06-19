"use client";

import { useActionState, useState, useTransition } from "react";
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

  const displayError = state.error ?? oauthError;

  return (
    <div className="flex flex-col gap-6">
      {/* OAuth (Google / Microsoft) — prêts, activables côté Supabase */}
      <div className="flex flex-col gap-3">
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
