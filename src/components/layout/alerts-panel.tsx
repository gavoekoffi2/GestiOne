import Link from 'next/link';
import { Icon } from '@/components/layout/icons';
import { collectAlerts, type AlertSeverity } from '@/server/services/notifications';

/**
 * Bandeau d'alertes.
 *
 * Rendu cote serveur a chaque navigation : les alertes sont calculees, donc
 * toujours a jour. Il n'y a rien a marquer comme lu — une alerte disparait
 * quand le probleme est resolu.
 */
const TONE: Record<AlertSeverity, { box: string; icon: string }> = {
  critical: { box: 'bg-red-50 text-red-800 ring-red-200', icon: 'text-red-600' },
  warning: { box: 'bg-amber-50 text-amber-900 ring-amber-200', icon: 'text-amber-600' },
  info: { box: 'bg-sky-50 text-sky-800 ring-sky-200', icon: 'text-sky-600' },
};

const ICONS: Record<string, string> = {
  STOCK_OUT: 'box',
  STOCK_LOW: 'layers',
  INVOICE_OVERDUE: 'receipt',
  QUOTE_EXPIRING: 'file',
  PAYABLE_DUE: 'truck',
  CASH_OPEN: 'cash',
};

export async function AlertsPanel({
  companyId,
  permissions,
}: {
  companyId: string;
  permissions: readonly string[];
}) {
  const alerts = await collectAlerts(companyId, permissions);
  if (alerts.length === 0) return null;

  return (
    <section aria-label="Alertes" className="space-y-2">
      {alerts.map((alert) => {
        const tone = TONE[alert.severity];
        return (
          <Link
            key={alert.key}
            href={alert.href}
            className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-inset transition hover:brightness-[0.98] ${tone.box}`}
          >
            <Icon name={ICONS[alert.kind] ?? 'list'} className={`mt-0.5 size-5 shrink-0 ${tone.icon}`} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{alert.title}</span>
              <span className="block">{alert.detail}</span>
            </span>
            <span className="shrink-0 self-center text-xs font-semibold underline">Traiter</span>
          </Link>
        );
      })}
    </section>
  );
}
