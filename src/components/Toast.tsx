"use client";

import { useEffect } from "react";

/**
 * Toast minimal — notification éphémère en bas/centre, auto-disparition.
 * Utilisé pour confirmer une réservation / une annulation.
 *
 * Accessibilité : `role="status"` + `aria-live="polite"` → annoncé par les
 * lecteurs d'écran sans voler le focus. Bouton de fermeture explicite.
 */
export type ToastVariant = "success" | "error";

export function Toast({
  message,
  variant = "success",
  onClose,
  durationMs = 5000,
}: {
  message: string;
  variant?: ToastVariant;
  onClose: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [onClose, durationMs]);

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-0"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex max-w-md items-center gap-3 rounded-[4px] border px-4 py-3 text-sm shadow-lg backdrop-blur-md ${
          variant === "success"
            ? "border-accent/50 bg-surface/95 text-text"
            : "border-red-500/50 bg-surface/95 text-text"
        }`}
      >
        <span
          aria-hidden="true"
          className={
            variant === "success" ? "text-accent" : "text-red-400"
          }
        >
          {variant === "success" ? "✓" : "!"}
        </span>
        <span className="flex-1">{message}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la notification"
          className="text-text-secondary transition-colors hover:text-text"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
