import type { NextConfig } from "next";

// Échappatoire RAM pour les builds locaux sur la station `mail` (souvent saturée) :
// `next build` lance un worker tsc qui crame le pic mémoire et se fait OOM-killer
// (SIGTERM) quand la machine est tendue. Quand SKIP_TSC_BUILD=1, on saute la
// vérification de types INTÉGRÉE au build — à n'utiliser qu'après un `tsc --noEmit`
// manuel réussi. OFF par défaut : la CI GitHub vérifie toujours les types normalement.
const skipTypeCheck = process.env.SKIP_TSC_BUILD === "1";

const nextConfig: NextConfig = {
  // Autorise le hot reload depuis le dev server Tailscale (sinon Next bloque les
  // ressources dev cross-origin → l'hydratation ne démarre pas, page inerte).
  // Sans effet en prod (OpenNext/Worker n'utilise pas le dev server).
  allowedDevOrigins: ["100.92.215.42", "*.ts.net", "localhost"],
  ...(skipTypeCheck ? { typescript: { ignoreBuildErrors: true } } : {}),
};

export default nextConfig;
