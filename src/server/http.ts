import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError, ValidationError } from '@/server/errors';
import { toJsonSafe } from '@/lib/serialize';

/**
 * Utilitaires communs aux Route Handlers.
 *
 * Chaque route suit la meme sequence : valider l'entree, obtenir un contexte
 * tenant, verifier une permission, appeler un service. Les erreurs remontent
 * ici et sont converties en reponse : aucune trace interne ne parvient au
 * client, et le format d'erreur est uniforme pour l'interface.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(toJsonSafe({ data }), { status });
}

export function jsonError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Certains champs sont invalides.',
          details: fieldErrors(error),
        },
      },
      { status: 422 },
    );
  }

  if (error instanceof AppError) {
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, details: error.details },
    };
    const headers =
      error.code === 'RATE_LIMITED' && isRetryDetails(error.details)
        ? { 'Retry-After': String(error.details.retryAfterSeconds) }
        : undefined;
    return NextResponse.json(body, { status: error.status, headers });
  }

  // Toute autre erreur est un defaut du serveur : on la journalise en clair
  // mais on ne renvoie qu'un message generique.
  console.error('[api] erreur non geree', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } },
    { status: 500 },
  );
}

function isRetryDetails(value: unknown): value is { retryAfterSeconds: number } {
  return typeof value === 'object' && value !== null && 'retryAfterSeconds' in value;
}

/** Regroupe les erreurs Zod par champ, format directement exploitable par un formulaire. */
export function fieldErrors(error: ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/**
 * Lit et valide le corps JSON d'une requete.
 *
 * Le type rendu est celui de *sortie* du schema (`z.infer`) : apres validation,
 * un champ muni de `.default()` est garanti present, ce que le type d'entree ne
 * refleterait pas.
 */
export async function readJson<S extends ZodTypeAny>(
  request: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError('Corps de requete JSON invalide.');
  }
  return schema.parse(payload) as z.infer<S>;
}

/** Lit et valide les parametres de requete (?page=2&search=...). */
export function readQuery<S extends ZodTypeAny>(request: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(request.nextUrl.searchParams)) as z.infer<S>;
}

/**
 * Adresse IP du client, utilisee pour la limitation de debit et l'audit.
 * Derriere un proxy, `x-forwarded-for` contient la chaine complete : seule la
 * premiere adresse est celle du client.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'inconnu';
  return request.headers.get('x-real-ip') ?? 'inconnu';
}

export function handler(
  fn: (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse>,
) {
  return async (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      return await fn(request, context);
    } catch (error) {
      return jsonError(error);
    }
  };
}
