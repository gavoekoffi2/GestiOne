import { Icon } from '@/components/layout/icons';

/**
 * Tuile d'indicateur : une valeur, eventuellement sa variation.
 *
 * Un chiffre unique ne merite pas un graphique — une barre seule ne compare
 * rien. La variation porte un signe et nomme la periode de reference : "+12 %"
 * sans point de comparaison ne veut rien dire.
 */
export function StatTile({
  label,
  value,
  icon,
  hint,
  delta,
  deltaLabel,
  /** Une hausse est-elle une bonne nouvelle ? Faux pour les depenses. */
  higherIsBetter = true,
  tone,
}: {
  label: string;
  value: string;
  icon: string;
  hint?: string;
  delta?: number | null;
  deltaLabel?: string;
  higherIsBetter?: boolean;
  tone?: 'warning' | 'danger' | 'success';
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-red-600'
      : tone === 'warning'
        ? 'text-amber-600'
        : tone === 'success'
          ? 'text-emerald-700'
          : 'text-ink-900';

  const isGood = delta === undefined || delta === null ? null : higherIsBetter ? delta >= 0 : delta <= 0;

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
      <div className="flex items-center gap-2 text-ink-500">
        <Icon name={icon} className="size-4" />
        <p className="text-sm">{label}</p>
      </div>

      {/* Chiffres proportionnels : `tabular-nums` a cette taille rend un nombre
          comme 121 anormalement espace. Le tabulaire est reserve aux colonnes. */}
      <p className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</p>

      {delta !== undefined && delta !== null && (
        <p
          className={`mt-1 text-xs font-medium ${
            isGood ? 'text-emerald-700' : 'text-red-600'
          }`}
        >
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1).replace('.', ',')} %{deltaLabel ? ` ${deltaLabel}` : ''}
        </p>
      )}

      {/* Sans periode de comparaison, afficher "vs periode precedente" seul ne
          veut rien dire : on le dit explicitement. */}
      {delta === null && deltaLabel && (
        <p className="mt-1 text-xs text-ink-400">Pas de comparaison disponible</p>
      )}
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
