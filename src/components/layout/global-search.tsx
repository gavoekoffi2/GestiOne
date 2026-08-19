'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/layout/icons';

/**
 * Recherche globale.
 *
 * Un commercant qui a un client au telephone tape un nom, un numero ou une
 * reference — il ne sait pas dans quel module chercher. La recherche interroge
 * tous les referentiels d'un coup.
 *
 * La saisie est temporisee : une requete par frappe saturerait une connexion
 * mobile lente pour un resultat que l'utilisateur n'a pas encore fini de
 * formuler.
 */

interface Hit {
  kind: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const KIND_LABELS: Record<string, string> = {
  customer: 'Client',
  supplier: 'Fournisseur',
  product: 'Article',
  invoice: 'Facture',
  quote: 'Devis',
  purchase: 'Achat',
  payment: 'Paiement',
};

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(needle)}`);
        const body = await response.json();
        if (!cancelled) {
          setHits(Array.isArray(body?.data) ? body.data : []);
          setOpen(true);
        }
      } catch {
        // Hors connexion : on n'affiche pas d'erreur bloquante pour une
        // recherche, l'indicateur de connexion s'en charge deja.
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setQuery('');
    router.push(hit.href);
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 sm:max-w-md">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400">
        <Icon name="search" className="size-4" />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder="Rechercher…"
        aria-label="Recherche globale"
        className="min-h-10 w-full rounded-lg border-0 bg-ink-100 pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-brand-600"
      />

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-96 overflow-auto rounded-lg bg-white shadow-lg ring-1 ring-ink-200">
          {loading && hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-500">Recherche…</p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-500">
              Aucun resultat pour &laquo; {query.trim()} &raquo;.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {hits.map((hit) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => go(hit)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-ink-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">
                        {hit.title}
                      </span>
                      <span className="block truncate text-xs text-ink-500">{hit.subtitle}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
                      {KIND_LABELS[hit.kind] ?? hit.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
