# [P2] Encart post-réservation — bouton "Groupe WhatsApp" à côté de "Ajouter à Google Agenda"

**Statut** : à faire · **Qui** : agent · **Source** : demande Robert 2026-06-19

## Besoin
Pour les clients qui ont réservé, afficher — à côté du bouton "Ajouter à Google Agenda"
dans l'encart de confirmation — un bouton/lien vers le **groupe WhatsApp** de la communauté
Yoga Sculpt. Renforce le lien communautaire (cohérent « le yoga c'est mieux entre ami(e)s »).

Lien fourni : `https://chat.whatsapp.com/In0pbYYeHvw8ygthGWYFA1`

## ⚠️ Permanence du lien — METTRE EN VARIABLE D'ENV (pas en dur)
Un lien d'invitation de groupe WhatsApp reste valide TANT QUE l'admin (Alice) ne le
réinitialise pas. Mais elle PEUT le révoquer/régénérer à tout moment depuis WhatsApp →
l'ancien lien meurt. Donc :
- Stocker le lien dans une env **`NEXT_PUBLIC_WHATSAPP_GROUP_URL`** (c'est un lien public,
  affiché côté client → `NEXT_PUBLIC_` OK, pas un secret).
- Si Alice change le lien : on met à jour la var (GitHub Secret `*_NEXT_PUBLIC_WHATSAPP_GROUP_URL`
  staging + prod, injecté au build) + redeploy, SANS toucher au code.
- **Fail-safe** : si la var est absente/vide → ne PAS afficher le bouton (pas de lien mort).
- Documenter dans `.env.example` (section App) + poser la valeur sur les builds staging & prod.

## Implémentation
- Composant cible : `src/components/AddToCalendar.tsx` (l'encart "Ajouter à mon agenda",
  utilisé par ReserverClient / MesReservations / SeancesAVenirWidget). Ajouter à côté des
  boutons existants (Google Agenda + .ics) un bouton "Rejoindre le groupe WhatsApp"
  (icône WhatsApp, ouvre le lien dans un nouvel onglet `target="_blank" rel="noopener noreferrer"`).
- DA noir & or, cohérent avec les boutons existants de l'encart. Responsive.
- N'afficher QUE quand il y a au moins une réservation (logique de l'encart) ET que la var est définie.

## Fichiers
`src/components/AddToCalendar.tsx`, `.env.example` (doc de NEXT_PUBLIC_WHATSAPP_GROUP_URL),
+ poser la var sur les builds (GitHub Secrets staging/prod). Pas de test serveur nécessaire
(composant client), éventuel test de rendu conditionnel (var présente/absente).
