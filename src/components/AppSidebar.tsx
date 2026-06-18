"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, Home, LogOut, Ticket } from "lucide-react";
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
} from "@/components/ui/sidebar";

/** Liens de navigation de l'espace client. */
const LIENS = [
  { href: "/espace", label: "Mon espace", icon: Home },
  { href: "/espace/reserver", label: "Réserver", icon: CalendarPlus },
  { href: "/espace/reservations", label: "Mes réservations", icon: Ticket },
] as const;

/**
 * Sidebar de l'espace client (charte NOIR & OR).
 *
 * - Header : wordmark "YOGA SCULPT".
 * - Contenu : liens vers les pages de l'espace, item actif souligné en OR.
 * - Footer : nom de l'utilisateur + bouton déconnexion.
 *
 * Le lien actif est déterminé via `usePathname` (match exact pour `/espace`
 * afin de ne pas allumer l'accueil sur les sous-pages, préfixe sinon).
 */
export function AppSidebar({ userLabel }: { userLabel: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const estActif = (href: string) =>
    href === "/espace" ? pathname === href : pathname.startsWith(href);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/espace"
          aria-label="Mon espace"
          className="flex items-center px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <Logo className="text-lg group-data-[collapsible=icon]:hidden" />
          {/* Monogramme compact quand la sidebar est repliée. */}
          <span
            aria-hidden
            className="wordmark hidden text-lg text-accent group-data-[collapsible=icon]:inline"
          >
            YS
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {LIENS.map((lien) => {
                const Icone = lien.icon;
                return (
                  <SidebarMenuItem key={lien.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={estActif(lien.href)}
                      tooltip={lien.label}
                    >
                      <Link href={lien.href}>
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
          <p className="truncate text-xs text-text-secondary">Connecté en tant que</p>
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
