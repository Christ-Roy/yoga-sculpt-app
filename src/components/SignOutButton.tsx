"use client";

import { useTransition } from "react";
import { signOut } from "@/app/login/actions";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => signOut())}
      disabled={pending}
      className="text-sm text-text-secondary transition-colors hover:text-text disabled:opacity-50"
    >
      {pending ? "…" : "Déconnexion"}
    </button>
  );
}
