'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/layout/icons';
import { Input, Select } from '@/components/ui/primitives';

/**
 * Barre de recherche et de filtres d'une liste.
 *
 * Les criteres vivent dans l'URL : la page reste partageable, le bouton
 * "precedent" du navigateur fonctionne, et le rendu se fait cote serveur (donc
 * rapide sur une connexion lente). La saisie est temporisee pour ne pas lancer
 * une requete a chaque frappe.
 */
export function ListToolbar({
  placeholder,
  filters,
}: {
  placeholder: string;
  filters?: Array<{ name: string; label: string; options: Array<{ value: string; label: string }> }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Un changement de critere ramene toujours a la premiere page : rester en
    // page 4 apres un filtre affiche souvent une liste vide sans explication.
    next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  }

  useEffect(() => {
    const current = searchParams.get('search') ?? '';
    if (search === current) return;

    const timer = setTimeout(() => apply({ search }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-md">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400">
          <Icon name="search" className="size-4" />
        </span>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="pl-9"
        />
      </div>

      {filters?.map((filter) => (
        <label key={filter.name} className="min-w-40">
          <span className="sr-only">{filter.label}</span>
          <Select
            value={searchParams.get(filter.name) ?? ''}
            onChange={(event) => apply({ [filter.name]: event.target.value })}
          >
            <option value="">{filter.label}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      ))}

      <label className="flex items-center gap-2 whitespace-nowrap text-sm text-ink-600">
        <input
          type="checkbox"
          checked={searchParams.get('includeInactive') === 'true'}
          onChange={(event) => apply({ includeInactive: event.target.checked ? 'true' : '' })}
          className="size-4 rounded border-ink-300"
        />
        Inclure les inactifs
      </label>
    </div>
  );
}

/** Pagination serveur, coherente avec ListToolbar. */
export function Pagination({
  page,
  pageCount,
  total,
}: {
  page: number;
  pageCount: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goTo(target: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('page', String(target));
    router.replace(`${pathname}?${next.toString()}`);
  }

  if (pageCount <= 1) {
    return <p className="text-sm text-ink-500">{total} resultat(s).</p>;
  }

  return (
    <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <button
        type="button"
        onClick={() => goTo(page - 1)}
        disabled={page <= 1}
        className="min-h-9 rounded-lg px-3 font-semibold text-brand-700 disabled:text-ink-300"
      >
        Precedent
      </button>
      <span className="text-ink-500">
        Page {page} sur {pageCount} — {total} resultat(s)
      </span>
      <button
        type="button"
        onClick={() => goTo(page + 1)}
        disabled={page >= pageCount}
        className="min-h-9 rounded-lg px-3 font-semibold text-brand-700 disabled:text-ink-300"
      >
        Suivant
      </button>
    </nav>
  );
}
