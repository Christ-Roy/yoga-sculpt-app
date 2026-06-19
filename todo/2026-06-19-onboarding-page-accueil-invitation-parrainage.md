# [P3] Landing invitation — enrichir l'accueil avec la PHOTO + l'EMAIL du parrain

**Statut** : reliquat (cœur livré) · **Qui** : agent · **Source** : demande Robert 2026-06-19 (enrichissement)

## ✅ Déjà livré (ne pas refaire)
La landing d'invitation est EN PLACE et fonctionnelle :
- `src/app/invitation/page.tsx` — route PUBLIQUE, DA noir & or, médaillon YS, hero
  chaleureux « {Prénom} vous a invité(e) à faire du yoga ! » + fallback si code inconnu.
- `src/components/AuthMethods.tsx` — bloc auth partagé (Google / Microsoft / magic-link),
  intégré directement dans la landing.
- `src/lib/referral.ts` `prenomParrainParCode(service, code)` — lookup borné `full_name`,
  ne renvoie QUE le prénom, jamais de PII, best-effort (null si inconnu, ne throw jamais).
- Tracking `invitation_landing_view` (migration `0016_invitation_landing_event.sql`).
- Cookie `ys_ref`/`ys_ref_pub` posé par le middleware (la page ne le re-pose pas).
- Le crédit suit l'anti-abus existant (cap `REFERRAL_MAX_CREDITS`) au callback/completer.

## ⬜ Reste à faire — enrichir l'accueil avec photo + email du parrain
Aujourd'hui la landing n'affiche QUE le prénom du parrain. Robert veut un accueil plus
incarné/rassurant : montrer **la photo de profil ET l'email** du parrain (« {Prénom}
({email}) vous invite », avec son avatar).

- **Source de la donnée** : la photo (et au besoin l'email) du parrain vivent dans
  `auth.users.raw_user_meta_data` côté Supabase (claims OAuth Google/Microsoft :
  `avatar_url` / `picture`, `email`). À lire côté serveur via le client service_role
  (la route est publique → lookup système borné), à partir du `parrain_user_id` résolu
  depuis le `referral_code`.
- **Implémentation** : étendre `lib/referral.ts` (ex. nouvelle fonction
  `parrainParCode(service, code)` qui renvoie `{ prenom, avatarUrl, email }` — ou
  enrichir le retour existant), puis afficher l'avatar (fallback initiales si pas de
  photo) à côté du titre dans `src/app/invitation/page.tsx`.

## Garde-fous (NE PAS régresser)
- Rester en best-effort : photo/email absents (parrain magic-link sans avatar, code
  inconnu) → on retombe proprement sur le rendu prénom-seul / titre de repli, jamais
  d'erreur ni de 500 sur cette page publique.
- ✅ DÉCISION ROBERT (2026-06-19) : afficher l'**email COMPLET en clair** est validé.
  Raison : « si il lui donne le lien c'est normal qu'il puisse voir l'adresse mail » — le
  parrain partage son lien volontairement à des gens qu'il connaît, l'email assumé.
  → Afficher avatar + prénom + email complet. (Garder le fail-safe : si email/avatar absent,
  rendu prénom-seul, jamais d'erreur.) Reste à surveiller l'énumération de codes côté sécu
  (cf [[2026-06-19-passe-securite-features-livrees]] — rate limiting éventuel sur /invitation).
- Avatar = image distante (`avatar_url` Google) → `aria-hidden` décoratif, `referrerpolicy`
  safe, fallback initiales, pas de layout shift.

## Fichiers
- `src/lib/referral.ts` (enrichir le lookup parrain), `src/app/invitation/page.tsx`
  (afficher avatar + éventuellement email).
