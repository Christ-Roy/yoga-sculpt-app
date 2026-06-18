import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests de notifierAlice — notification email best-effort sur chaque événement.
 *
 * Comportements clés :
 *   - envoie via Brevo (sendTransactionalEmail) avec le bon destinataire ;
 *   - destinataire = ALICE_NOTIFY_EMAIL si défini, sinon fallback gdry.alice@gmail.com ;
 *   - best-effort : un échec Brevo ne throw PAS, renvoie false ;
 *   - le contenu inclut le type, le client (nom/email/tél) et le créneau.
 */

const sendMock = vi.fn();
vi.mock("@/lib/brevo", () => ({
  sendTransactionalEmail: (...args: unknown[]) => sendMock(...args),
}));

const BASE_PAYLOAD = {
  type: "particulier" as const,
  startsAt: "2026-06-23T08:00:00.000Z",
  endsAt: "2026-06-23T09:00:00.000Z",
  clientNom: "Marie Dupont",
  clientEmail: "marie@example.com",
  clientTel: "+33612345678",
};

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue(undefined);
  delete process.env.ALICE_NOTIFY_EMAIL;
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe("notifierAlice", () => {
  it("envoie une notif de réservation et renvoie true", async () => {
    const { notifierAlice } = await import("@/lib/notify-alice");
    const ok = await notifierAlice("reservation", BASE_PAYLOAD);
    expect(ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      htmlContent: string;
      textContent: string;
    };
    // Fallback destinataire (ALICE_NOTIFY_EMAIL absent).
    expect(call.to).toBe("gdry.alice@gmail.com");
    expect(call.subject).toContain("Nouvelle réservation");
    // Contenu : client + email + tél présents.
    expect(call.textContent).toContain("Marie Dupont");
    expect(call.textContent).toContain("marie@example.com");
    expect(call.textContent).toContain("+33612345678");
    expect(call.htmlContent).toContain("Cours particulier");
  });

  it("utilise ALICE_NOTIFY_EMAIL quand défini", async () => {
    process.env.ALICE_NOTIFY_EMAIL = "alice.pro@yoga-sculpt.fr";
    const { notifierAlice } = await import("@/lib/notify-alice");
    await notifierAlice("reservation", BASE_PAYLOAD);
    const call = sendMock.mock.calls[0][0] as { to: string };
    expect(call.to).toBe("alice.pro@yoga-sculpt.fr");
  });

  it("compose un objet d'annulation distinct", async () => {
    const { notifierAlice } = await import("@/lib/notify-alice");
    await notifierAlice("annulation", { ...BASE_PAYLOAD, type: "collectif" });
    const call = sendMock.mock.calls[0][0] as { subject: string };
    expect(call.subject).toContain("Annulation");
  });

  it("best-effort : un échec Brevo ne throw PAS et renvoie false", async () => {
    sendMock.mockRejectedValueOnce(new Error("Brevo 500"));
    const { notifierAlice } = await import("@/lib/notify-alice");
    const ok = await notifierAlice("reservation", BASE_PAYLOAD);
    expect(ok).toBe(false);
  });

  it("tolère un client sans nom (fallback email)", async () => {
    const { notifierAlice } = await import("@/lib/notify-alice");
    await notifierAlice("reservation", {
      ...BASE_PAYLOAD,
      clientNom: null,
    });
    const call = sendMock.mock.calls[0][0] as { textContent: string };
    expect(call.textContent).toContain("marie@example.com");
  });
});
