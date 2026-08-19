'use client';

/**
 * Classement par magnitude (produits les plus vendus, categories de depense).
 *
 * Le lecteur compare des grandeurs : palette **sequentielle** — une seule
 * teinte, plus c'est fonce, plus c'est grand. Attribuer une couleur differente
 * a chaque barre ferait croire a des categories distinctes alors que la seule
 * information est la taille.
 */

export interface RankingRow {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  valueLabel: string;
}

// Une seule teinte, du plus fonce au plus clair : la position dans le
// classement porte deja l'ordre, la couleur ne fait que le renforcer.
const RAMP = ['#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4'];

export function RankingBars({ rows, emptyMessage }: { rows: RankingRow[]; emptyMessage: string }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-500">{emptyMessage}</p>;
  }

  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <ul className="space-y-3">
      {rows.map((row, index) => {
        const share = Math.max(2, (row.value / max) * 100);
        return (
          <li key={row.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink-800">
                {row.label}
                {row.sublabel && (
                  <span className="ml-2 font-mono text-xs text-ink-400">{row.sublabel}</span>
                )}
              </span>
              {/* La valeur porte un jeton de texte, jamais la couleur de la serie. */}
              <span className="tabular shrink-0 font-medium text-ink-900">{row.valueLabel}</span>
            </div>
            <div className="mt-1 h-2.5 rounded-full bg-ink-100">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${share}%`,
                  backgroundColor: RAMP[Math.min(index, RAMP.length - 1)],
                }}
                role="img"
                aria-label={`${row.label} : ${row.valueLabel}`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
