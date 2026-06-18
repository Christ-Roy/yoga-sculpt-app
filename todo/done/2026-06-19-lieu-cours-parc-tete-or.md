# [P3] Contenu : lieu des cours encore vague "Lyon" — devrait mentionner "Parc de la Tête d'Or"

**Statut** : non fait · **Qui** : agent (déclenchable) + validation Robert/Alice sur le wording

## Contexte
Contrainte business mise à jour : **le lieu des cours est le Parc de la Tête d'Or (Lyon)** au début, puis un local plus tard. Avant, c'était volontairement vague ("Lyon").

Dans l'app, plusieurs textes en dur disent encore juste "Lyon" / "à Lyon" :
- `src/app/api/parrainage/inviter/route.ts` : e-mail d'invitation → "cours de yoga et pilates **à Lyon**" (corpsHtml) et "yoga & pilates **à Lyon**" (textContent).
- `src/lib/email-templates.ts` : footer → "Yoga Sculpt — **Lyon**".
- Le lieu réel des créneaux vient du champ "Lieu" de l'event Google d'Alice (`creneau.lieu`, affiché via `LieuMaps`) → ça, c'est correct et dynamique (si Alice renseigne "Parc de la Tête d'Or", ça s'affiche avec lien Maps). Ne pas toucher cette mécanique.

## Demande précise
1. Décider du wording exact avec Robert/Alice (ex. "yoga & pilates au Parc de la Tête d'Or, Lyon" ou rester "à Lyon" dans les e-mails marketing et ne préciser le parc que sur les créneaux). C'est un arbitrage contenu, pas purement technique.
2. Si validé : mettre à jour les textes d'invitation parrainage + footer e-mail pour mentionner le Parc de la Tête d'Or là où c'est pertinent.
3. S'assurer qu'Alice renseigne bien le champ "Lieu" = "Parc de la Tête d'Or" (ou adresse précise) sur ses events Google → l'UI affichera le lien Maps. (Action Alice, pas code — `GET /api/creneaux` log déjà un warning si le lieu manque.)

## Fichiers concernés
- `src/app/api/parrainage/inviter/route.ts` (corpsHtml + textContent)
- `src/lib/email-templates.ts` (footer)
- (config Google Calendar côté Alice — hors repo)

## Impact
Cohérence de marque / clarté pour le client. Mineur, non bloquant. À aligner sur la décision de wording (ne pas sur-affirmer si le local change bientôt).
