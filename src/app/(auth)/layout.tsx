import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenantContext } from '@/server/tenant';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Un visiteur deja connecte n'a rien a faire sur l'ecran de connexion.
  const context = await getTenantContext();
  if (context) redirect('/tableau-de-bord');

  return (
    <div className="flex min-h-dvh flex-col bg-ink-100">
      <header className="px-4 py-5 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-700 text-lg font-bold text-white">
            G
          </span>
          <span className="text-lg font-semibold text-ink-900">GestiOne</span>
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
