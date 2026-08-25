'use client';

import { useCallback, useState } from 'react';

/**
 * Appel d'API cote client avec gestion homogene des erreurs.
 *
 * Toutes les routes rendent le meme format `{ error: { message, details } }` :
 * ce hook le traduit en message global + erreurs par champ, ce qui evite de
 * reecrire la meme plomberie dans chaque formulaire.
 */

export interface ApiState {
  pending: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  success: string | null;
}

export function useApi() {
  const [state, setState] = useState<ApiState>({
    pending: false,
    error: null,
    fieldErrors: {},
    success: null,
  });

  const send = useCallback(
    async <T>(
      url: string,
      options: { method: string; body?: unknown; successMessage?: string },
    ): Promise<T | null> => {
      setState({ pending: true, error: null, fieldErrors: {}, success: null });

      try {
        const response = await fetch(url, {
          method: options.method,
          headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const details = payload?.error?.details;
          setState({
            pending: false,
            error: payload?.error?.message ?? "L'opération a échoué.",
            fieldErrors:
              details && typeof details === 'object' && !Array.isArray(details)
                ? (details as Record<string, string>)
                : {},
            success: null,
          });
          return null;
        }

        setState({
          pending: false,
          error: null,
          fieldErrors: {},
          success: options.successMessage ?? null,
        });
        return (payload?.data ?? null) as T;
      } catch {
        setState({
          pending: false,
          error: 'Le serveur est injoignable. Vérifiez votre connexion Internet.',
          fieldErrors: {},
          success: null,
        });
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState({ pending: false, error: null, fieldErrors: {}, success: null });
  }, []);

  return { ...state, send, reset };
}
