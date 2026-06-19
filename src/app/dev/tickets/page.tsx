import { TicketCard } from "@/components/TicketCard";
import { AuthBackground } from "@/components/AuthBackground";

// Page de PREVIEW dev (à supprimer) — voir les 2 designs de tickets.
export default function TicketsPreview() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center p-8">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-md space-y-6">
        <h1 className="font-display text-3xl text-text">Tickets — preview</h1>
        <TicketCard type="collectif" count={3} />
        <TicketCard type="collectif" count={1} />
        <TicketCard type="particulier" count={2} />
        <TicketCard type="particulier" count={0} />
      </div>
    </main>
  );
}
