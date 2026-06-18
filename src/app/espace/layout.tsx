import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarTopbar } from "@/components/SidebarTopbar";
import { FingerprintCollector } from "@/components/FingerprintCollector";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * Layout de l'espace client : enveloppe toutes les pages `/espace/*` avec la
 * sidebar de navigation (charte NOIR & OR).
 *
 * - Récupère le profil pour afficher le nom dans le footer de la sidebar.
 *   (Les pages refont leur propre `getUser()` + redirections métier : ici on
 *   se contente d'un garde-fou auth et du label.)
 * - L'état replié/déplié de la sidebar est lu depuis le cookie `sidebar_state`
 *   pour que le SSR corresponde au rendu client (pas de flash).
 *
 * Desktop : sidebar collapsible (icônes). Mobile : drawer via `SidebarTopbar`.
 */
export default async function EspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const userLabel = profile?.full_name || profile?.email || user.email || "";

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar userLabel={userLabel} />
      <SidebarInset>
        <SidebarTopbar />
        {children}
      </SidebarInset>
      {/* Collecte anti-abus du parrainage (silencieuse, best-effort, 1×/session). */}
      <FingerprintCollector />
    </SidebarProvider>
  );
}
