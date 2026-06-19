import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  renderEmail,
  textFromBlocks,
  COULEURS,
} from "@/lib/email-templates";

/**
 * Tests de src/lib/email-templates.ts — layout email factorisé (charte noir & or).
 *
 * Enjeu PRINCIPAL = SÉCURITÉ (anti-XSS) : titre, preheader, libellé de CTA et
 * footerNote sont du contenu DYNAMIQUE (prénom user, nom de parrain…) injecté
 * dans du HTML. Le module DOIT les échapper. On vérifie :
 *   - escapeHtml échappe les 5 caractères sensibles ;
 *   - renderEmail échappe titre / preheader / CTA label / footerNote ;
 *   - renderEmail N'échappe PAS corpsHtml (HTML maîtrisé par l'appelant) ;
 *   - structure attendue (DOCTYPE, 600px, preheader caché, couleurs charte) ;
 *   - CTA / footerNote / unsubscribe optionnels (présents/absents selon params) ;
 *   - textFromBlocks joint les lignes avec des sauts de ligne.
 */

describe("escapeHtml", () => {
  it("échappe les 5 caractères HTML sensibles", () => {
    expect(escapeHtml(`<a href="x" data-y='z'>&`)).toBe(
      "&lt;a href=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;",
    );
  });

  it("échappe & EN PREMIER (pas de double-échappement des entités)", () => {
    // Si '<' était échappé avant '&', on obtiendrait "&amp;lt;" — bug classique.
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("laisse un texte sans caractère spécial intact", () => {
    expect(escapeHtml("Alice Gaudry")).toBe("Alice Gaudry");
  });
});

describe("renderEmail — sécurité (échappement du contenu dynamique)", () => {
  const PAYLOAD = `<script>alert(1)</script>`;

  it("échappe le TITRE (pas de balise script brute dans le HTML)", () => {
    const { html } = renderEmail({
      preheader: "p",
      titre: PAYLOAD,
      corpsHtml: "<p>ok</p>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("échappe le PREHEADER", () => {
    const { html } = renderEmail({
      preheader: PAYLOAD,
      titre: "t",
      corpsHtml: "<p>ok</p>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("échappe le LIBELLÉ du CTA", () => {
    const { html } = renderEmail({
      preheader: "p",
      titre: "t",
      corpsHtml: "<p>ok</p>",
      cta: { label: PAYLOAD, url: "https://app.yoga-sculpt.fr" },
    });
    // Le label apparaît échappé ; pas de balise brute.
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain(`>${PAYLOAD}</a>`);
  });

  it("échappe la footerNote", () => {
    const { html } = renderEmail({
      preheader: "p",
      titre: "t",
      corpsHtml: "<p>ok</p>",
      footerNote: PAYLOAD,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("N'échappe PAS corpsHtml (HTML déjà construit par l'appelant)", () => {
    const corps = `<p style="margin:0"><strong>Bonjour</strong></p>`;
    const { html } = renderEmail({ preheader: "p", titre: "t", corpsHtml: corps });
    expect(html).toContain(corps);
  });
});

describe("renderEmail — structure & options", () => {
  it("produit un document HTML complet (DOCTYPE, viewport, 600px, charte)", () => {
    const { html } = renderEmail({
      preheader: "Aperçu",
      titre: "Titre",
      corpsHtml: "<p>Corps</p>",
    });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('lang="fr"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain(COULEURS.ink);
    expect(html).toContain(COULEURS.gold);
    // Wordmark + footer.
    expect(html).toContain("SCULPT");
    expect(html).toContain("yoga-sculpt.fr");
  });

  it("rend le bouton CTA quand fourni, l'omet sinon", () => {
    const url = "https://app.yoga-sculpt.fr/espace/reserver";
    const avec = renderEmail({
      preheader: "p",
      titre: "t",
      corpsHtml: "<p>ok</p>",
      cta: { label: "Réserver", url },
    }).html;
    expect(avec).toContain(`href="${url}"`);
    expect(avec).toContain("Réserver");

    const sans = renderEmail({ preheader: "p", titre: "t", corpsHtml: "<p>ok</p>" }).html;
    expect(sans).not.toContain("/espace/reserver");
  });

  it("affiche le lien de désinscription par défaut ({{unsubscribe}}) et le masque si null", () => {
    const def = renderEmail({ preheader: "p", titre: "t", corpsHtml: "<p>ok</p>" }).html;
    expect(def).toContain("{{unsubscribe}}");
    expect(def).toContain("Se désinscrire");

    const masque = renderEmail({
      preheader: "p",
      titre: "t",
      corpsHtml: "<p>ok</p>",
      unsubscribeUrl: null,
    }).html;
    expect(masque).not.toContain("Se désinscrire");

    const custom = renderEmail({
      preheader: "p",
      titre: "t",
      corpsHtml: "<p>ok</p>",
      unsubscribeUrl: "https://x.fr/unsub?u=1",
    }).html;
    expect(custom).toContain("https://x.fr/unsub?u=1");
  });
});

describe("textFromBlocks", () => {
  it("joint les lignes avec des sauts de ligne (les vides → lignes vides)", () => {
    expect(textFromBlocks(["Bonjour,", "", "Réservez.", ""])).toBe(
      "Bonjour,\n\nRéservez.\n",
    );
  });

  it("une seule ligne reste telle quelle", () => {
    expect(textFromBlocks(["x"])).toBe("x");
  });
});
