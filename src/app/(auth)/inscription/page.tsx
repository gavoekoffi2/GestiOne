import type { Metadata } from 'next';
import Link from 'next/link';
import { ensureCurrencies, listCurrencies } from '@/server/services/currencies';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Créer mon entreprise' };

export default async function RegisterPage() {
  // Le referentiel des devises est installe a la demande : la premiere
  // inscription sur une base neuve ne doit pas dependre d'un seed manuel.
  await ensureCurrencies();
  const currencies = await listCurrencies();

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-ink-200 sm:p-8">
      <h1 className="text-xl font-semibold text-ink-900">Créer mon entreprise</h1>
      <p className="mt-1 text-sm text-ink-500">
        Quelques informations suffisent. Tout est modifiable ensuite dans les paramètres.
      </p>
      <div className="mt-6">
        <RegisterForm
          currencies={currencies.map((currency) => ({
            code: currency.code,
            name: currency.name,
          }))}
        />
      </div>
      <p className="mt-6 text-sm text-ink-600">
        Vous avez déjà un compte ?{' '}
        <Link href="/connexion" className="font-semibold text-brand-700 hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
