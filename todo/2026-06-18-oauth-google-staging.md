# Bug staging : "400 provider not supported" sur le login Google

> Constaté 2026-06-18 (Alice). Elle clique "Se connecter avec Google" sur le
> staging → erreur 400 "provider not supported". Le magic-link, lui, marche.

## Cause
Le projet Supabase **staging** (`htgbtckgkulwuyzfsvjq`) est neuf : seul l'auth
email/magic-link est actif. **Google OAuth (et Microsoft) ne sont PAS configurés**
côté staging — ils ne le sont que sur la PROD (`esearpxflfgreejjxlfg`).

## Options
- **A (test only)** : sur staging, masquer les boutons Google/Microsoft de la page
  login (afficher seulement le magic-link) via une env `NEXT_PUBLIC_AUTH_PROVIDERS`
  ou un flag staging. Rapide, suffit pour tester.
- **B (full)** : activer Google OAuth sur staging = créer un OAuth client Google
  dédié (ou ajouter l'URL callback staging `https://htgbtckgkulwuyzfsvjq.supabase.co/auth/v1/callback`
  au client existant) + coller client_id/secret dans la config auth Supabase staging
  (via Management API `config/auth` : external_google_*). Idem Microsoft si voulu.

## Reco
A pour débloquer le test tout de suite, B quand on veut un staging iso-prod complet.
Pour Alice qui teste : lui envoyer un MAGIC-LINK (marche déjà) plutôt que Google.

## ⚠️ Si on fait l'option B (activer Google sur staging) — NE PAS OUBLIER le nonce
Quand on configure `external_google_*` sur Supabase staging, poser AUSSI
**`external_google_skip_nonce_check: true`** dans le même PATCH `config/auth`. Sinon le One Tap
(vitrine ET app `/login` `/invitation`) cassera en staging avec "Connexion Google impossible",
exactement comme c'est arrivé en PROD le 2026-06-20 (les composants One Tap ne gèrent pas le
nonce → Supabase rejette si le check est actif). Cf `todo/done/2026-06-20-fix-onetap-nonce-signinwithidtoken.md`.
Penser aussi à ajouter l'origine JS staging au client OAuth GCP si on réutilise le même client_id.
