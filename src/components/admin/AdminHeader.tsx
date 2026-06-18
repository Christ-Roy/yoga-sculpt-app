import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * En-tête de navigation du dashboard Alice.
 *
 * Nav admin SIMPLE et maison (décision d'archi : pas de sidebar shadcn pour
 * l'instant — lot futur). Reprend la charte NOIR & OR + le wordmark, avec un
 * badge « Admin » or pour bien distinguer cet espace de l'espace client.
 */
export function AdminHeader({ userLabel }: { userLabel: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <Logo className="text-lg" />
          <span className="rounded-[4px] border border-accent/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-accent">
            Admin
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-text-secondary sm:inline">
            {userLabel}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
