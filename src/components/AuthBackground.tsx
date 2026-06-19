/**
 * Fond décoratif des écrans d'authentification / onboarding. Deux variantes :
 *
 *  - `nebula` (défaut) : brume dorée animée (3 couches `.neb` qui tournent en
 *    continu, cf. `.auth-bg` dans globals.css). Utilisé sur l'onboarding et la
 *    landing d'invitation (flows plus longs, l'animation y est agréable).
 *
 *  - `photo` : photo N&B (hero du vitrine) FORTEMENT floutée + voile sombre, pour
 *    un accueil plus chaleureux/premium sur les 1res pages vues (login, confirm).
 *    Le flou + l'overlay (rgba(14,14,14,0.78)) garantissent le contraste AA du
 *    formulaire posé par-dessus. Image décorative (`aria-hidden`), `<img>` natif
 *    (robuste sur l'edge/OpenNext, pas d'optimiseur), `object-cover`, fixée donc
 *    zéro layout shift.
 *
 * Purement décoratif dans les deux cas (`aria-hidden`).
 */
export function AuthBackground({
  variant = "nebula",
}: {
  variant?: "nebula" | "photo";
}) {
  if (variant === "photo") {
    return (
      <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        {/* Photo N&B floutée — mobile (portrait) puis desktop (paysage). */}
        <picture>
          <source
            media="(min-width: 640px)"
            srcSet="/images/auth/auth-bg.webp"
          />
          <img
            src="/images/auth/auth-bg-mobile.webp"
            alt=""
            decoding="async"
            fetchPriority="high"
            className="h-full w-full scale-110 object-cover blur-xl"
          />
        </picture>
        {/* Voile sombre : garde le contraste du formulaire (lisibilité = priorité). */}
        <div className="absolute inset-0 bg-[rgba(14,14,14,0.78)]" />
        {/* Liseré radial doré très discret pour rappeler la charte. */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(212,173,106,0.10),transparent_55%)]" />
      </div>
    );
  }

  return (
    <div className="auth-bg" aria-hidden="true">
      <span className="neb neb-1" />
      <span className="neb neb-2" />
      <span className="neb neb-3" />
    </div>
  );
}
