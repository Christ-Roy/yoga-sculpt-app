import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";

export function AppHeader({ userLabel }: { userLabel: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <Link href="/espace" aria-label="Mon espace">
          <Logo className="text-lg" />
        </Link>
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
