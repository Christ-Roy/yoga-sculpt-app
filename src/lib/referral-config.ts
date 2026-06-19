/**
 * Configuration PURE du parrainage — partageable serveur ET client.
 *
 * Module volontairement SANS aucun import ni I/O : il ne contient que des
 * constantes, pour pouvoir être importé aussi bien par la logique serveur
 * (`referral.ts`, garde anti-abus) que par un composant client (`AppSidebar`,
 * pastille « tickets à gagner ») sans tirer de dépendance serveur dans le bundle.
 *
 * ⚠️ Le PLAFOND EFFECTIF (celui qui REFUSE le crédit) est calculé côté serveur
 * dans `referral.ts` via `maxParrainagesCredites()`, qui superpose une éventuelle
 * surcharge d'environnement (`REFERRAL_MAX_CREDITS`) à ce défaut. Les écrans UI
 * (dashboard, sidebar) n'utilisent QUE ce défaut comme repère d'affichage — le
 * plafond réellement appliqué reste celui du serveur.
 */

/**
 * Plafond par défaut de parrainages CRÉDITÉS par parrain (1 ticket par filleul).
 *
 * Décision Robert 2026-06-19 : 3 séances offertes maximum gagnables par
 * parrainage. C'est une RÈGLE MÉTIER (pas qu'un garde-fou anti-abus) — le
 * dashboard et la sidebar s'en servent pour « il vous reste N séances à gagner ».
 * Surchargeable côté serveur via l'env `REFERRAL_MAX_CREDITS` (anti-farming /
 * ajustement) sans toucher au code, cf. `maxParrainagesCredites()`.
 */
export const PARRAINAGE_MAX_DEFAUT = 3;
