# [P1] Lieu du cours incohérent entre écrans (dashboard force "Parc de la Tête d'Or" en dur)

> QA-cohérence UI · 2026-06-19 · agent · LECTURE SEULE (finding, pas de fix appliqué)

## Le problème
La **source de vérité du lieu** d'un cours est le champ `location` de l'event Google
Calendar d'Alice. C'est le contrat documenté et appliqué partout :
- `src/lib/reservation.ts` (`Creneau.lieu` ← `event.location?.trim() || undefined`)
- `src/components/LieuMaps.tsx` (affiche le lieu ou « Lieu à confirmer » si vide)
- `src/components/ReserverClient.tsx` (CreneauCard → `<LieuMaps lieu={creneau.lieu} />`)
- `src/components/MesReservations.tsx` (affiche `b.lieu` seulement s'il est enrichi)
- `src/app/admin/calendrier/CalendrierClient.tsx` : Alice **saisit** le lieu en texte
  libre (défaut « Parc de la Tête d'Or », mais elle peut mettre une salle/un local l'hiver).

**MAIS** le dashboard `/espace` écrase cette source : il force un lieu CODÉ EN DUR sur
**toutes** les séances à venir, collectif ET particulier :

```ts
// src/app/espace/page.tsx:38
const LIEU_COURS = "Parc de la Tête d'Or";
// …puis appliqué à chaque séance (l.105) :
seances = bookingRows.map((b) => ({ …, lieu: LIEU_COURS }));
```

Et le widget « Réserver » l'affiche aussi en dur (`src/components/espace/ReserverWidget.tsx`) :
« Cours en plein air au **Parc de la Tête d'Or** — collectif le vendredi soir ».

## Conséquence visible (incohérence cliente)
Pour **la même réservation**, le client voit DEUX lieux différents selon l'écran :
- Widget « Mes séances à venir » (dashboard) → toujours « 📍 Parc de la Tête d'Or »
  (pastille Maps cliquable), **même si Alice a mis le cours en salle** dans Google.
- Page « Mes réservations » (`/espace/reservations`) → pas de lieu du tout (le booking
  ne stocke pas le lieu, et la page ne l'enrichit pas depuis Google → champ absent).
- Page « Réserver » (`/espace/reserver`) → le **vrai** lieu Google (ou « Lieu à confirmer »).

Donc : un cours d'hiver en local affichera quand même « Parc de la Tête d'Or » sur le
dashboard. Le client peut se présenter au mauvais endroit. Le .ics téléchargé (route
`/api/ics`, qui relit Google) portera lui le bon lieu → contradiction directe entre
ce qui est affiché et ce qui est dans l'agenda du client.

## Contexte produit (prompt Robert)
« Le lieu (Parc Tête d'Or été / local) est-il cohérent côté app ? » → réponse : NON.
Il existe bien une notion été (plein air) / hiver (local), Alice la gère via le champ
Lieu de chaque event. Le dur dans le dashboard casse ce mécanisme.

## Correctif recommandé
Faire passer le **vrai lieu Google** jusqu'au dashboard ET à la page « Mes réservations »,
au lieu d'inventer une constante :
- `/espace/page.tsx` et `/espace/reservations/page.tsx` chargent déjà les bookings
  (id, type, starts_at, ends_at) ; il faut **joindre le lieu** depuis l'event Google
  correspondant (les bookings ont un `google_event_id` — cf `ReserverParticulierLibre`).
  Soit un `listEvents` sur la fenêtre + map par event id, soit enrichissement ponctuel.
- Supprimer `LIEU_COURS` en dur ; si le lieu est inconnu (Google KO), laisser `LieuMaps`
  afficher « Lieu à confirmer » plutôt qu'un lieu potentiellement faux.
- `ReserverWidget` : le texte « Parc de la Tête d'Or — collectif le vendredi soir » est
  une **promesse marketing figée**. Soit l'assumer comme accroche générique (acceptable),
  soit la neutraliser ; mais elle ne doit pas être prise pour le lieu réel d'une séance.

## Sévérité
**P1** : information erronée potentielle sur un lieu de rendez-vous physique (le client
peut se déplacer au mauvais endroit), incohérence visible d'un écran à l'autre pour la
même réservation. C'est le finding de cohérence le plus impactant de l'app.

## Fichiers
- `src/app/espace/page.tsx` (const `LIEU_COURS`, l.38 + usage l.95-106)
- `src/app/espace/reservations/page.tsx` (lieu jamais enrichi)
- `src/components/espace/ReserverWidget.tsx` (lieu marketing en dur)
- (référence du contrat correct) `src/lib/reservation.ts`, `src/components/LieuMaps.tsx`
