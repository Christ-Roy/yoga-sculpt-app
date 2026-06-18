import { cookies } from "next/headers";

import { requireAdmin } from "@/lib/admin";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { SidebarTopbar } from "@/components/SidebarTopbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * Layout du dashboard admin (`/admin/*`) : sidebar de pilotage NOIR & OR.
 *
 * `requireAdmin()` est appelé EN TÊTE (défense en profondeur, indépendante du
 * middleware) : un non-admin est redirigé avant tout rendu du shell. Les pages
 * appellent aussi `requireAdmin()` pour leurs données — c'est volontaire et
 * sans coût notable (lecture de session déjà mise en cache par requête).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AdminSidebar userLabel={admin.email} />
      <SidebarInset>
        <SidebarTopbar label="Admin" />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
