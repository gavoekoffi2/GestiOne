import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card } from '@/components/ui/primitives';
import { PurchaseActions } from '@/components/finance/purchase-actions';
import { formatMoney, toDecimalString } from '@/lib/money';
import { formatQuantity, toQuantityString } from '@/lib/quantity';
import { getCurrencyFormat } from '@/server/currency';
import { listPaymentMethods } from '@/server/services/commerce-setup';
import {
  PURCHASE_STATUS_LABELS,
  getPurchaseOrder,
  type PurchaseStatus,
} from '@/server/services/purchases';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Commande fournisseur' };
export const dynamic = 'force-dynamic';

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireTenantWith('purchases.read');
  const { id } = await params;

  const [order, currency, methods] = await Promise.all([
    getPurchaseOrder(context.companyId, id),
    getCurrencyFormat(context.currencyCode),
    listPaymentMethods(context.companyId),
  ]);

  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/achats" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour aux achats
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">Commande {order.number}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge
            tone={
              order.status === 'RECEIVED'
                ? 'success'
                : order.status === 'PARTIALLY_RECEIVED'
                  ? 'warning'
                  : order.status === 'CANCELLED'
                    ? 'neutral'
                    : 'info'
            }
          >
            {PURCHASE_STATUS_LABELS[order.status as PurchaseStatus] ?? order.status}
          </Badge>
          {order.supplier && <span className="text-sm text-ink-600">{order.supplier.name}</span>}
        </div>
      </div>

      <PurchaseActions
        orderId={order.id}
        status={order.status}
        balanceDueRaw={toDecimalString(order.balanceDue, currency.decimals)}
        balanceDueLabel={money(order.balanceDue)}
        currency={{ symbol: currency.symbol, decimals: currency.decimals }}
        canWrite={can(context, 'purchases.write')}
        canReceive={can(context, 'purchases.receive')}
        canPay={can(context, 'payments.create')}
        methods={methods.map((method) => ({
          id: method.id,
          label: method.name,
          requiresReference: method.requiresReference,
          isCredit: method.isCredit,
        }))}
        lines={order.lines.map((line) => ({
          id: line.id,
          description: line.description,
          orderedLabel: `${formatQuantity(line.quantity, context.locale)} ${line.product?.unit?.symbol ?? ''}`.trim(),
          receivedLabel: formatQuantity(line.receivedQuantity, context.locale),
          remainingRaw: toQuantityString(line.quantity - line.receivedQuantity),
          remaining: line.receivedQuantity < line.quantity,
        }))}
      />

      <Card title="Lignes">
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2 font-medium sm:px-5">Designation</th>
                <th className="px-4 py-2 text-right font-medium">Commande</th>
                <th className="px-4 py-2 text-right font-medium">Recu</th>
                <th className="px-4 py-2 text-right font-medium">Cout unitaire</th>
                <th className="px-4 py-2 text-right font-medium sm:px-5">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3 sm:px-5">
                    <p className="text-ink-900">{line.description}</p>
                    {line.product?.sku && (
                      <p className="font-mono text-xs text-ink-400">{line.product.sku}</p>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-right text-ink-700">
                    {formatQuantity(line.quantity, context.locale)}
                  </td>
                  <td
                    className={`tabular px-4 py-3 text-right font-medium ${
                      line.receivedQuantity >= line.quantity ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {formatQuantity(line.receivedQuantity, context.locale)}
                  </td>
                  <td className="tabular px-4 py-3 text-right text-ink-700">
                    {money(line.unitCost)}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-medium text-ink-900 sm:px-5">
                    {money(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end border-t border-ink-200 pt-4">
          <dl className="w-full max-w-xs space-y-1 text-sm">
            <Row label="Sous-total" value={money(order.subtotal)} />
            {order.discountAmount > 0n && (
              <Row label="Remise" value={`- ${money(order.discountAmount)}`} />
            )}
            {order.taxTotal > 0n && <Row label="Taxes" value={money(order.taxTotal)} />}
            <div className="border-t border-ink-300 pt-1">
              <Row label="Total" value={money(order.total)} strong />
            </div>
            {order.paidAmount > 0n && <Row label="Deja regle" value={money(order.paidAmount)} />}
            {order.balanceDue > 0n && (
              <Row label="Reste a regler" value={money(order.balanceDue)} strong />
            )}
          </dl>
        </div>
      </Card>

      {order.payments.length > 0 && (
        <Card title="Reglements">
          <ul className="divide-y divide-ink-100 text-sm">
            {order.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="text-ink-600">
                  {payment.paidAt.toLocaleDateString('fr-FR')} · {payment.method?.name ?? 'Non precise'}
                  {payment.reference && ` · ${payment.reference}`}
                </span>
                <span className="tabular font-medium text-ink-800">{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {order.status === 'CANCELLED' && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
          Commande annulee{order.cancelReason ? ` — ${order.cancelReason}` : ''}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold text-ink-900' : 'text-ink-600'}>{label}</dt>
      <dd className={`tabular ${strong ? 'text-lg font-bold text-ink-900' : 'text-ink-800'}`}>
        {value}
      </dd>
    </div>
  );
}
