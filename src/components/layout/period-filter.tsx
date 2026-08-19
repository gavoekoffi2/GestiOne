'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PERIOD_LABELS, PERIOD_ORDER, type PeriodKey } from '@/lib/periods';

/**
 * Selecteur de periode. Les criteres vivent dans l'URL : la page reste
 * partageable, le bouton "precedent" fonctionne, et le rendu se fait cote
 * serveur — donc rapide sur une connexion lente.
 */
export function PeriodFilter({ locations }: { locations?: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get('period') ?? 'month') as PeriodKey;

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex flex-wrap rounded-lg bg-white p-1 ring-1 ring-ink-200"
        role="group"
        aria-label="Periode"
      >
        {PERIOD_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => apply({ period: key })}
            aria-pressed={current === key}
            className={`min-h-9 rounded-md px-3 text-sm font-medium transition ${
              current === key ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-100'
            }`}
          >
            {PERIOD_LABELS[key]}
          </button>
        ))}
      </div>

      {locations && locations.length > 1 && (
        <label>
          <span className="sr-only">Point de vente</span>
          <select
            value={searchParams.get('locationId') ?? ''}
            onChange={(event) => apply({ locationId: event.target.value })}
            className="min-h-11 rounded-lg border-0 bg-white px-3 text-sm text-ink-800 ring-1 ring-inset ring-ink-300"
          >
            <option value="">Tous les points de vente</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
