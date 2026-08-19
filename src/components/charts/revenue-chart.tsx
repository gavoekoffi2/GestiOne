'use client';

import { useId, useMemo, useState } from 'react';
import { formatMoney, type CurrencyFormat } from '@/lib/money';

/**
 * Chiffre d'affaires et depenses sur la periode.
 *
 * Deux series distinctes : le lecteur doit les differencier, donc palette
 * categorielle. Les deux teintes (#0d9488 et #eb6834) ont ete validees pour la
 * separation en vision des couleurs alteree sur fond blanc — elles ne sont pas
 * choisies a l'oeil.
 *
 * Aucun second axe : les deux series sont dans la meme unite (la devise de
 * l'entreprise) et partagent donc une seule echelle. Deux echelles feraient
 * dire au graphique ce que l'on veut.
 */

export interface ChartPoint {
  label: string;
  /**
   * Montants en unite mineure, transmis en chaine : les `bigint` ne traversent
   * pas la frontiere serveur/client (ils ne sont pas serialisables en JSON).
   */
  revenue: string;
  expenses: string;
}

interface PlotPoint {
  label: string;
  revenue: number;
  expenses: number;
  revenueRaw: bigint;
  expensesRaw: bigint;
}

const SERIES = [
  { key: 'revenue' as const, label: "Chiffre d'affaires", color: '#0d9488' },
  { key: 'expenses' as const, label: 'Depenses', color: '#eb6834' },
];

/**
 * Le formatage se fait **dans** le composant client, a partir du format de
 * devise transmis comme donnee. Passer une fonction depuis un composant serveur
 * echoue a l'execution : seules des valeurs serialisables franchissent la
 * frontiere.
 */
export function RevenueChart({
  points: rawPoints,
  currency,
  locale,
}: {
  points: ChartPoint[];
  currency: CurrencyFormat;
  locale: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const points: PlotPoint[] = useMemo(
    () =>
      rawPoints.map((point) => {
        const revenueRaw = BigInt(point.revenue);
        const expensesRaw = BigInt(point.expenses);
        return {
          label: point.label,
          // La geometrie du graphique se calcule en nombres ; la precision d'un
          // pixel n'exige pas d'entier exact. Les **etiquettes**, elles, sont
          // formatees depuis le bigint d'origine.
          revenue: Number(revenueRaw),
          expenses: Number(expensesRaw),
          revenueRaw,
          expensesRaw,
        };
      }),
    [rawPoints],
  );

  const formatValue = (amount: bigint) => formatMoney(amount, currency, locale);

  const geometry = useMemo(() => {
    const width = 720;
    const height = 240;
    const padding = { top: 16, right: 16, bottom: 28, left: 16 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    const maxValue = Math.max(
      1,
      ...points.map((point) => Math.max(point.revenue, point.expenses)),
    );

    const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;
    const x = (index: number) =>
      points.length > 1 ? padding.left + index * stepX : padding.left + plotWidth / 2;
    const y = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;

    const path = (key: 'revenue' | 'expenses') =>
      points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point[key])}`).join(' ');

    const area = (key: 'revenue' | 'expenses') =>
      points.length === 0
        ? ''
        : `${path(key)} L${x(points.length - 1)},${padding.top + plotHeight} L${x(0)},${padding.top + plotHeight} Z`;

    return { width, height, padding, plotWidth, plotHeight, maxValue, x, y, path, area };
  }, [points]);

  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-500">
        Aucune donnee sur cette periode.
      </p>
    );
  }

  const active = hover !== null ? points[hover] : null;

  // On n'etiquette pas chaque point : seule la valeur survolee est annoncee, et
  // l'axe porte le reste. Un nombre sur chaque point serait illisible.
  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-2 text-sm text-ink-600">
            <span
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: series.color }}
              aria-hidden="true"
            />
            {series.label}
          </span>
        ))}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          className="h-56 w-full"
          role="img"
          aria-label={`Evolution du chiffre d'affaires et des depenses sur ${points.length} periodes`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`${gradientId}-revenue`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d9488" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#0d9488" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grille discrete : une hairline pleine, jamais en pointilles. */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const lineY = geometry.padding.top + geometry.plotHeight * ratio;
            return (
              <line
                key={ratio}
                x1={geometry.padding.left}
                x2={geometry.width - geometry.padding.right}
                y1={lineY}
                y2={lineY}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
            );
          })}

          <path d={geometry.area('revenue')} fill={`url(#${gradientId}-revenue)`} />

          {SERIES.map((series) => (
            <path
              key={series.key}
              d={geometry.path(series.key)}
              fill="none"
              stroke={series.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Repere de survol */}
          {hover !== null && (
            <line
              x1={geometry.x(hover)}
              x2={geometry.x(hover)}
              y1={geometry.padding.top}
              y2={geometry.padding.top + geometry.plotHeight}
              stroke="#94a3b8"
              strokeWidth={1}
            />
          )}

          {hover !== null &&
            SERIES.map((series) => (
              <circle
                key={series.key}
                cx={geometry.x(hover)}
                cy={geometry.y(points[hover]![series.key])}
                r={5}
                fill={series.color}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}

          {/* Zones de survol : plus larges que les marques, pour rester
              atteignables au doigt sur un telephone. */}
          {points.map((point, index) => {
            const bandWidth =
              points.length > 1 ? geometry.plotWidth / (points.length - 1) : geometry.plotWidth;
            return (
              <rect
                key={point.label + index}
                x={geometry.x(index) - bandWidth / 2}
                y={geometry.padding.top}
                width={bandWidth}
                height={geometry.plotHeight}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                tabIndex={0}
                role="button"
                aria-label={`${point.label} : chiffre d'affaires ${formatValue(point.revenueRaw)}, depenses ${formatValue(point.expensesRaw)}`}
              />
            );
          })}

          {/* Axe des abscisses : quelques reperes seulement, pour eviter que les
              etiquettes ne se chevauchent sur une longue periode. */}
          {points.map((point, index) => {
            const stride = Math.max(1, Math.ceil(points.length / 8));
            if (index % stride !== 0 && index !== points.length - 1) return null;
            return (
              <text
                key={`label-${point.label}-${index}`}
                x={geometry.x(index)}
                y={geometry.height - 8}
                textAnchor="middle"
                className="fill-ink-400"
                style={{ fontSize: 11 }}
              >
                {point.label}
              </text>
            );
          })}
        </svg>

        {active && (
          <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg bg-ink-900 px-3 py-2 text-xs text-white shadow-lg">
            <p className="font-semibold">{active.label}</p>
            {SERIES.map((series) => (
              <p key={series.key} className="flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: series.color }}
                  aria-hidden="true"
                />
                {series.label} :{' '}
                <span className="tabular">
                  {formatValue(series.key === 'revenue' ? active.revenueRaw : active.expensesRaw)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Une vue tabulaire double toujours le graphique : lecteur d'ecran,
          impression, et daltonisme complet. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-500">Voir les valeurs</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink-500">
                <th className="py-1 font-medium">Periode</th>
                <th className="py-1 text-right font-medium">Chiffre d&apos;affaires</th>
                <th className="py-1 text-right font-medium">Depenses</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => (
                <tr key={`${point.label}-${index}`} className="border-t border-ink-100">
                  <td className="py-1 text-ink-600">{point.label}</td>
                  <td className="tabular py-1 text-right text-ink-800">
                    {formatValue(point.revenueRaw)}
                  </td>
                  <td className="tabular py-1 text-right text-ink-800">
                    {formatValue(point.expensesRaw)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
