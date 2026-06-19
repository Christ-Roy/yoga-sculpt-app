/**
 * Fond nébuleux animé (brume dorée vivante) pour les écrans auth / onboarding.
 * Les 3 couches `.neb` tournent/respirent en continu (cf. .auth-bg dans globals.css).
 * Purement décoratif.
 */
export function AuthBackground() {
  return (
    <div className="auth-bg" aria-hidden="true">
      <span className="neb neb-1" />
      <span className="neb neb-2" />
      <span className="neb neb-3" />
    </div>
  );
}
