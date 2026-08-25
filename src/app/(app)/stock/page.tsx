import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { ListToolbar, Pagination } from '@/components/ui/list-toolbar';
import { StockActions } from '@/components/stock/stock-actions';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';
import { getCurrencyFormat } from '@/server/currency';
import { listCategories, listProducts } from '@/server/services/catalog';
import { listLocations } from '@/server/services/locations';
import { listStock, stockSummary } from '@/server/services/stock-query';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Stock' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(120).optional(),
  locationId: z.string().trim().max(64).optional(),
  categoryId: z.string().trim().max(64).optional(),
  lowOnly: z.string().optional(),
});

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('stock.read');
  const raw = await searchParams;
  const parsed = querySchema.parse({
    page: raw.page ?? 1,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    locationId: typeof raw.locationId === 'string' ? raw.locationId : undefined,
    categoryId: typeof raw.categoryId === 'string' ? raw.categoryId : undefined,
    lowOnly: typeof raw.lowOnly === 'string' ? raw.lowOnly : undefined,
  });

  const query = {
    page: parsed.page,
    pageSize: 30,
    search: parsed.search || undefined,
    locationId: parsed.locationId || undefined,
    categoryId: parsed.categoryId || undefined,
    lowOnly: parsed.lowOnly === 'true',
  };

  const [result, summary, locations, categories, products, currency] = await Promise.all([
    listStock(context.companyId, query),
    stockSummary(context.companyId, query.locationId),
    listLocations(context.companyId),
    listCategories(context.companyId),
    listProducts(context.companyId, { page: 1, pageSize: 500, kind: 'GOOD' }),
    getCurrencyFormat(context.currencyCode),
  ]);

  const activeLocations = locations.filter((location) => location.isActive);

  // La valeur du stock est calculee au prix d'achat : elle revele la marge de
  // l'entreprise autant que la fiche article. Un caissier a "stock.read" sans
  // "products.cost.read" — les colonnes chiffrees lui sont donc masquees, et
  // les montants ne sont meme pas envoyes au navigateur.
  const canSeeCost = can(context, 'products.cost.read');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Stock</h1>
          <p className="mt-1 text-ink-600">
            {query.locationId
              ? 'Stock du point de vente sélectionné.'
              : 'Vue consolidée de tous vos points de vente.'}
          </p>
        </div>
        <Link href="/stock/mouvements" className="text-sm font-semibold text-brand-700 hover:underline">
          Historique des mouvements
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Articles suivis" value={String(summary.trackedProducts)} icon="box" />
        {canSeeCost && (
          <Tile
            label="Valeur du stock"
            value={formatMoney(summary.totalValue, currency, context.locale)}
            icon="cash"
            hint="Au prix d'achat"
          />
        )}
        <Tile
          label="Stock faible"
          value={String(summary.lowCount)}
          icon="layers"
          tone={summary.lowCount > 0 ? 'warning' : undefined}
        />
        <Tile
          label="En rupture"
          value={String(summary.outCount)}
          icon="minus"
          tone={summary.outCount > 0 ? 'danger' : undefined}
        />
      </div>

      <StockActions
        canMove={can(context, 'stock.move')}
        canAdjust={can(context, 'stock.adjust')}
        defaultLocationId={context.defaultLocationId ?? activeLocations[0]?.id ?? ''}
        currency={{ symbol: currency.symbol, decimals: currency.decimals }}
        locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
        products={products.items.map((product) => ({
          id: product.id,
          label: `${product.name} (${product.sku})`,
        }))}
      />

      <ListToolbar
        placeholder="Rechercher un article (nom, référence, code-barres)"
        filters={[
          {
            name: 'locationId',
            label: 'Tous les points de vente',
            options: activeLocations.map((location) => ({
              value: location.id,
              label: location.name,
            })),
          },
          {
            name: 'categoryId',
            label: 'Toutes les catégories',
            options: categories.map((category) => ({ value: category.id, label: category.name })),
          },
          {
            name: 'lowOnly',
            label: 'Tous les niveaux',
            options: [{ value: 'true', label: 'Alertes uniquement' }],
          },
        ]}
        showInactive
      />

      <Card>
        {result.items.length === 0 ? (
          <EmptyState
            title="Aucun article à afficher"
            description="Enregistrez une entrée de stock pour commencer à suivre vos quantités."
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Article</th>
                    <th className="px-4 py-2 font-medium">Catégorie</th>
                    <th className="px-4 py-2 text-right font-medium">Quantité</th>
                    <th className="px-4 py-2 text-right font-medium">Seuil</th>
                    {canSeeCost && (
                      <th className="px-4 py-2 text-right font-medium">Valeur</th>
                    )}
                    <th className="px-4 py-2 font-medium sm:px-5">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {result.items.map((row) => (
                    <tr key={row.productId}>
                      <td className="px-4 py-3 sm:px-5">
                        <p className="font-medium text-ink-900">{row.name}</p>
                        <p className="font-mono text-xs text-ink-500">{row.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-600">{row.categoryName || '—'}</td>
                      <td className="tabular px-4 py-3 text-right font-medium text-ink-900">
                        {formatQuantity(row.quantity, context.locale)}
                        {row.unitSymbol && (
                          <span className="ml-1 text-xs font-normal text-ink-500">{row.unitSymbol}</span>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-ink-500">
                        {row.minStock > 0n ? formatQuantity(row.minStock, context.locale) : '—'}
                      </td>
                      {canSeeCost && (
                        <td className="tabular px-4 py-3 text-right text-ink-600">
                          {formatMoney(row.value, currency, context.locale)}
                        </td>
                      )}
                      <td className="px-4 py-3 sm:px-5">
                        {row.isOut ? (
                          <Badge tone="danger">Rupture</Badge>
                        ) : row.isLow ? (
                          <Badge tone="warning">Stock faible</Badge>
                        ) : (
                          <Badge tone="success">Disponible</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <Pagination page={result.page} pageCount={result.pageCount} total={result.total} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  icon,
  hint,
  tone,
}: {
  label: string;
  value: string;
  icon: string;
  hint?: string;
  tone?: 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-ink-900';
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
      <div className="flex items-center gap-2 text-ink-500">
        <Icon name={icon} className="size-4" />
        <p className="text-sm">{label}</p>
      </div>
      <p className={`tabular mt-2 text-2xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
