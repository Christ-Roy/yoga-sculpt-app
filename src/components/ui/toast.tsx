"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Système de toast UNIFIÉ de l'espace client (charte NOIR & OR, zéro dépendance).
 *
 * Un seul ToastProvider monté à la racine (cf. src/app/layout.tsx) → tous les
 * composants déclenchent un toast via le hook `useToast()` :
 *
 *     const { toast } = useToast();
 *     toast("Séance réservée", "success");
 *
 * Remplace les 6 implémentations locales (useState + <Toast> dupliqués). Les
 * toasts s'empilent (haut-centre), s'auto-suppriment (5 s), sont fermables, et
 * sont annoncés aux lecteurs d'écran (région `aria-live` polite/assertive selon
 * la variante). Accessible AA : la couleur n'est pas le seul porteur d'info
 * (icône ✓/! + le texte).
 */
export type ToastVariant = "success" | "error" | "info";

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  /** Affiche un toast. Variante par défaut : success. */
  toast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS = 5000;

const VARIANT_STYLES: Record<
  ToastVariant,
  { border: string; icon: string; iconColor: string }
> = {
  success: { border: "border-accent/50", icon: "✓", iconColor: "text-accent" },
  error: { border: "border-red-500/50", icon: "!", iconColor: "text-red-400" },
  info: { border: "border-border", icon: "i", iconColor: "text-text-secondary" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = nextId.current++;
      setItems((cur) => [...cur, { id, message, variant }]);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Région live unique pour tous les toasts. `polite` : on n'interrompt pas
          la lecture en cours (les erreurs restent visibles + l'icône signale). */}
      <div
        className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-center gap-2 sm:inset-x-0"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  item,
  onClose,
}: {
  item: ToastItem;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, DURATION_MS);
    return () => clearTimeout(t);
  }, [onClose]);

  const s = VARIANT_STYLES[item.variant];

  return (
    <div
      className={`animate-fade-in-up pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[4px] border ${s.border} bg-surface/95 px-4 py-3 text-sm text-text shadow-lg backdrop-blur-md`}
    >
      <span aria-hidden="true" className={s.iconColor}>
        {s.icon}
      </span>
      <span className="flex-1">{item.message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer la notification"
        className="text-text-secondary transition-colors hover:text-text"
      >
        ✕
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast doit être utilisé dans un <ToastProvider>.");
  }
  return ctx;
}
