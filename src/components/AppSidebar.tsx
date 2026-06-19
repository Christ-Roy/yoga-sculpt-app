"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, Gift, Home, LogOut, Ticket } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

/** Nombre max de tickets gagnables par parrainage (1 par filleul, plafond 3). */
const PARRAINAGE_MAX = 3;

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
  { href: "/espace/parrainer", label: "Parrainer", icon: Gift },
] as const;

/**
 * Sidebar de l'espace client (charte NOIR & OR).
 *
 * - Header : logo Yoga Sculpt (médaillon + wordmark ; médaillon seul replié).
 * - Contenu : liens vers les pages de l'espace, item actif souligné en OR.
 * - Footer : nom de l'utilisateur + bouton déconnexion.
 *
 * Le lien actif est déterminé via `usePathname` (match exact pour `/espace`
 * afin de ne pas allumer l'accueil sur les sous-pages, préfixe sinon).
 */
export function AppSidebar({ userLabel }: { userLabel: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Tickets de parrainage encore à gagner (PARRAINAGE_MAX - déjà gagnés).
  // > 0 → pastille rouge animée sur "Parrainer" pour inciter à inviter.
  const [ticketsAGagner, setTicketsAGagner] = useState(0);
  useEffect(() => {
    let annule = false;
    fetch("/api/parrainage", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (annule || !d) return;
        const restant = PARRAINAGE_MAX - (d.ticketsGagnes ?? 0);
        setTicketsAGagner(Math.max(0, restant));
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, []);

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
          {/* Logo complet (médaillon + wordmark) quand la sidebar est dépliée. */}
          <Logo
            title="Yoga Sculpt — espace"
            className="group-data-[collapsible=icon]:hidden"
          />
          {/* Médaillon seul quand la sidebar est repliée (espace étroit). */}
          <Logo
            title="Yoga Sculpt — espace réduit"
            showText={false}
            className="hidden group-data-[collapsible=icon]:inline-flex"
          />
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
                      <Link href={lien.href} className="relative">
                        <span className="relative">
                          <Icone />
                          {/* Pastille rouge animée : tickets de parrainage à gagner */}
                          {lien.href === "/espace/parrainer" &&
                            ticketsAGagner > 0 && (
                              <span
                                className="absolute -right-1 -top-1 flex h-2.5 w-2.5"
                                aria-hidden="true"
                              >
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                              </span>
                            )}
                        </span>
                        <span>{lien.label}</span>
                        {lien.href === "/espace/parrainer" &&
                          ticketsAGagner > 0 && (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[0.65rem] font-semibold text-white">
                              {ticketsAGagner}
                            </span>
                          )}
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
