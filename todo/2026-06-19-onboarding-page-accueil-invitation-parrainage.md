# [P1] Système d'invitation parrainage NICKEL — landing dédiée + auth fluide → onboarding

**Statut** : à faire · **Qui** : agent · **Source** : demande Robert 2026-06-19 (renforcée)

## Vision (Robert)
Quand un filleul reçoit un lien d'invitation, le parcours doit être un TUNNEL fluide :
1. Une **étape d'accueil AVANT l'onboarding** : « {Prénom} vous a invité(e) à faire du
   yoga ! Le yoga, c'est plus sympa entre ami(e)s 🧘 ».
2. Pouvoir **s'authentifier facilement DEPUIS cet écran** (Google + magic-link directement
   intégrés, pas un détour par un `/login` austère).
3. Puis enchaîner sur l'onboarding normal. « Il faut un système nickel. »

## Flux cible
```
Lien partagé : app.yoga-sculpt.fr/invitation?ref=<CODE>
   │  (le middleware capte déjà ?ref= → cookies ys_ref / ys_ref_pub — NE PAS dupliquer)
   ▼
/invitation  (PAGE PUBLIQUE, pas de login requis)
   • Résout le PRÉNOM du parrain depuis le code (lookup serveur sûr sur profiles.referral_code).
   • Hero chaleureux DA noir & or : « {Prénom} vous a invité(e) à faire du yoga ! »
     + accroche communautaire + (option) le bénéfice (1ère séance, ambiance).
     Fallback si prénom inconnu / code invalide : « Vous avez été invité(e) à faire du yoga ! »
   • BLOC AUTH intégré (réutiliser les actions de src/app/login/actions.ts :
     signInWithOAuth("google"/"azure") + signInWithMagicLink) — boutons habillés invitation.
   • Tracking : logEvent "invitation_landing_view".
   ▼
auth (Google/magic-link) → /auth/callback (lit ys_ref, déjà câblé) → /onboarding
   ▼
Onboarding : le contexte invitation peut être rappelé en tête (badge « Invité par {Prénom} »)
   sans casser le flow 6 étapes + reprise draft.
```

## Implémentation
- **Nouvelle route** `src/app/invitation/page.tsx` (PUBLIQUE — l'ajouter aux exceptions du
  proxy/middleware comme /login, qui ne forcent pas l'auth). Server Component : lit `?ref=`,
  résout le prénom parrain (nouvelle fonction `lib/referral.ts` ex. `prenomParrainParCode(code)`
  — SELECT full_name WHERE referral_code, retourne le 1er prénom, jamais d'autre PII ; null si
  code inconnu). Le middleware pose déjà les cookies ys_ref/ys_ref_pub sur `/invitation?ref=`
  (vérifier que le matcher les couvre ; sinon élargir).
- **Bloc auth** : extraire un composant auth réutilisable depuis LoginForm (ou réutiliser
  LoginForm tel quel sous un habillage invitation). Les boutons doivent fonctionner identiquement
  (mêmes actions, même callback) — l'auth réussie suit le contrat existant (ys_ref consommé au
  callback → crédit parrain selon anti-abus, cap REFERRAL_MAX_CREDITS).
- **Pas de duplication** de la capture ?ref= (middleware s'en charge). `/invitation` AFFICHE le
  contexte, ne re-pose pas les cookies.
- **Onboarding** : passer le contexte invitation (prénom parrain, depuis le cookie ys_ref_pub
  ou re-résolu serveur) pour afficher un rappel discret en tête. Optionnel mais souhaité.
- **DA** : noir & or, médaillon YS, cohérent avec /login et l'onboarding. Responsive mobile.

## Garde-fous (ne pas régresser)
- `/invitation` PUBLIQUE mais ne crédite RIEN (pas un point de crédit ; le crédit suit le flux
  anti-abus existant au callback/completer). Pas d'open-redirect via ?ref= (ce n'est pas une URL).
- Lookup prénom : SELECT borné, jamais exposer email/téléphone/autre du parrain.
- Le lien `/login?ref=` historique doit CONTINUER de marcher (ne pas le casser ; idéalement
  /login peut rediriger vers /invitation si ?ref= présent, ou les deux coexistent).
- Ne pas casser le flow onboarding 6 étapes ni la reprise draft. Tests + 523 verts.

## Tests
- Unit : `prenomParrainParCode` (code valide → prénom, code inconnu → null, pas de PII).
- E2E Playwright : étendre le spec parrainage — arriver sur /invitation?ref=CODE → voir
  « {Prénom} vous a invité » → s'authentifier → atterrir sur /onboarding.

## Fichiers
- `src/app/invitation/page.tsx` (nouveau), composant auth partagé (depuis `src/app/login/`),
  `src/lib/referral.ts` (lookup prénom), `src/middleware.ts` (vérifier matcher), `src/lib/supabase/proxy.ts`
  (route publique), onboarding (rappel contexte), `e2e/parrainage.spec.ts`.
