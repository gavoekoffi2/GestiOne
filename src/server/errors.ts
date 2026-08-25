/**
 * Erreurs metier transportant un code HTTP. Les routes n'ont ainsi qu'un seul
 * point de conversion erreur -> reponse, et aucune trace interne ne fuit vers
 * le client.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Données invalides.', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentification requise.') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Vous n'avez pas la permission d'effectuer cette action.") {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Ressource introuvable.') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflit avec une donnée existante.', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Trop de tentatives. Réessayez dans un instant.', retryAfterSeconds = 60) {
    super(message, 429, 'RATE_LIMITED', { retryAfterSeconds });
  }
}
