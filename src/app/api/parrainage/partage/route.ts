import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/events";

/**
 * POST /api/parrainage/partage — tracking best-effort d'un partage de lien.
 *
 * Émis par le composant client `ShareInvitation` lorsqu'un membre partage son
 * lien de parrainage via le partage NATIF du téléphone (Web Share API) ou par
 * copie du lien. C'est l'équivalent « lien partagé » du flux e-mail
 * `POST /api/parrainage/inviter`, MAIS :
 *
 *   - on NE connaît PAS l'e-mail du destinataire (le partage natif est opaque :
 *     l'OS ouvre WhatsApp/SMS/etc. sans nous dire vers qui) ;
 *   - on ne crée donc AUCUN `referral` (pas d'e-mail = pas de ligne d'invitation
 *     possible) → ZÉRO impact sur l'idempotence / l'anti-abus du parrainage.
 *
 * Effet unique : journaliser un event `referral_invited` (metadata `via:"share"`)
 * pour que les agrégats /admin/insights comptent aussi le levier viral mobile.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ CONTRAT — réponses :                                                      │
 * │   204 (No Content)        : event journalisé (ou avalé, best-effort).     │
 * │   401 { error }           : non authentifié.                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Best-effort absolu : aucune validation de corps (le client n'envoie rien
 * d'exploitable côté abus), `logEvent` ne throw jamais. Le partage côté client
 * ne doit pas dépendre de la réussite de cet appel.
 *
 * Runtime edge (Cloudflare Workers).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentification requise." },
      { status: 401 },
    );
  }

  // Tracking best-effort : ne crée AUCUN referral, journalise seulement le geste
  // de partage (levier viral mobile). N'altère jamais l'état du parrainage.
  void logEvent(user.id, "referral_invited", { via: "share" }, {
    source: "share",
  });

  return new NextResponse(null, { status: 204 });
}

// Le tracking de partage se fait uniquement en POST.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
