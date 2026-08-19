/**
 * `JSON.stringify` refuse les `bigint`. Comme tous les montants et quantites de
 * GestiOne sont des bigint, chaque reponse d'API passe par ce serialiseur, qui
 * les rend sous forme de chaine (aucune perte de precision cote client).
 */

export type JsonSafe<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends Array<infer U>
      ? JsonSafe<U>[]
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : T;

export function toJsonSafe<T>(value: T): JsonSafe<T> {
  if (typeof value === 'bigint') return value.toString() as JsonSafe<T>;
  if (value instanceof Date) return value.toISOString() as JsonSafe<T>;
  if (Array.isArray(value)) return value.map(toJsonSafe) as JsonSafe<T>;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonSafe(item);
    }
    return out as JsonSafe<T>;
  }
  return value as JsonSafe<T>;
}
