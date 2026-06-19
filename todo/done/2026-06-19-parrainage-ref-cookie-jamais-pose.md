# [P1] Parrainage cassé : le code `?ref=` n'est jamais capté → le parrain n'est JAMAIS crédité

**Statut** : non fait · **Qui** : agent (déclenchable)

## Contexte
Le parrainage est, par décision Robert, **la seule mécanique de ticket gratuit** de l'app. Tout le backend est livré et solide (génération de code, table `referrals` + RLS, anti-abus IP/fingerprint/email jetable, crédit idempotent du parrain). MAIS le **maillon d'entrée côté UI est absent** : rien ne capte le code de parrainage à l'arrivée du filleul.

Chaîne attendue (documentée dans le code) :
1. Le parrain partage `https://app.yoga-sculpt.fr/login?ref=<CODE>` (généré par `GET /api/parrainage` + e-mail d'invitation de `inviter/route.ts`).
2. Le filleul clique → arrive sur `/login?ref=<CODE>`.
3. **Le front doit poser un cookie `ys_ref=<CODE>` AVANT le login.**
4. Après login, `src/app/auth/callback/route.ts` lit `cookieStore.get("ys_ref")` et appelle `completerReferral(...)` → crédite le parrain.

Le maillon (3) **n'existe nulle part**. Vérifié par grep : aucun fichier ne lit `searchParams.ref` ni ne pose le cookie `ys_ref`. `login/page.tsx` et `LoginForm.tsx` ignorent totalement le param `?ref=`. Résultat : `callback/route.ts` lit un cookie qui n'est jamais posé → `refCode` toujours `undefined` → `completerReferral` jamais appelé par cette voie → **aucun parrain n'est jamais crédité**.

Note : il existe une 2e voie théorique (`POST /api/parrainage/completer` avec `{ code }`), mais **personne ne l'appelle non plus** côté UI (cf. ticket dédié). Donc les deux voies sont mortes → parrainage 100% non fonctionnel de bout en bout.

## Demande précise
Capter le code `?ref=` à l'arrivée et le déposer en cookie `ys_ref` lisible par le callback serveur.

Implémentation recommandée (la plus simple, sans casser le edge) : dans `login/page.tsx` (Server Component), lire `searchParams.ref`, et si présent, poser le cookie `ys_ref` côté serveur via `cookies().set("ys_ref", code, { ... })`.
- Cookie : `httpOnly: true`, `secure: true`, `sameSite: "lax"`, `path: "/"`, `maxAge` ~30 min à quelques jours, valeur sanitizée (alphabet `[A-Z2-9]{8}` cf `genererCode()`, longueur max 32 — rejeter sinon).
- `sameSite: "lax"` est requis pour que le cookie survive au redirect OAuth retour (Google/Microsoft) vers `/auth/callback`.
- Le callback lit déjà `ys_ref` : ne pas changer le nom du cookie (contrat existant).
- Vérifier l'interaction avec le middleware `proxy.ts` : un user **déjà connecté** qui ouvre `/login?ref=...` est immédiatement redirigé vers `/espace` (ligne 64-69 de `proxy.ts`) → le cookie ne serait pas posé. Acceptable (un membre existant n'est pas un nouveau filleul), mais à garder en tête. Le cas cible (filleul = nouveau visiteur non connecté) fonctionne.

## Fichiers concernés
- `src/app/login/page.tsx` (poser le cookie — point d'entrée recommandé)
- `src/app/auth/callback/route.ts` (déjà OK, lit `ys_ref` — ne pas toucher la lecture)
- `src/lib/supabase/proxy.ts` (vérifier que le matcher `/login` laisse passer le param ; ne redirige que si user connecté — OK)
- `src/app/api/parrainage/inviter/route.ts` + `route.ts` (génèrent le lien `?ref=` — contrat de référence, ne pas toucher)

## Impact
**Bloquant business.** Tant que ce trou existe, le parrainage ne crédite jamais personne : la seule mécanique d'acquisition virale et de ticket gratuit est morte. Un parrain qui invite verra ses filleuls rester "en attente" indéfiniment même après inscription. Correction rapide (~1 fichier), réversible.
