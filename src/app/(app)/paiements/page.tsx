import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { Icon } from '@/components/layout/icons';
import { formatMoney } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import { listPayments, receivablesByCustomer } from '@/server/services/payments';
import { listPaymentMethods } from '@/server/services/commerce-setup';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Paiements' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(120).optional(),
  methodId: z.string().trim().max(64).optional(),
  direction: z.enum(['IN', 'OUT']).optional().catch(undefined),
});

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('payments.read');
  const raw = await searchParams;
  const query = querySchema.parse({
    page: raw.page ?? 1,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    methodId: typeof raw.methodId === 'string' ? raw.methodId : undefined,
    direction: typeof raw.direction === 'string' ? raw.direction : undefined,
  });

  const [result, receivables, methods, currency] = await Promise.all([
    listPayments(context.companyId, {
      page: query.page,
      pageSize: PAGE_SIZE,
      search: query.search,
      methodId: query.methodId || undefined,
      direction: query.direction,
    }),
    can(context, 'invoices.read')
      ? receivablesByCustomer(context.companyId)
      : Promise.resolve([]),
    listPaymentMethods(context.companyId),
    getCurrencyFormat(context.currencyCode),
  ]);

  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);
  const totalReceivable = receivables.reduce((sum, row) => sum + row.outstanding, 0n);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Paiements</h1>
        <p className="mt-1 text-ink-600">
          Tous les encaissements et règlements enregistrés, et ce que vos clients vous doivent
          encore.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
          <div className="flex items-center gap-2 text-ink-500">
            <Icon name="wallet" className="size-4" />
            <p className="text-sm">Total sur la période affichée</p>
          </div>
          <p className="tabular mt-2 text-2xl font-bold text-ink-900">{money(result.sum)}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
          <div className="flex items-center gap-2 text-ink-500">
            <Icon name="users" className="size-4" />
            <p className="text-sm">Créances clients</p>
          </div>
          <p
            className={`tabular mt-2 text-2xl font-bold ${
              totalReceivable > 0n ? 'text-amber-600' : 'text-ink-900'
            }`}
          >
            {money(totalReceivable)}
          </p>
        </div>
      </div>

      {receivables.length > 0 && (
        <Card
          title="Créances clients"
          description="Ce que chaque client doit encore, toutes factures confondues."
        >
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Client</th>
                  <th className="px-4 py-2 font-medium">Téléphone</th>
                  <th className="px-4 py-2 text-right font-medium">Factures dues</th>
                  <th className="px-4 py-2 text-right font-medium">Montant dû</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Plafond</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {receivables.map((row) => {
                  const overLimit =
                    row.customer && row.customer.creditLimit > 0n
                      ? row.outstanding > row.customer.creditLimit
                      : false;
                  return (
                    <tr key={row.customerId ?? 'anonyme'}>
                      <td className="px-4 py-3 sm:px-5">
                        <p className="font-medium text-ink-900">
                          {row.customer?.name ?? 'Client de passage'}
                        </p>
                        {row.customer?.code && (
                          <p className="font-mono text-xs text-ink-400">{row.customer.code}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.customer?.phone ? (
                          <a
                            href={`tel:${row.customer.phone.replace(/[^\d+]/g, '')}`}
                            className="text-brand-700 hover:underline"
                          >
                            {row.customer.phone}
                          </a>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-ink-600">
                        {row.invoiceCount}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-medium text-amber-700">
                        {money(row.outstanding)}
                      </td>
                      <td className="tabular px-4 py-3 text-right sm:px-5">
                        {row.customer && row.customer.creditLimit > 0n ? (
                          <span className={overLimit ? 'font-medium text-red-600' : 'text-ink-600'}>
                            {money(row.customer.creditLimit)}
                            {overLimit && (
                              <span className="ml-2 inline-block">
                                <Badge tone="danger">Dépasse</Badge>
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ListToolbar
        placeholder="Rechercher un paiement (numéro, référence, client)"
        filters={[
          {
            name: 'methodId',
            label: 'Tous les modes',
            options: methods.map((method) => ({ value: method.id, label: method.name })),
          },
        ]}
      />

      <Card title={`${result.total} paiement(s)`}>
        {result.items.length === 0 ? (
          <EmptyState
            title="Aucun paiement"
            description="Les encaissements enregistrés depuis les ventes et les factures apparaîtront ici."
          />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Numéro</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Tiers</th>
                  <th className="px-4 py-2 font-medium">Facture</th>
                  <th className="px-4 py-2 font-medium">Mode</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {result.items.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600 sm:px-5">
                      {payment.number}
                      <p className="font-sans text-xs text-ink-400">
                        {payment.user?.fullName ?? 'Système'}
                      </p>
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600">
                      {payment.paidAt.toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-3 text-ink-700">{payment.partner?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      {payment.invoice ? (
                        <Link
                          href={`/factures/${payment.invoice.id}`}
                          className="font-mono text-xs text-brand-700 hover:underline"
                        >
                          {payment.invoice.number}
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-400">Acompte</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {payment.method?.name ?? '—'}
                      {payment.reference && (
                        <p className="text-xs text-ink-400">{payment.reference}</p>
                      )}
                    </td>
                    <td
                      className={`tabular px-4 py-3 text-right font-medium sm:px-5 ${
                        payment.direction === 'IN' ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {payment.direction === 'IN' ? '+' : '-'}
                      {money(payment.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
