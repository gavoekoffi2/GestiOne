/**
 * Limitation de debit en memoire (fenetre glissante par cle).
 *
 * Suffisant pour un deploiement mono-instance, qui est le cas de figure vise au
 * demarrage. L'interface est volontairement minimale pour qu'un backend Redis
 * puisse la remplacer sans toucher aux appelants.
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

export function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = buckets.get(key) ?? { hits: [] };

  bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] as number;
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  // Purge opportuniste : evite que la Map grossisse indefiniment.
  if (buckets.size > 5000) {
    for (const [existingKey, existingBucket] of buckets) {
      if (existingBucket.hits.every((timestamp) => now - timestamp >= windowMs)) {
        buckets.delete(existingKey);
      }
    }
  }

  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

export function resetRateLimits(): void {
  buckets.clear();
}
