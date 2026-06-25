import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  renderEmail,
  textFromBlocks,
  renderBlocParrain,
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

/**
 * Régression du fix `faca9a3` (vague 1) — bloc « profil parrain » dans l'email
 * d'invitation Brevo (avatar + prénom + e-mail).
 *
 * Enjeux couverts :
 *   - BEST-EFFORT : prénom absent/vide → bloc OMIS (`""`), jamais d'email cassé ;
 *   - SÉCURITÉ (anti-XSS) : prénom ET e-mail sont du contenu DYNAMIQUE injecté
 *     dans du HTML → DOIVENT être échappés (escapeHtml) ;
 *   - AVATAR : URL http(s) acceptée telle quelle ; toute autre forme
 *     (`data:`, `javascript:`, chemin relatif…) REJETÉE → fallback initiale
 *     (le bloc ne doit JAMAIS poser une URL d'image dangereuse) ;
 *   - FALLBACK initiale : pas d'avatar → médaillon initiale (1re lettre, MAJ) ;
 *   - e-mail optionnel (présent/absent selon params).
 */
describe("renderBlocParrain — bloc profil parrain (email invitation)", () => {
  it("BEST-EFFORT : prénom null/vide/espaces → bloc omis (chaîne vide)", () => {
    expect(renderBlocParrain({ prenom: null, email: "x@y.fr" })).toBe("");
    expect(renderBlocParrain({ prenom: "", email: "x@y.fr" })).toBe("");
    expect(renderBlocParrain({ prenom: "   ", email: "x@y.fr" })).toBe("");
  });

  it("rend le prénom et l'e-mail quand le parrain est résolu", () => {
    const html = renderBlocParrain({ prenom: "Alice", email: "alice@gmail.com" });
    expect(html).not.toBe("");
    expect(html).toContain("Alice");
    expect(html).toContain("vous invite");
    expect(html).toContain("alice@gmail.com");
    // Table-based (clients email) — pas de flex/grid.
    expect(html).toContain("<table");
    expect(html).not.toMatch(/display\s*:\s*(flex|grid)/);
  });

  it("SÉCURITÉ : échappe le PRÉNOM (pas de balise script brute)", () => {
    const html = renderBlocParrain({
      prenom: `<script>alert(1)</script>`,
      email: "x@y.fr",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("SÉCURITÉ : échappe l'E-MAIL (un e-mail piégé ne casse pas le HTML)", () => {
    const html = renderBlocParrain({
      prenom: "Bob",
      email: `a"<b>@y.fr`,
    });
    expect(html).not.toContain(`a"<b>@y.fr`);
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&quot;");
  });

  it("AVATAR http(s) : URL injectée dans un <img src=...>", () => {
    const url = "https://lh3.googleusercontent.com/a/avatar=s96-c";
    const html = renderBlocParrain({ prenom: "Alice", email: null, avatarUrl: url });
    expect(html).toContain("<img");
    expect(html).toContain(`src="${url}"`);
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("SÉCURITÉ : avatar non-http(s) (data:/javascript:/relatif) REJETÉ → fallback initiale", () => {
    for (const mauvais of [
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "//evil.com/x.png",
      "/relatif.png",
      "ftp://x/y.png",
    ]) {
      const html = renderBlocParrain({
        prenom: "Alice",
        email: null,
        avatarUrl: mauvais,
      });
      // L'URL dangereuse n'est JAMAIS posée comme src d'image.
      expect(html).not.toContain(`src="${mauvais}"`);
      expect(html).not.toContain("<img");
      // Fallback : médaillon initiale (1re lettre, majuscule).
      expect(html).toContain("A");
    }
  });

  it("FALLBACK initiale : sans avatar → 1re lettre en MAJUSCULE, pas d'<img>", () => {
    const html = renderBlocParrain({ prenom: "alice", email: null });
    expect(html).not.toContain("<img");
    // Initiale majuscule du prénom minuscule.
    expect(html).toContain(">A</td>");
  });

  it("e-mail optionnel : absent → pas de ligne e-mail, mais le bloc reste rendu", () => {
    const sans = renderBlocParrain({ prenom: "Alice", email: null });
    expect(sans).not.toBe("");
    expect(sans).toContain("Alice");
    // Couleur muted = ligne e-mail ; absente quand pas d'email.
    expect(sans).not.toContain(COULEURS.muted);

    const avec = renderBlocParrain({ prenom: "Alice", email: "alice@gmail.com" });
    expect(avec).toContain(COULEURS.muted);
  });

  it("trim le prénom avant rendu (espaces parasites ignorés)", () => {
    const html = renderBlocParrain({ prenom: "  Léa  ", email: null });
    expect(html).toContain(">L</td>"); // initiale du prénom trimé
    expect(html).toContain("Léa");
    expect(html).not.toContain("  Léa  ");
  });
});
