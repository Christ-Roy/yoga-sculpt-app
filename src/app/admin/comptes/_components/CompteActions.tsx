"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Panneau d'ACTIONS ADMIN sur un compte (client component).
 *
 * Toutes les actions tapent les routes serveur gardées par `requireAdmin()`
 * (`/api/admin/users/*`) ; la service_role n'est JAMAIS exposée ici. Chaque
 * action sensible (débit, suspension) passe par une CONFIRMATION explicite.
 *
 * Les liens d'auth (recovery / magic-link) sont GÉNÉRÉS côté serveur et
 * AFFICHÉS ici pour copie manuelle (fallback sûr, indépendant du SMTP).
 *
 * Idempotence du crédit/débit : on génère un `opId` (UUID) par tentative ; un
 * retry réseau / double-clic ne recrédite pas (cf tickets-admin.ts).
 */

type Sens = "credit" | "debit";
type TicketType = "collectif" | "particulier";

interface Feedback {
  ok: boolean;
  message: string;
  /** Lien d'action à copier (recovery / magic-link). */
  lien?: string | null;
}

export function CompteActions({
  userId,
  email,
  suspendu,
}: {
  userId: string;
  email: string;
  suspendu: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Clé de l'action en cours (pour cibler le spinner sur le bon bouton).
  const [actionEnCours, setActionEnCours] = useState<string | null>(null);

  // — Formulaire tickets —
  const [sens, setSens] = useState<Sens>("credit");
  const [type, setType] = useState<TicketType>("collectif");
  const [quantite, setQuantite] = useState(1);

  /** Wrapper d'appel API + feedback + refresh des données serveur. */
  async function appeler(
    cle: string,
    url: string,
    body: unknown,
    okMessage?: string,
    confirmer?: string,
  ) {
    if (confirmer && !window.confirm(confirmer)) return;
    setFeedback(null);
    setActionEnCours(cle);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        actionLink?: string | null;
      };
      if (!res.ok) {
        setFeedback({ ok: false, message: data.error ?? "Action échouée." });
        return;
      }
      setFeedback({
        ok: true,
        message: data.message ?? okMessage ?? "Action effectuée.",
        lien: data.actionLink ?? null,
      });
      // Rafraîchit les données serveur (solde, statut…) sans recharger la page.
      startTransition(() => router.refresh());
    } catch {
      setFeedback({ ok: false, message: "Erreur réseau. Réessayez." });
    } finally {
      setActionEnCours(null);
    }
  }

  // Une action API ou un refresh en cours bloque toutes les actions ; le spinner
  // ne s'affiche que sur le bouton réellement déclenché.
  const busy = pending || actionEnCours !== null;

  return (
    <section
      aria-label="Actions sur le compte"
      className="flex flex-col gap-6 rounded-[4px] border border-border bg-surface/60 p-5"
    >
      <h2 className="font-display text-lg text-text">Actions</h2>

      {/* Feedback */}
      {feedback ? (
        <div
          role="status"
          className={`rounded-[4px] border px-3 py-2 text-sm ${
            feedback.ok
              ? "border-accent/40 text-accent"
              : "border-red-500/40 text-red-400"
          }`}
        >
          <p>{feedback.message}</p>
          {feedback.lien ? (
            <div className="mt-2 flex flex-col gap-1">
              <span className="text-xs text-text-secondary">
                Lien à copier et transmettre au membre :
              </span>
              <Input
                readOnly
                value={feedback.lien}
                onFocus={(e) => e.currentTarget.select()}
                className="text-xs"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* — Crédit / Débit de tickets — */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-text">Ajuster les séances</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Sens
            <select
              value={sens}
              onChange={(e) => setSens(e.target.value as Sens)}
              className="h-9 rounded-[var(--radius)] border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:border-accent"
            >
              <option value="credit">Créditer (offrir)</option>
              <option value="debit">Débiter (corriger)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TicketType)}
              className="h-9 rounded-[var(--radius)] border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:border-accent"
            >
              <option value="collectif">Collectif</option>
              <option value="particulier">Particulier</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Quantité
            <Input
              type="number"
              min={1}
              max={50}
              value={quantite}
              onChange={(e) =>
                setQuantite(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
              }
              className="w-24"
            />
          </label>
          <Button
            type="button"
            variant={sens === "debit" ? "destructive" : "default"}
            disabled={busy}
            loading={actionEnCours === "tickets"}
            onClick={() =>
              appeler(
                "tickets",
                "/api/admin/users/tickets",
                { userId, type, sens, quantite, opId: crypto.randomUUID() },
                undefined,
                sens === "debit"
                  ? `Confirmer le DÉBIT de ${quantite} séance(s) ${type} à ${email} ?`
                  : undefined,
              )
            }
          >
            {sens === "credit" ? "Créditer" : "Débiter"}
          </Button>
        </div>
      </div>

      {/* — Liens d'auth — */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-text">Liens de connexion</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            loading={actionEnCours === "recovery"}
            onClick={() =>
              appeler("recovery", "/api/admin/users/auth-action", {
                userId,
                action: "recovery",
              })
            }
          >
            Lien réinitialisation mot de passe
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            loading={actionEnCours === "magiclink"}
            onClick={() =>
              appeler("magiclink", "/api/admin/users/auth-action", {
                userId,
                action: "magiclink",
              })
            }
          >
            Magic-link de connexion
          </Button>
        </div>
      </div>

      {/* — Suspension — */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-text">Statut du compte</h3>
        <div>
          {suspendu ? (
            <Button
              type="button"
              variant="default"
              disabled={busy}
              loading={actionEnCours === "suspendre"}
              onClick={() =>
                appeler(
                  "suspendre",
                  "/api/admin/users/suspendre",
                  { userId, suspendre: false },
                  "Compte réactivé.",
                )
              }
            >
              Réactiver le compte
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              loading={actionEnCours === "suspendre"}
              onClick={() =>
                appeler(
                  "suspendre",
                  "/api/admin/users/suspendre",
                  { userId, suspendre: true },
                  "Compte suspendu.",
                  `Confirmer la SUSPENSION du compte ${email} ? Il ne pourra plus se connecter.`,
                )
              }
            >
              Suspendre le compte
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
