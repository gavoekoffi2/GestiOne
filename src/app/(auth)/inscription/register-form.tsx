'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Select } from '@/components/ui/primitives';
import { COUNTRIES } from '@/lib/countries';

export function RegisterForm({ currencies }: { currencies: Array<{ code: string; name: string }> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [countryCode, setCountryCode] = useState('CI');

  // Choisir un pays pre-selectionne sa devise : c'est le cas le plus frequent,
  // et l'utilisateur garde la main pour en choisir une autre.
  const suggestedCurrency = COUNTRIES.find((country) => country.code === countryCode)?.currency;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      fullName: String(form.get('fullName') ?? ''),
      email: String(form.get('email') ?? ''),
      phone: String(form.get('phone') ?? ''),
      password: String(form.get('password') ?? ''),
      companyName: String(form.get('companyName') ?? ''),
      countryCode: String(form.get('countryCode') ?? 'CI'),
      currencyCode: String(form.get('currencyCode') ?? 'XOF'),
    };

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error?.message ?? "L'inscription a échoué.");
        if (body?.error?.details && typeof body.error.details === 'object') {
          setFieldErrors(body.error.details as Record<string, string>);
        }
        return;
      }

      router.replace('/tableau-de-bord');
      router.refresh();
    } catch {
      setError('Le serveur est injoignable. Vérifiez votre connexion Internet.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}

      <Field label="Nom de l'entreprise" htmlFor="companyName" required error={fieldErrors.companyName}>
        <Input id="companyName" name="companyName" required placeholder="Boutique Kofi" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pays" htmlFor="countryCode" required error={fieldErrors.countryCode}>
          <Select
            id="countryCode"
            name="countryCode"
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
          >
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Devise"
          htmlFor="currencyCode"
          required
          error={fieldErrors.currencyCode}
          hint="Utilisée sur toutes vos factures."
        >
          <Select
            id="currencyCode"
            name="currencyCode"
            key={suggestedCurrency}
            defaultValue={suggestedCurrency ?? 'XOF'}
          >
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <hr className="border-ink-200" />

      <Field label="Votre nom" htmlFor="fullName" required error={fieldErrors.fullName}>
        <Input id="fullName" name="fullName" required autoComplete="name" placeholder="Kofi Mensah" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Adresse email" htmlFor="email" required error={fieldErrors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="vous@entreprise.com"
          />
        </Field>

        <Field label="Téléphone" htmlFor="phone" error={fieldErrors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+225 07 00 00 00 00"
          />
        </Field>
      </div>

      <Field
        label="Mot de passe"
        htmlFor="password"
        required
        error={fieldErrors.password}
        hint="8 caractères minimum, dont au moins une lettre et un chiffre."
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Création en cours...' : 'Créer mon entreprise'}
      </Button>
    </form>
  );
}
