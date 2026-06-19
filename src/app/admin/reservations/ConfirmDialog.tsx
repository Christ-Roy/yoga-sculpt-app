"use client";

import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";

/**
 * Boîte de confirmation modale (charte NOIR & OR) pour les actions SENSIBLES du
 * back-office (annuler / déplacer une réservation au nom d'une cliente).
 *
 * Accessibilité : `role="dialog"` + `aria-modal`, focus piégé sur le bouton de
 * confirmation à l'ouverture, fermeture à Échap, clic sur l'arrière-plan ferme.
 * Le texte porte l'information (pas seulement la couleur).
 */
export function ConfirmDialog({
  open,
  titre,
  children,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = false,
  pending = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  titre: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Ferme uniquement si on clique l'arrière-plan (pas le contenu).
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-titre"
        className="w-full max-w-md rounded-[4px] border border-border bg-surface p-6 shadow-2xl"
      >
        <h2 id="confirm-titre" className="font-display text-xl text-text">
          {titre}
        </h2>
        <div className="mt-3 text-sm leading-relaxed text-text-secondary">
          {children}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[4px] px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 ${
              destructive
                ? "bg-red-600 text-white hover:bg-red-600/90 focus-visible:outline-red-600"
                : "bg-accent text-[#0e0e0e] hover:bg-accent-dark focus-visible:outline-accent"
            }`}
          >
            {pending ? (
              <>
                <Spinner />
                {confirmLabel}
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
