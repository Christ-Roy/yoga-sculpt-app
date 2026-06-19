# [P1] Anti-abus parrainage HS : `FingerprintCollector` POST vers un endpoint inexistant (404)

**Statut** : non fait · **Qui** : agent (déclenchable)

## Contexte
Le composant `FingerprintCollector` (monté dans `espace/layout.tsx`, donc sur toutes les pages `/espace/*`) collecte une empreinte d'appareil et la POST à `/api/parrainage/fingerprint` :

```ts
// src/components/FingerprintCollector.tsx:242
void fetch("/api/parrainage/fingerprint", { method: "POST", body: JSON.stringify({ components }), keepalive: true })
```

**Cet endpoint n'existe pas.** `src/app/api/parrainage/` ne contient que `route.ts`, `inviter/`, `completer/`. Vérifié par `ls` + grep. Donc **chaque chargement de l'espace fait un POST qui renvoie 404**, et le `device_fingerprint` n'est **jamais** enregistré dans `account_signals`.

Le commentaire du composant l'avoue lui-même : *"Hypothèse d'endpoint (cf brief) : POST /api/parrainage/fingerprint ... Si l'endpoint réel diffère, seul l'URL ci-dessous est à ajuster."* → l'agent UI a codé contre un endpoint supposé que l'agent backend n'a jamais créé. Trou de contrat classique entre agents.

### Conséquence sur l'anti-abus
`canCreditReferral` (R3) compare les `device_fingerprint` entre comptes pour détecter l'auto-parrainage. Avec un fingerprint toujours `null`, **R3 ne se déclenche jamais**. Il reste R1 (email jetable), R2 (IP partagée) et R4 (filleul déjà crédité). R2 (IP) couvre une partie des cas, mais le fingerprint était la défense contre "même appareil, IP différente" (4G/VPN). Sécurité dégradée silencieusement.

### Mismatch de contrat secondaire (à corriger en même temps)
Même si l'endpoint était créé, le contrat de données ne colle pas :
- `FingerprintCollector` envoie `{ components: {...} }`.
- `completer/route.ts` (la seule autre route qui hashe) attend `{ fingerprint: object|string }` (cf `bodySchema`, ligne 47).
Il faut que le nouvel endpoint accepte bien la clé `components` (ou aligner les deux), puis appelle `hashFingerprint(components)` + `enregistrerSignaux(service, { userId, fingerprint })`.

## Demande précise
Créer `src/app/api/parrainage/fingerprint/route.ts` (runtime edge) :
1. `POST` only (GET → 405, comme les autres routes du repo).
2. Auth `getUser()` (401 sinon) — c'est le user connecté qui s'auto-déclare.
3. Valider le body avec zod `{ components: z.record(...) }` (`.strict()`), tolérant à l'absence (best-effort).
4. `const fp = await hashFingerprint(components)` (`src/lib/fingerprint.ts`).
5. `await enregistrerSignaux(createServiceClient(), { userId: user.id, fingerprint: fp })` (`src/lib/referral.ts` — n'écrase pas l'IP déjà captée, fait déjà le merge).
6. Réponse neutre `200 { ok: true }` quoi qu'il arrive (best-effort, échec silencieux — cohérent avec la philosophie anti-abus du repo).

Documenter `BREVO`/contrat à part : ici, juste créer l'endpoint manquant. Réutiliser `hashFingerprint` et `enregistrerSignaux` existants (déjà edge-safe, déjà testés ailleurs).

## Fichiers concernés
- `src/app/api/parrainage/fingerprint/route.ts` (À CRÉER)
- `src/components/FingerprintCollector.tsx` (vérifier l'alignement de la clé `components`)
- `src/lib/fingerprint.ts` (`hashFingerprint`, réutiliser)
- `src/lib/referral.ts` (`enregistrerSignaux`, réutiliser)

## Impact
**Sécurité anti-fraude dégradée** + **bruit 404 permanent** sur chaque visite de l'espace (pollue les logs Worker, requête réseau inutile keepalive à chaque session). L'auto-parrainage "même appareil, IP changeante" passe actuellement à travers. Correction nette (~1 fichier), réversible.
