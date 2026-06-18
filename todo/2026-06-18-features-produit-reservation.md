# Backlog produit — features autour du moteur de réservation

> Déposé 2026-06-18 (demande Robert). À traiter APRÈS la livraison du moteur de
> réservation maison (lots A→G du ticket `2026-06-18-moteur-reservation-maison.md`).
> Runtime = Cloudflare Workers edge → tout en Web Crypto + fetch, zéro dep Node.

---

## 1. 🔴 Règle d'annulation — délai minimum 24h
**Quoi** : un client ne peut annuler (et récupérer son ticket) que jusqu'à **24h avant** le créneau.
Passé ce délai, l'annulation est refusée (ou possible mais SANS recrédit du ticket — à trancher, cf. arbitrage).

**Où** : `src/app/api/annuler/route.ts` (+ `src/lib/reservation.ts`).
- Calculer `starts_at - now() >= 24h` avant d'autoriser le recrédit.
- Exposer la règle côté UI (bouton "Annuler" grisé + tooltip "Annulation possible jusqu'à 24h avant" si trop tard).
- Constante `CANCELLATION_MIN_HOURS = 24` centralisée (configurable).

**Arbitrage Robert** : à < 24h, on bloque totalement l'annulation, ou on autorise l'annulation (libère le créneau) mais le ticket est perdu ? Reco : **bloquer** (plus simple, standard studio). À valider.

---

## 2. 📧 Rappels email automatiques (J-1 et H-2)
**Quoi** : mail de rappel automatique au client **24h avant** et **2h avant** son cours.

**Stack mail** : Brevo (déjà utilisé sur le vitrine pour le formulaire contact, worker `yoga-sculpt-contact`).
Réutiliser le compte Brevo Veridian (skill `brevo`). Templates transactionnels.

**Templates à préparer** (charte noir & or, ton premium éditorial Yoga Sculpt) :
- **Rappel J-1** : "Votre cours de demain — [type] le [date] à [heure]". Inclut : lieu (à confirmer avec Alice),
  ce qu'il faut prévoir (tenue, eau), lien d'annulation (si > 24h), bouton "Ajouter à mon agenda" (.ics).
- **Rappel H-2** : version courte "C'est dans 2h ! On vous attend." + lieu + lien itinéraire.
- Version texte + HTML, désinscription, expéditeur `contact@yoga-sculpt.fr`.

**Déclenchement** : cron (via `~/all-cron/`, app `yoga-sculpt/`) qui scanne les `bookings confirmed`
à T-24h et T-2h et envoie via Brevo. Idempotent (colonne `reminder_j1_sent_at` / `reminder_h2_sent_at`
sur `bookings` → migration additive). NE PAS double-envoyer.
- ⚠️ Migration additive `0003_reminders.sql` : `alter table bookings add column reminder_j1_sent_at timestamptz, add column reminder_h2_sent_at timestamptz;`

---

## 3. 🎨 Sidebar dashboard (navigation espace client)
**Quoi** : remplacer le header simple actuel (`AppHeader.tsx`) par une **sidebar** de navigation
pour l'espace client : Mon espace / Réserver / Mes réservations / Mes tickets / Offrir une séance / Profil.

**⚠️ Décision d'archi** : l'app est en **Tailwind 4 + composants maison** (pas de shadcn/radix actuellement).
Deux options :
- **A (reco)** : sidebar **maison** dans la DA noir & or existante (cohérente avec Button.tsx, Logo.tsx).
  Zéro nouvelle dépendance, contrôle total du style. Responsive : drawer mobile.
- **B** : installer **shadcn/ui** (`Sidebar` block officiel) → ajoute Radix + CLI shadcn + lucide-react.
  Plus de boilerplate, mais composants éprouvés. Il faudra reskinner aux couleurs Yoga Sculpt.
Robert a demandé "shadcn" explicitement → defaut = B si maintenu, sinon A. **À confirmer.**

**Inclut** : état actif, collapse desktop, drawer mobile, footer sidebar (déconnexion + nom user).

---

## 4. 🎁 Offrir une séance à un ami (carte cadeau)
**Quoi** : bouton "Offrir une séance" → l'utilisateur paie un ticket destiné à un proche,
qui reçoit un **code cadeau** par email à utiliser sur l'app.

**Flux** :
- Page/modal : choix de la formule (collectif/particulier/carte10) + email + message du destinataire.
- Stripe Checkout (réutilise `/api/checkout`, déjà là) avec `metadata[gift]=true`, `metadata[recipient_email]`.
- Webhook Stripe (`/api/webhooks/stripe`, déjà là) → au lieu de créditer l'acheteur, génère un **code cadeau**
  (table `gift_codes` : code, type, quantite, claimed_by, claimed_at, created_by, recipient_email, expires_at).
- Email au destinataire (Brevo) : "Quelqu'un vous offre une séance de Yoga Sculpt 🎁" + code + lien.
- Page `/espace/cadeau` : saisir un code → crédite un ticket sur le compte connecté (idempotent, anti-rejeu).
- ⚠️ Migration additive `gift_codes` + RLS.

---

## 5. 🚀 Growth — ticket offert (parrainage + avis auto-déclaratif)
**Demande Robert** : ticket gratuit pour un ami / contre un avis Google. Compliance Google
explicitement mise de côté (volume minuscule, on verra plus tard — décision Robert 2026-06-18).

**⚠️ Limite TECHNIQUE (pas légale), à connaître** : aucune API Google (Business Profile / Places)
ne permet de vérifier qu'un email donné a laissé un avis — les avis ne sont pas reliés à une
adresse exploitable côté API. Donc "vérifier automatiquement qu'un avis a été laissé" = **impossible
à brancher**, quelle que soit l'API. On ne code donc PAS de vérification d'avis. À la place :

- **5a — Parrainage (ami par email)** : l'utilisateur saisit l'email d'un ami → l'ami reçoit un ticket
  gratuit (code ou crédit direct à l'inscription avec cet email). Aucune vérif. Codable maintenant.
  Table `referrals` (parrain, email filleul, statut, ticket_credite). Recoupe le lot 4 (cadeau) — mutualiser.
- **5b — Avis auto-déclaratif (confiance)** : bouton "J'ai laissé un avis → récupérer mon ticket" qui
  ouvre la fiche Google (lien direct) puis crédite 1 ticket au clic de retour, SANS vérification.
  On fait confiance ; à ce volume la triche est négligeable. Anti-rejeu simple (1 fois par compte).
- **5c — Ticket de bienvenue** : 1 ticket d'essai offert à la création de compte, sans condition.

→ V1 : faire **5a (parrainage par email)** + **5c (ticket bienvenue)** ; **5b** si Robert le veut
(auto-déclaratif, pas de vérif). Pas de branchement API Google review (techniquement impossible).

---

## Notes transverses
- Toute nouvelle table = migration additive versionnée (`supabase/migrations/`), RLS calquée sur 0001/0002,
  écritures serveur via `service_role` (cf `src/lib/supabase/service.ts`).
- Tous les envois mail via Brevo (skill `brevo`), expéditeur `contact@yoga-sculpt.fr` (SPF/DKIM déjà OK côté CF).
- Crons via `~/all-cron/` app `yoga-sculpt/`, jamais de crontab brut.
- Priorité suggérée : 1 (annulation 24h) → 2 (rappels) → 3 (sidebar) → 5c (ticket bienvenue) → 4 (cadeau) → 5a (parrainage) → 5b (invitation avis).
