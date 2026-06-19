import { AuthMethods } from "@/components/AuthMethods";

/**
 * Formulaire de connexion de /login.
 *
 * Mince enveloppe autour du composant d'auth PARTAGÉ `AuthMethods` (Google +
 * Microsoft + magic-link). La logique a été factorisée dans `AuthMethods` pour
 * être réutilisée à l'identique par la landing d'invitation `/invitation` —
 * mêmes actions serveur, même callback `/auth/callback` (qui consomme le cookie
 * de parrainage `ys_ref`). Ne PAS dupliquer les boutons d'auth ici.
 */
export function LoginForm({ initialError }: { initialError?: string }) {
  return <AuthMethods initialError={initialError} />;
}
