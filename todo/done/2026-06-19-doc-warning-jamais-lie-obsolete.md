# [P3] Doc : warning « JAMAIS lié depuis le vitrine » obsolète (consigne levée 2026-06-18)

**Statut** : non fait · **Qui** : agent (déclenchable)

## Contexte
`README.md` et `SETUP.md` du repo app affichent encore en tête un avertissement :

- `README.md:7` : « ⚠️ Ne jamais lier cet espace depuis le site vitrine. Il vit seul. »
- `SETUP.md:6-8` : « ⚠️ Cet espace ne doit **JAMAIS** être lié depuis le site vitrine yoga-sculpt.fr. Il vit seul, sur `app.yoga-sculpt.fr` (déploiement à venir). »

Or le CLAUDE.md maître (`/home/brunon5/site-clients/alice-gaudry/CLAUDE.md`, §1, MAJ Robert 2026-06-18) acte que **cette consigne était TEMPORAIRE (le temps des tests) et est LEVÉE** :
> « ✅ Le vitrine PEUT référencer l'espace client (lien navbar / bouton "Espace client" → app.yoga-sculpt.fr). L'ancienne consigne "jamais de lien" était TEMPORAIRE, elle est LEVÉE. »

Le `SETUP.md:8` dit aussi « déploiement à venir / rien de déployé » (§5), alors que l'app a depuis avancé (staging + CI + moteur résa livrés). Doc à rafraîchir au passage.

## Demande précise
- Retirer/réécrire le warning « jamais lié » dans `README.md` et `SETUP.md` pour refléter la décision du 2026-06-18 (l'espace est exposé depuis la landing).
- Vérifier la cohérence de `SETUP.md` §5 (« rien de déployé ») avec l'état réel (cf `DEPLOY.md` : staging auto-deploy en place).

## Fichiers concernés
- `README.md` (ligne 7)
- `SETUP.md` (lignes 6-8, et §5)

## Impact
Doc seulement. Un agent (ou Robert) qui lit ces fichiers en isolation pourrait croire la consigne « jamais de lien » toujours active et défaire un lien légitime. Hors périmètre du quick-win doc-webhooks (ce n'est ni Cal.com ni un webhook), signalé séparément.
