import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Hook : true quand la largeur de viewport < 768px.
 * Utilisé par la Sidebar pour basculer en mode drawer (Sheet) sur mobile.
 *
 * Implémenté avec `useSyncExternalStore` (plutôt que useState+useEffect) :
 * c'est l'outil React idoine pour s'abonner à un store externe comme
 * `matchMedia`, sans setState synchrone dans un effect (cascading renders).
 * Le snapshot serveur renvoie `false` (pas de window au SSR) → pas de mismatch.
 */
export function useIsMobile() {
  const subscribe = React.useCallback((onChange: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const getSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT;
  const getServerSnapshot = () => false;

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
