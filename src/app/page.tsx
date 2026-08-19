import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenantContext } from '@/server/tenant';
import { ButtonLink } from '@/components/ui/primitives';

const HIGHLIGHTS = [
  {
    title: 'Vendez et encaissez',
    body: "Ventes au comptoir, devis, factures et paiements — especes, Mobile Money, virement, carte ou credit.",
  },
  {
    title: 'Maitrisez votre stock',
    body: 'Entrees, sorties, transferts entre boutiques et alertes de rupture, avec un historique qui ne se reecrit jamais.',
  },
  {
    title: 'Sachez ou vous en etes',
    body: "Chiffre d'affaires, benefice estime, creances clients, dettes fournisseurs et solde de caisse, en un coup d'oeil.",
  },
];

export default async function HomePage() {
  const context = await getTenantContext();
  if (context) redirect('/tableau-de-bord');

  return (
    <div className="min-h-dvh bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-700 text-lg font-bold text-white">
            G
          </span>
          <span className="text-lg font-semibold text-ink-900">GestiOne</span>
        </div>
        <Link href="/connexion" className="text-sm font-semibold text-brand-700 hover:underline">
          Se connecter
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <section className="py-12 sm:py-20">
          <h1 className="max-w-3xl text-3xl font-bold leading-tight text-ink-900 sm:text-5xl">
            Toute la gestion de votre entreprise, depuis un seul endroit.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-600">
            Clients, produits, stock, ventes, factures, paiements, depenses et caisse. GestiOne
            remplace le cahier et les tableurs eparpilles par un outil simple, rapide et fiable —
            sur ordinateur comme sur telephone.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/inscription">Creer mon entreprise</ButtonLink>
            <ButtonLink href="/connexion" variant="secondary">
              J&apos;ai deja un compte
            </ButtonLink>
          </div>
        </section>

        <section className="grid gap-5 sm:grid-cols-3">
          {HIGHLIGHTS.map((highlight) => (
            <div key={highlight.title} className="rounded-xl bg-ink-50 p-5 ring-1 ring-ink-200">
              <h2 className="font-semibold text-ink-900">{highlight.title}</h2>
              <p className="mt-2 text-sm text-ink-600">{highlight.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-ink-200 py-8 text-center text-sm text-ink-500">
        GestiOne — gestion d&apos;entreprise pour les PME.
      </footer>
    </div>
  );
}
