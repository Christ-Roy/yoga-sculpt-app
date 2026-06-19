import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autorise le hot reload depuis le dev server Tailscale (sinon Next bloque les
  // ressources dev cross-origin → l'hydratation ne démarre pas, page inerte).
  // Sans effet en prod (OpenNext/Worker n'utilise pas le dev server).
  allowedDevOrigins: ["100.92.215.42", "*.ts.net", "localhost"],
};

export default nextConfig;
