/**
 * Limitation de debit en memoire (fenetre glissante par cle).
 *
 * Suffisant pour un deploiement mono-instance, qui est le cas de figure vise au
 * demarrage. L'interface est volontairement minimale pour qu'un backend Redis
 * puisse la remplacer sans toucher aux appelants.
 *
 * La lecture (`peekRateLimit`) et l'enregistrement (`recordAttempt`) sont
 * separes. C'est necessaire pour l'ecran de connexion : dans une boutique, toute
 * l'equipe partage souvent une seule adresse IP publique (routeur 4G, connexion
 * mutualisee). Si les connexions **reussies** consommaient le quota, cinq
 * caissiers qui prennent leur poste bloqueraient le sixieme. Seuls les echecs
 * sont donc comptabilises.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function prune(bucket: Bucket, now: number, windowMs: number): void {
  bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < windowMs);
}

/** Etat de la limite, sans rien consommer. */
export function peekRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true, remaining: limit, retryAfterSeconds: 0 };

  prune(bucket, now, windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] as number;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** Enregistre une tentative (typiquement un echec) sur la cle. */
export function recordAttempt(key: string, windowSeconds: number): void {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  prune(bucket, now, windowSeconds * 1000);
  bucket.hits.push(now);
  buckets.set(key, bucket);

  // Purge opportuniste : evite que la Map grossisse indefiniment.
  if (buckets.size > 5000) {
    for (const [existingKey, existingBucket] of buckets) {
      prune(existingBucket, now, windowSeconds * 1000);
      if (existingBucket.hits.length === 0) buckets.delete(existingKey);
    }
  }
}

/** Remet une cle a zero : une authentification reussie efface l'ardoise. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Verifie **et** consomme en une fois. Adapte aux operations ou chaque appel,
 * reussi ou non, doit compter (creation de compte, envoi de document).
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const result = peekRateLimit(key, limit, windowSeconds);
  if (result.allowed) recordAttempt(key, windowSeconds);
  return result;
}

export function resetRateLimits(): void {
  buckets.clear();
}
