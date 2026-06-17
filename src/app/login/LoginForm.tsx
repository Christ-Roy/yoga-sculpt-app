"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import {
  signInWithMagicLink,
  signInWithOAuth,
  type AuthState,
} from "./actions";

const initialState: AuthState = {};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.6 32.9 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 43.5c5.4 0 10.3-2.1 13.9-5.4l-6.4-5.4C29.4 34.4 26.8 35.5 24 35.5c-5.2 0-9.6-3.1-11.3-7.6l-6.5 5C9.6 39 16.2 43.5 24 43.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.4 5.4C41.6 36.5 43.5 30.7 43.5 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden>
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function LoginForm({ initialError }: { initialError?: string }) {
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
          <GoogleIcon />
          Continuer avec Google
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleOAuth("azure")}
          disabled={isOAuthPending}
          className="w-full justify-center"
        >
          <MicrosoftIcon />
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
            {pending ? "Envoi…" : "Recevoir le lien de connexion"}
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
