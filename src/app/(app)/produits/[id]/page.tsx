import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, ButtonLink, Card, EmptyState } from '@/components/ui/primitives';
import { StatTile } from '@/components/charts/stat-tile';
import { formatDate, formatDateTime, formatRelative } from '@/lib/dates';
import { formatMoney, multiplyByQuantity } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';
import { NotFoundError } from '@/server/errors';
import { getCurrencyFormat } from '@/server/currency';
import { getProductAccount, SALES_WINDOW_DAYS } from '@/server/services/product-account';
import { MOVEMENT_LABELS, type MovementKind } from '@/server/services/stock';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Fiche article' };
export const dynamic = 'force-dynamic';

function toneFor(kind: string) {
  if (kind === 'IN' || kind === 'TRANSFER_IN') return 'success' as const;
  if (kind === 'OUT' || kind === 'TRANSFER_OUT') return 'danger' as const;
  return 'warning' as const;
}

/**
 * Fiche d'un article.
 *
 * Elle repond a la question posee devant le rayon : combien en reste-t-il, ou,
 * a quel rythme part-il, et gagne-t-on de l'argent dessus. Les prix d'achat et
 * la marge ne sont montres qu'a qui a la permission de les voir : un vendeur
 * peut consulter le stock sans connaitre les conditions negociees avec le
 * fournisseur.
 */
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantWith('products.read');
  const { id } = await params;

  let account;
  try {
    account = await getProductAccount(context.companyId, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const currency = await getCurrencyFormat(context.currencyCode);
  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);
  const quantity = (value: bigint) => formatQuantity(value, context.locale);

  const { product } = account;
  const showCost = can(context, 'products.cost.read');
  const unitSymbol = product.unit?.symbol ? ` ${product.unit.symbol}` : '';
  const isService = !product.trackStock;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/produits" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour au catalogue
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink-900">{product.name}</h1>
            {!product.isActive && <Badge tone="neutral">Inactif</Badge>}
            {isService && <Badge tone="info">Service</Badge>}
            {account.lowLocations.length > 0 && <Badge tone="danger">Stock faible</Badge>}
          </div>
          <p className="mt-1 font-mono text-sm text-ink-500">
            {product.sku}
            {product.barcode ? ` · ${product.barcode}` : ''}
          </p>
          <p className="text-sm text-ink-600">
            {[product.category?.name, product.unit?.name, product.supplier?.name]
              .filter(Boolean)
              .join(' · ') || 'Aucune categorie'}
          </p>
        </div>

        {can(context, 'products.write') && (
          <ButtonLink href="/produits" variant="secondary">
            Modifier dans le catalogue
          </ButtonLink>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon="box"
          label={isService ? 'Suivi en stock' : 'En stock'}
          value={isService ? 'Sans objet' : `${quantity(account.totalQuantity)}${unitSymbol}`}
          hint={
            isService
              ? "Un service n'est pas suivi en stock."
              : `Reparti sur ${account.levels.length} point(s) de vente`
          }
          tone={account.lowLocations.length > 0 ? 'danger' : undefined}
        />
        <StatTile
          icon="cart"
          label={`Vendu sur ${SALES_WINDOW_DAYS} jours`}
          value={`${quantity(account.soldQuantity)}${unitSymbol}`}
          hint={`${account.invoiceCount} facture(s)`}
        />
        <StatTile
          icon="chart"
          label={`Chiffre d'affaires sur ${SALES_WINDOW_DAYS} jours`}
          value={money(account.soldRevenue)}
          hint={
            account.lastSaleAt ? `Derniere vente ${formatRelative(account.lastSaleAt)}` : 'Jamais vendu'
          }
        />
        {showCost ? (
          <StatTile
            icon="wallet"
            label="Marge brute"
            value={money(account.margin)}
            hint={
              account.marginPercent === null
                ? 'Aucune vente sur la periode'
                : `${account.marginPercent} % du chiffre d'affaires`
            }
            tone={account.margin < 0n ? 'danger' : account.margin > 0n ? 'success' : undefined}
          />
        ) : (
          <StatTile
            icon="cash"
            label="Prix de vente"
            value={money(product.salePrice)}
            hint={product.unit ? `Par ${product.unit.name.toLowerCase()}` : undefined}
          />
        )}
      </div>

      {account.lowLocations.length > 0 && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <p className="font-semibold">
            Sous le seuil d&apos;alerte ({quantity(product.minStock)}
            {unitSymbol})
          </p>
          <ul className="mt-1 space-y-0.5">
            {account.lowLocations.map((location) => (
              <li key={location.locationId}>
                {location.locationName} : {quantity(location.quantity)}
                {unitSymbol}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Prix" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <Row label="Prix de vente" value={money(product.salePrice)} />
            {product.wholesalePrice !== null && (
              <Row
                label="Prix de gros"
                value={`${money(product.wholesalePrice)}${
                  product.wholesaleFrom !== null
                    ? ` a partir de ${quantity(product.wholesaleFrom)}${unitSymbol}`
                    : ''
                }`}
              />
            )}
            {product.specialPrice !== null && (
              <Row label="Prix negocie" value={money(product.specialPrice)} />
            )}
            {showCost && <Row label="Prix d'achat" value={money(product.costPrice)} />}
            {showCost && !isService && (
              <Row label="Valeur du stock" value={money(account.stockValue)} />
            )}
            {showCost && account.soldRevenue > 0n && (
              <Row label="Cout des ventes" value={money(account.soldCost)} />
            )}
            {!isService && product.minStock > 0n && (
              <Row label="Seuil d'alerte" value={`${quantity(product.minStock)}${unitSymbol}`} />
            )}
            {account.lastPurchaseAt && (
              <Row label="Dernier achat" value={formatDate(account.lastPurchaseAt)} />
            )}
          </dl>

          {product.description && (
            <p className="mt-4 border-t border-ink-100 pt-3 text-sm text-ink-600">
              {product.description}
            </p>
          )}
        </Card>

        <Card
          title="Stock par point de vente"
          description={isService ? undefined : 'Solde issu du journal des mouvements.'}
          className="lg:col-span-2"
        >
          {isService ? (
            <EmptyState
              title="Cet article est un service"
              description="Un service n'a pas de stock : il n'est ni receptionne ni decompte a la vente."
            />
          ) : account.levels.length === 0 ? (
            <EmptyState
              title="Aucun mouvement enregistre"
              description="Cet article n'est encore entre dans aucun point de vente."
              action={
                can(context, 'stock.move') ? (
                  <ButtonLink href="/stock" variant="secondary">
                    Enregistrer une entree
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[30rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Point de vente</th>
                    <th className="px-4 py-2 text-right font-medium">Quantite</th>
                    {showCost && <th className="px-4 py-2 text-right font-medium sm:px-5">Valeur</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {account.levels.map((level) => {
                    const low = product.minStock > 0n && level.quantity < product.minStock;
                    return (
                      <tr key={level.id}>
                        <td className="px-4 py-3 sm:px-5">
                          <span className="text-ink-900">{level.location.name}</span>
                          {!level.location.isActive && (
                            <span className="ml-2 text-xs text-ink-400">ferme</span>
                          )}
                        </td>
                        <td
                          className={`tabular px-4 py-3 text-right font-medium ${
                            low ? 'text-red-700' : 'text-ink-900'
                          }`}
                        >
                          {quantity(level.quantity)}
                          {unitSymbol}
                        </td>
                        {showCost && (
                          <td className="tabular px-4 py-3 text-right text-ink-600 sm:px-5">
                            {money(multiplyByQuantity(product.costPrice, level.quantity))}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {can(context, 'stock.read') && !isService && (
        <Card
          title="Derniers mouvements"
          description="Le journal est en ajout seul : une correction cree un mouvement inverse, elle n'efface rien."
          action={
            <Link
              href={`/stock/mouvements`}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              Tous les mouvements
            </Link>
          }
        >
          {account.movements.length === 0 ? (
            <EmptyState title="Aucun mouvement pour cet article." />
          ) : (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Date</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Point de vente</th>
                    <th className="px-4 py-2 text-right font-medium">Variation</th>
                    <th className="px-4 py-2 text-right font-medium">Solde</th>
                    <th className="px-4 py-2 font-medium sm:px-5">Motif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {account.movements.map((movement) => (
                    <tr key={movement.id}>
                      <td className="px-4 py-3 text-ink-600 sm:px-5">
                        {formatDateTime(movement.createdAt)}
                        {movement.userName && (
                          <p className="text-xs text-ink-400">{movement.userName}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={toneFor(movement.kind)}>
                          {MOVEMENT_LABELS[movement.kind as MovementKind] ?? movement.kind}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-ink-600">{movement.locationName}</td>
                      <td
                        className={`tabular px-4 py-3 text-right font-medium ${
                          movement.quantity < 0n ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {movement.quantity > 0n ? '+' : ''}
                        {quantity(movement.quantity)}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-ink-700">
                        {quantity(movement.quantityAfter)}
                      </td>
                      <td className="px-4 py-3 text-ink-600 sm:px-5">
                        {movement.reason || '—'}
                        {movement.reference && (
                          <p className="font-mono text-xs text-ink-400">{movement.reference}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className="tabular font-medium text-ink-900">{value}</dd>
    </div>
  );
}
