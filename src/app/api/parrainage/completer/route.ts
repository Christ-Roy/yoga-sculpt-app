import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { completerReferral, enregistrerSignaux } from "@/lib/referral";
import { logEvent } from "@/lib/events";
import { getClientIp } from "@/lib/anti-abuse";
import { hashFingerprint } from "@/lib/fingerprint";

/**
 * POST /api/parrainage/completer — complète le parrainage d'un FILLEUL qui vient
 * de s'inscrire avec un code, et capte ses signaux anti-abus (IP + fingerprint).
 *
 * Appelé par l'agent UI APRÈS l'inscription (typiquement au 1er chargement de
 * l'espace / fin d'onboarding), avec :
 *   - `code`        : le code de parrainage suivi (lu du cookie `?ref=` déposé
 *                     avant le login par l'UI). Optionnel : sans code, on se
 *                     contente d'enregistrer les signaux du compte.
 *   - `fingerprint` : composantes d'empreinte collectées CÔTÉ CLIENT (objet ou
 *                     chaîne). On les hashe ici (jamais stockées en clair).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ÉCHEC SILENCIEUX — POINT CRUCIAL                                          │
 * │   La réponse est TOUJOURS 200 `{ ok: true }` dès lors que la requête est  │
 * │   bien formée et l'utilisateur authentifié — que le crédit ait eu lieu    │
 * │   OU PAS (anti-abus, code inconnu, déjà crédité…). On ne renvoie JAMAIS   │
 * │   « abus détecté », « même IP », « code déjà utilisé »… Le client ne doit │
 * │   rien pouvoir déduire du signal qui a bloqué le crédit.                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ CONTRAT (pour l'agent UI) :                                              │
 * │   POST { code?: string, fingerprint?: object|string }                    │
 * │   → 200 { ok: true }   (toujours, si auth + body valides)                │
 * │   → 400 { error }      (corps JSON invalide)                             │
 * │   → 401 { error }      (non authentifié)                                 │
 * │   Idempotent : peut être rappelé sans risque (pas de double crédit).     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Runtime edge (Cloudflare Workers).
 */

const bodySchema = z
  .object({
    code: z.string().trim().min(1).max(32).optional(),
    // `fingerprint` : soit un objet de composantes, soit une chaîne pré-concaténée.
    fingerprint: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional(),
  })
  .strict();

export async function POST(request: Request) {
  // ── Auth (c'est le filleul connecté qui complète son propre parrainage). ────
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

  // ── Validation du corps ─────────────────────────────────────────────────────
  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = await request.json();
    const result = bodySchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { error: "Requête invalide.", details: result.error.issues },
        { status: 400 },
      );
    }
    parsed = result.data;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const service = createServiceClient();

  // ── Capte les signaux anti-abus du filleul. ─────────────────────────────────
  const ip = getClientIp(request);
  const fingerprint = await hashFingerprint(
    parsed.fingerprint as Parameters<typeof hashFingerprint>[0],
  );
  // Enregistrement best-effort (n'écrase pas une IP déjà captée au callback).
  await enregistrerSignaux(service, { userId: user.id, ip, fingerprint });

  // ── Complète le parrainage si un code a été suivi (sinon on s'arrête là). ───
  if (parsed.code) {
    // Tracking : arrivée effective d'un filleul venu d'un lien (best-effort).
    void logEvent(user.id, "referral_signup", { code: parsed.code }, { service });
    // L'issue (crédité ou non) reste INTERNE : on ne la révèle pas au client.
    await completerReferral(service, {
      code: parsed.code,
      filleulUserId: user.id,
      filleulEmail: user.email ?? "",
      ip,
      fingerprint,
    });
  }

  // Réponse neutre, toujours identique → échec silencieux garanti.
  return NextResponse.json({ ok: true });
}

// La complétion se fait uniquement en POST.
export function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Ce endpoint n'accepte que POST." },
    { status: 405 },
  );
}
