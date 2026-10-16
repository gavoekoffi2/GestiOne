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

  // Erreurs de contrainte de la base, le plus souvent dues a deux saisies
  // simultanees : elles meritent un vrai message, pas une "erreur interne".
  const prismaCode = prismaErrorCode(error);
  if (prismaCode === 'P2002') {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'Cet enregistrement existe deja (meme nom, code ou reference).' } },
      { status: 409 },
    );
  }
  if (prismaCode === 'P2025') {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: "L'element demande n'existe plus. Rechargez la page." } },
      { status: 404 },
    );
  }
  if (prismaCode === 'P2034') {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'Une autre operation etait en cours sur ce document. Reessayez.' } },
      { status: 409 },
    );
  }

  // Toute autre erreur est un defaut du serveur : on la journalise en clair
  // mais on ne renvoie qu'un message generique.
  console.error('[api] erreur non geree', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } },
    { status: 500 },
  );
}

function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
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
 *
 * La PREMIERE adresse de `x-forwarded-for` est celle que le client declare :
 * il suffisait d'envoyer un en-tete different a chaque essai pour contourner
 * la limitation des tentatives de connexion. On retient la DERNIERE, ajoutee
 * par le proxy de l'hebergement, qui a vu la vraie connexion.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const chain = forwarded.split(',').map((entry) => entry.trim()).filter(Boolean);
    const last = chain[chain.length - 1];
    if (last) return last;
  }
  return request.headers.get('x-real-ip')?.trim() || 'inconnu';
}

/**
 * Enveloppe commune des Route Handlers : convertit toute erreur en reponse
 * uniforme. Le type de retour est `Response` et non `NextResponse`, car
 * certaines routes rendent un fichier (CSV, PDF) plutot que du JSON.
 */
export function handler(
  fn: (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> },
  ) => Promise<Response>,
) {
  return async (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      return await fn(request, context);
    } catch (error) {
      return jsonError(error);
    }
  };
}
