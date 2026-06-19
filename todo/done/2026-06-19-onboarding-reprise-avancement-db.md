# [P1] Onboarding : sauvegarder l'avancement en DB (reprise là où on s'est arrêté)

**Statut** : non fait · **Qui** : agent · **Demande Robert 2026-06-19**

## Problème
L'avancement de l'onboarding (étape en cours + réponses partielles) ne vit que dans le state React (`OnboardingFlow.tsx`). Si l'utilisateur quitte ou rafraîchit en plein onboarding, tout est perdu — il recommence à zéro. Robert veut une **reprise** : revenir exactement à l'étape où il s'était arrêté, avec ses réponses déjà cochées.

## Comportement attendu
- À chaque réponse sélectionnée, **sauvegarder en DB** (réponse + étape/phase courante), best-effort (ne bloque pas l'UX).
- Au chargement de `/onboarding`, **précharger** l'état depuis la DB → `OnboardingFlow` démarre à la bonne étape avec `answers` pré-remplis.
- Si `onboarding_completed = true` → redirige `/espace` (déjà en place, garder).
- Reprise par TENANT/user (chaque compte a son propre avancement). RLS : chacun ne lit/écrit que le sien.

## Implémentation (additif, R0)
- **Migration** (prochain numéro libre, ex `0014`) : 
  - colonne `profiles.onboarding_step text` (ou `onboarding_phase` : "questions:2" / "invite" / "final") pour mémoriser où on en est ;
  - `onboarding_responses` sert déjà au stockage final ; pour le brouillon, soit **upsert** progressif dans `onboarding_responses` (1 ligne/user, contrainte unique sur user_id à ajouter — attention : aujourd'hui c'est `insert` à la fin), soit une colonne jsonb `profiles.onboarding_draft jsonb` qui stocke `{goal, level, availability, format, step}`. **Reco : `onboarding_draft jsonb` sur profiles** (simple, 1 seul endroit, pas de refonte du insert final).
- **Action serveur** `saveOnboardingProgress(partial)` : upsert le draft + l'étape. Best-effort.
- **OnboardingFlow** : `useState` initialisé depuis une prop `initialDraft` (chargée par `page.tsx` serveur depuis `profiles.onboarding_draft`). Appeler `saveOnboardingProgress` dans `select()` (debounce léger ou à chaque sélection).
- `saveOnboarding` final (existant) : à la complétion, écrit les réponses définitives + `onboarding_completed=true` + nettoie le draft.
- ⚠️ Ne pas casser le flow actuel (6 étapes, format split, garde-fou submit, pas de welcome ticket).

## Fichiers
- `supabase/migrations/00XX_onboarding_draft.sql`
- `src/app/onboarding/actions.ts` (+ saveOnboardingProgress, nettoyage draft à la fin)
- `src/app/onboarding/page.tsx` (charge le draft, le passe à OnboardingFlow)
- `src/app/onboarding/OnboardingFlow.tsx` (init depuis draft + save progressif)

## Impact
UX : un utilisateur interrompu reprend sans frustration. Important pour le taux de complétion de l'onboarding (1ère étape d'activation après "Essai gratuit").
