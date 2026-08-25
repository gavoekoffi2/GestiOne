import type { Metadata } from 'next';
import { z } from 'zod';
import { Alert, Badge, Card, EmptyState } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { CashManager } from '@/components/finance/cash-manager';
import { formatMoney, toDecimalString } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import {
  CASH_MOVEMENT_LABELS,
  cashOverview,
  listCashMovements,
  listCashSessions,
  type CashMovementKind,
} from '@/server/services/cash';
import { listLocations } from '@/server/services/locations';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Caisse' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  locationId: z.string().trim().max(64).optional(),
});

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('cash.read');
  const raw = await searchParams;
  const query = querySchema.parse({
    locationId: typeof raw.locationId === 'string' ? raw.locationId : undefined,
  });

  const locations = await listLocations(context.companyId);
  const activeLocations = locations.filter((location) => location.isActive);

  const locationId =
    query.locationId && activeLocations.some((location) => location.id === query.locationId)
      ? query.locationId
      : (context.defaultLocationId ?? activeLocations[0]?.id ?? '');

  if (!locationId) {
    return (
      <Alert tone="warning" title="Aucun point de vente actif">
        Déclarez un point de vente avant d&apos;utiliser la caisse.
      </Alert>
    );
  }

  const [overview, movements, sessions, currency] = await Promise.all([
    cashOverview(context.companyId, locationId),
    listCashMovements(context.companyId, { locationId, page: 1, pageSize: 40 }),
    listCashSessions(context.companyId, { locationId, page: 1, pageSize: 10 }),
    getCurrencyFormat(context.currencyCode),
  ]);

  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Caisse</h1>
        <p className="mt-1 text-ink-600">
          Les espèces de votre point de vente : ce qui entre, ce qui sort, et ce qui doit s&apos;y
          trouver.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
          <div className="flex items-center gap-2 text-ink-500">
            <Icon name="cash" className="size-4" />
            <p className="text-sm">Solde de caisse</p>
          </div>
          <p className="tabular mt-2 text-3xl font-bold text-ink-900">{money(overview.balance)}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
          <div className="flex items-center gap-2 text-ink-500">
            <Icon name="wallet" className="size-4" />
            <p className="text-sm">Session en cours</p>
          </div>
          <p className="tabular mt-2 text-2xl font-bold text-ink-900">
            {overview.session ? money(overview.sessionTotal) : '—'}
          </p>
          {overview.session && (
            <p className="text-xs text-ink-400">Depuis l&apos;ouverture</p>
          )}
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
          <div className="flex items-center gap-2 text-ink-500">
            <Icon name="list" className="size-4" />
            <p className="text-sm">État</p>
          </div>
          <p className="mt-2">
            {overview.session ? (
              <Badge tone="success">Caisse ouverte</Badge>
            ) : (
              <Badge tone="neutral">Caisse fermée</Badge>
            )}
          </p>
        </div>
      </div>

      {/*
        Les especes encaissees hors session font partie du solde mais
        n'apparaitront dans aucun rapprochement : le dire evite qu'un ecart de
        fermeture soit interprete comme un manquant.
      */}
      {overview.outsideSession !== 0n && (
        <Alert tone="info" title="Espèces hors session">
          {money(overview.outsideSession)} ont été encaissés ou dépensés alors qu&apos;aucune caisse
          n&apos;était ouverte. Ce montant fait bien partie du solde, mais il n&apos;entrera dans
          aucun rapprochement de fermeture. Ouvrez la caisse en début de journée pour que tout soit
          rapproché.
        </Alert>
      )}

      <CashManager
        locationId={locationId}
        canOperate={can(context, 'cash.operate')}
        currency={{ symbol: currency.symbol, decimals: currency.decimals }}
        expectedLabel={money(overview.sessionTotal)}
        expectedRaw={toDecimalString(overview.sessionTotal, currency.decimals)}
        locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
        session={
          overview.session
            ? {
                id: overview.session.id,
                openedAt: overview.session.openedAt.toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                openedBy: overview.session.openedBy?.fullName ?? 'Inconnu',
              }
            : null
        }
      />

      <Card title="Mouvements de caisse">
        {movements.items.length === 0 ? (
          <EmptyState
            title="Aucun mouvement"
            description="Les encaissements en espèces, les dépenses et les apports apparaîtront ici."
          />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Date</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Motif</th>
                  <th className="px-4 py-2 font-medium">Session</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {movements.items.map((movement) => (
                  <tr key={movement.id}>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600 sm:px-5">
                      {movement.createdAt.toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      <p className="text-xs text-ink-400">{movement.user?.fullName ?? 'Système'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={movement.amount >= 0n ? 'success' : 'danger'}>
                        {CASH_MOVEMENT_LABELS[movement.kind as CashMovementKind] ?? movement.kind}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-600">{movement.reason ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-ink-400">
                      {movement.sessionId ? 'Rapprochee' : 'Hors session'}
                    </td>
                    <td
                      className={`tabular px-4 py-3 text-right font-medium sm:px-5 ${
                        movement.amount >= 0n ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {movement.amount > 0n ? '+' : ''}
                      {money(movement.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {sessions.items.length > 0 && (
        <Card title="Historique des sessions" description="Écarts constatés à chaque fermeture.">
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Ouverture</th>
                  <th className="px-4 py-2 font-medium">Fermeture</th>
                  <th className="px-4 py-2 text-right font-medium">Théorique</th>
                  <th className="px-4 py-2 text-right font-medium">Compte</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {sessions.items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600 sm:px-5">
                      {entry.openedAt.toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      <p className="text-xs text-ink-400">{entry.openedBy?.fullName ?? '—'}</p>
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600">
                      {entry.closedAt
                        ? entry.closedAt.toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                      {entry.closedBy && (
                        <p className="text-xs text-ink-400">{entry.closedBy.fullName}</p>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink-600">
                      {entry.expectedAmount === null ? '—' : money(entry.expectedAmount)}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink-800">
                      {entry.countedAmount === null ? '—' : money(entry.countedAmount)}
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      {entry.difference === null ? (
                        <Badge tone="info">En cours</Badge>
                      ) : entry.difference === 0n ? (
                        <Badge tone="success">Aucun écart</Badge>
                      ) : (
                        <span
                          className={`tabular font-medium ${
                            entry.difference > 0n ? 'text-amber-600' : 'text-red-600'
                          }`}
                        >
                          {entry.difference > 0n ? '+' : ''}
                          {money(entry.difference)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
