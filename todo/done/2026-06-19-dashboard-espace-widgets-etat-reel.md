# [P2] Dashboard `/espace` à widgets — état réel + ce qui manque (chantier hot-reload)

**Statut** : non fait · **Qui** : agent (déclenchable, mode UI-polish)

## Contexte
Le ticket `2026-06-18-dashboard-widgets-et-dev-env.md` décrit `/espace` comme "basique" et demande un dashboard à widgets. **Cette description est largement périmée** : la page a déjà été enrichie. Audit de l'existant pour ne pas refaire ce qui est fait.

### Ce qui EST DÉJÀ dans `/espace` (src/app/espace/page.tsx)
- **Carte "Mon profil"** (`ProfileCard`) : nom, email, téléphone, objectif, niveau, **édition inline** (Server Action `updateProfile` avec validation zod). Complet.
- **Solde de tickets** affiché : "X ticket(s) collectif · Y particulier" lu en SSR (RLS user-scopée, agrégation par type, filtre expiration). Pas un widget dédié mais l'info est là, dans la carte "Réserver une séance".
- **Carte "Réserver une séance"** : texte + solde + 2 CTA ("Voir les créneaux" → `/espace/reserver`, "Mes réservations" → `/espace/reservations`).
- **Sidebar shadcn** (`AppSidebar`) noir & or, collapsible, mobile drawer, 4 liens (espace / réserver / mes réservations / parrainer) + déconnexion. Complète.
- Redirections métier (non onboardé → `/onboarding`).

### Ce qui MANQUE par rapport au ticket d'origine (widgets demandés)
1. **Widget "Mes séances à venir"** directement sur `/espace` : aujourd'hui il faut cliquer "Mes réservations" pour les voir. Le ticket veut un aperçu des **prochaines réservations** (date/type + actions agenda/annuler) en home. → lire `bookings` confirmés à venir en SSR (déjà fait dans `reservations/page.tsx`, factoriser/réutiliser `MesReservations` ou un aperçu compact "2-3 prochaines").
2. **Widget "Mes tickets / solde" en bloc dédié** avec CTA "Prendre des tickets" (`BuyTickets` existe déjà, composant prêt). Aujourd'hui le solde est noyé dans la carte réserver, sans CTA d'achat direct depuis `/espace`.
3. **Widget "Parrainer un ami"** en home : lien + nb de filleuls inscrits. Aujourd'hui le parrainage n'est accessible que via la sidebar → `/espace/parrainer`. Le ticket veut un aperçu en home (ex. "X amis inscrits" + bouton). Données via `GET /api/parrainage` (déjà livré).
   - ⚠️ Note : le parrainage est actuellement **cassé de bout en bout** (cf 3 tickets P1 parrainage du 2026-06-19) → mettre ce widget APRÈS le fix du flux, sinon il affichera des données mortes.
4. **Widget "Offrir une séance à un ami" (carte cadeau)** : **NE PAS FAIRE** — contrainte business confirmée : carte cadeau repoussée, pas pour l'instant. Le ticket d'origine la listait, elle est hors scope maintenant.
5. Layout "grille de widgets" : actuellement c'est une colonne de cartes empilées (`flex flex-col gap-6`, `max-w-3xl`). Un vrai dashboard voudrait une grille responsive (2 colonnes desktop) si on veut le rendu "tableau de bord". Cosmétique.

## Demande précise
Transformer `/espace` en home à widgets, en **réutilisant les composants existants** (`SoldeBadge`/`BuyTickets`/`MesReservations`/`ProfileCard`/`LieuMaps`/`AddToCalendar`) :
- Widget séances à venir (aperçu 2-3 prochaines + lien "tout voir").
- Widget tickets + CTA achat (`BuyTickets`).
- Widget parrainage (aperçu) — **après** le fix parrainage P1.
- Garder le profil.
- Charte noir & or, responsive (mobile-first → grille ≥sm), états vides/loading/erreur soignés (l'app les gère déjà bien ailleurs, s'en inspirer).
- Server Components + données via routes/lectures RLS déjà livrées. Pas de nouveau backend nécessaire.

Idéal en **mode UI-polish** (hot-reload sur dev-pub, cf partie 2 du ticket d'origine 2026-06-18 toujours valable pour l'env de dev).

## Fichiers concernés
- `src/app/espace/page.tsx` (refonte en widgets)
- `src/components/BuyTickets.tsx`, `MesReservations.tsx`, `ReserverClient.tsx` (SoldeBadge), `ParrainageCard.tsx` (réutilisation)
- éventuel nouveau composant `EspaceDashboard` ou widgets dédiés
- `src/lib/db-types.ts` (types Booking/Ticket déjà là)

## Impact
Amélioration UX/perçu premium. Pas bloquant (le flux fonctionne déjà via la sidebar + cartes). À faire APRÈS les P1 parrainage pour que le widget parrainage affiche du réel. C'est le prochain chantier hot-reload annoncé.
