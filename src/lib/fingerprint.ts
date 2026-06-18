/**
 * Empreinte d'appareil (device fingerprint) — côté SERVEUR.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RÉPARTITION CLIENT / SERVEUR                                              │
 * │                                                                           │
 * │  • CÔTÉ CLIENT (agent UI) : collecte les COMPOSANTES de l'empreinte       │
 * │    (user-agent, langue, timezone, résolution écran, hash canvas, liste    │
 * │    de polices, etc.) et les envoie en clair au serveur dans le body de    │
 * │    POST /api/parrainage/completer (champ `fingerprint`).                  │
 * │                                                                           │
 * │  • CÔTÉ SERVEUR (ce module) : on NE stocke JAMAIS les composantes brutes.  │
 * │    On les normalise et on les HASHE en SHA-256 (Web Crypto, dispo sur le  │
 * │    runtime edge Cloudflare Workers). Le hash est ce qu'on persiste dans   │
 * │    account_signals.device_fingerprint et ce qu'on compare entre comptes.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Aucune dépendance externe (pas de lib payante type FingerprintJS Pro) : la
 * collecte est faite par l'UI avec du code maison, on se contente de hasher.
 */

/**
 * Composantes d'empreinte reçues du client. Toutes optionnelles : le client
 * peut bloquer le canvas, désactiver certaines API… On hashe ce qu'on reçoit.
 * Forme volontairement souple (Record) pour ne pas se coupler à l'implémentation
 * exacte de la collecte côté UI ; on normalise avant de hasher.
 */
export type FingerprintComponents = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Sérialise les composantes de façon STABLE (clés triées) puis hashe en
 * SHA-256. Deux clients identiques produisent donc le même hash, quel que soit
 * l'ordre d'envoi des champs.
 *
 * @returns le hash hexadécimal (64 caractères), ou `null` si rien d'exploitable
 *          n'a été fourni (on ne stocke pas un hash de chaîne vide qui
 *          matcherait tous les clients « vides » entre eux — faux positifs).
 */
export async function hashFingerprint(
  components: FingerprintComponents | string | null | undefined,
): Promise<string | null> {
  if (components == null) return null;

  // Le client peut envoyer soit un objet de composantes, soit déjà une chaîne
  // pré-concaténée. On normalise les deux cas vers une chaîne canonique.
  let canonical: string;
  if (typeof components === "string") {
    canonical = components.trim();
  } else {
    const entries = Object.entries(components)
      // On ignore les valeurs vides : un champ absent ne doit pas peser dans le
      // hash (sinon deux clients « tout vide » collisionneraient à tort).
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)] as const)
      // Tri par clé → sérialisation déterministe.
      .sort(([a], [b]) => a.localeCompare(b));
    canonical = entries.map(([k, v]) => `${k}=${v}`).join("|");
  }

  // Rien d'exploitable → pas de fingerprint (évite un hash « universel »).
  if (canonical.length === 0) return null;

  const data = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(digest);
}

/** Convertit un ArrayBuffer en chaîne hexadécimale minuscule. */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}
