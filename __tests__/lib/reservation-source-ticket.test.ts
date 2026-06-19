import { describe, it, expect } from "vitest";
import {
  categoriserSourceTicket,
  detailSourceTicket,
  type CategorieSourceTicket,
} from "@/lib/reservation";
import type { TicketSource } from "@/lib/db-types";

/**
 * Tests PURS de la classification « payé vs offert » d'un ticket consommé.
 *
 * Sert au badge du back-office réservations (`SourceBadge`) : Alice doit voir
 * d'un coup d'œil si une place a été achetée (Stripe) ou offerte (essai /
 * parrainage / geste). Toute la logique métier est concentrée ici, pure et
 * déterministe — le mapping vers la donnée (`bookings.ticket_id → tickets.source`)
 * vit dans `src/app/admin/reservations/_data.ts` (hors périmètre vitest).
 */

describe("categoriserSourceTicket", () => {
  it("classe un ticket Stripe comme PAYÉ", () => {
    expect(categoriserSourceTicket("paid")).toBe<CategorieSourceTicket>("paye");
  });

  it.each<TicketSource>(["welcome", "referral", "admin"])(
    "classe le ticket gratuit '%s' comme OFFERT",
    (source) => {
      expect(categoriserSourceTicket(source)).toBe<CategorieSourceTicket>(
        "offert",
      );
    },
  );

  it("classe une source absente (null/undefined) comme INCONNU", () => {
    expect(categoriserSourceTicket(null)).toBe<CategorieSourceTicket>("inconnu");
    expect(categoriserSourceTicket(undefined)).toBe<CategorieSourceTicket>(
      "inconnu",
    );
  });

  it("couvre exhaustivement toutes les sources connues (pas de trou)", () => {
    const sources: TicketSource[] = ["paid", "welcome", "referral", "admin"];
    for (const s of sources) {
      expect(categoriserSourceTicket(s)).not.toBe("inconnu");
    }
  });
});

describe("detailSourceTicket", () => {
  it("renvoie un sous-libellé lisible pour chaque source connue", () => {
    expect(detailSourceTicket("paid")).toBe("Acheté");
    expect(detailSourceTicket("welcome")).toBe("Séance d'essai");
    expect(detailSourceTicket("referral")).toBe("Parrainage");
    expect(detailSourceTicket("admin")).toBe("Geste commercial");
  });

  it("renvoie null quand la source est absente", () => {
    expect(detailSourceTicket(null)).toBeNull();
    expect(detailSourceTicket(undefined)).toBeNull();
  });
});
