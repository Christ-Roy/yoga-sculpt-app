"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Users,
} from "lucide-react";
import { useTransition } from "react";

import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

/**
 * Liens du dashboard admin (Alice).
 * Back-office complet : vue d'ensemble + pages dédiées Calendrier / Réservations
 * / Comptes / Insights.
 */
const LIENS = [
  { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard },
  { href: "/admin/calendrier", label: "Calendrier", icon: CalendarDays },
  { href: "/admin/reservations", label: "Réservations", icon: ListChecks },
  { href: "/admin/comptes", label: "Comptes", icon: Users },
  { href: "/admin/insights", label: "Insights", icon: BarChart3 },
] as const;

/** Sidebar du dashboard admin (charte NOIR & OR + badge « Admin »). */
export function AdminSidebar({ userLabel }: { userLabel: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // Mobile : referme le drawer après un clic (le layout admin persiste entre les
  // pages /admin, le Sheet resterait ouvert sinon). Desktop : no-op.
  const { isMobile, setOpenMobile } = useSidebar();
  const fermerSiMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          {/* Logo complet (médaillon + wordmark) quand la sidebar est dépliée. */}
          <Logo
            title="Yoga Sculpt — admin"
            className="group-data-[collapsible=icon]:hidden"
          />
          {/* Médaillon seul quand la sidebar est repliée (espace étroit). */}
          <Logo
            title="Yoga Sculpt — admin réduit"
            showText={false}
            className="hidden group-data-[collapsible=icon]:inline-flex"
          />
          <span className="rounded-[var(--radius)] border border-accent/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-accent group-data-[collapsible=icon]:hidden">
            Admin
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Pilotage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {LIENS.map((lien) => {
                const Icone = lien.icon;
                // « Vue d'ensemble » actif uniquement sur la page nue (sans
                // ancre) ; les ancres ne modifient pas le pathname. Les routes
                // dédiées (ex. /admin/insights) s'activent sur match exact.
                const isActive =
                  lien.href === "/admin"
                    ? pathname === "/admin"
                    : !lien.href.includes("#") && pathname === lien.href;
                return (
                  <SidebarMenuItem key={lien.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={lien.label}
                    >
                      <Link href={lien.href} onClick={fermerSiMobile}>
                        <Icone />
                        <span>{lien.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-xs text-text-secondary">Connectée en tant que</p>
          <p className="truncate text-sm font-medium text-text">{userLabel}</p>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Déconnexion"
              disabled={pending}
              onClick={() => startTransition(() => signOut())}
            >
              <LogOut />
              <span>{pending ? "Déconnexion…" : "Déconnexion"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
