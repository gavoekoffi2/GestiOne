import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Connexion' };

export default function LoginPage() {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-ink-200 sm:p-8">
      <h1 className="text-xl font-semibold text-ink-900">Connexion</h1>
      <p className="mt-1 text-sm text-ink-500">Accédez à la gestion de votre entreprise.</p>
      <div className="mt-6">
        <LoginForm />
      </div>
      <p className="mt-6 text-sm text-ink-600">
        Pas encore de compte ?{' '}
        <Link href="/inscription" className="font-semibold text-brand-700 hover:underline">
          Créer mon entreprise
        </Link>
      </p>
    </div>
  );
}
