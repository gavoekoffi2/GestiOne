/**
 * Definitions de periode partagees entre le serveur et l'interface.
 *
 * Ces valeurs vivent dans `src/lib` et non dans `src/server` parce que le
 * selecteur de periode est un composant client. Un composant client qui importe
 * un module serveur entraine toute sa chaine de dependances dans le paquet
 * navigateur — ici Prisma et le pilote PostgreSQL, ce qui fait echouer la
 * compilation sur `dns`. La regle est donc stricte : **aucun composant client
 * n'importe depuis `@/server`.**
 */

export type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois',
  quarter: 'Ce trimestre',
  year: 'Cette année',
  custom: 'Période personnalisée',
};

/** Periodes proposees dans le selecteur, dans l'ordre d'affichage. */
export const PERIOD_ORDER: PeriodKey[] = ['today', 'week', 'month', 'quarter', 'year'];

export interface Period {
  from: Date;
  to: Date;
}
