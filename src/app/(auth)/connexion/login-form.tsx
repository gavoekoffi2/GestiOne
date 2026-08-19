'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error?.message ?? 'Connexion impossible.');
        if (body?.error?.details && typeof body.error.details === 'object') {
          setFieldErrors(body.error.details as Record<string, string>);
        }
        return;
      }

      // `refresh` recharge les composants serveur, qui liront le nouveau cookie.
      router.replace('/tableau-de-bord');
      router.refresh();
    } catch {
      setError('Le serveur est injoignable. Verifiez votre connexion Internet.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}

      <Field label="Adresse email" htmlFor="email" required error={fieldErrors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="vous@entreprise.com"
        />
      </Field>

      <Field label="Mot de passe" htmlFor="password" required error={fieldErrors.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Connexion...' : 'Se connecter'}
      </Button>
    </form>
  );
}
