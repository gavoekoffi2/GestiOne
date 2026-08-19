import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Alert, Badge, Card, EmptyState, Select } from '@/components/ui/primitives';
import { formatQuantity } from '@/lib/quantity';
import { MOVEMENT_KIND_OPTIONS } from '@/lib/validation/stock';
import { MOVEMENT_LABELS, type MovementKind } from '@/server/services/stock';
import { listMovements } from '@/server/services/stock-query';
import { listLocations } from '@/server/services/locations';
import { requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Mouvements de stock' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  kind: z.string().trim().max(24).optional(),
  locationId: z.string().trim().max(64).optional(),
});

function toneFor(kind: string) {
  if (kind === 'IN' || kind === 'TRANSFER_IN') return 'success' as const;
  if (kind === 'OUT' || kind === 'TRANSFER_OUT') return 'danger' as const;
  return 'warning' as const;
}

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('stock.read');
  const raw = await searchParams;
  const query = querySchema.parse({
    page: raw.page ?? 1,
    kind: typeof raw.kind === 'string' ? raw.kind : undefined,
    locationId: typeof raw.locationId === 'string' ? raw.locationId : undefined,
  });

  const [result, locations] = await Promise.all([
    listMovements(context.companyId, {
      page: query.page,
      pageSize: PAGE_SIZE,
      kind: query.kind || undefined,
      locationId: query.locationId || undefined,
    }),
    listLocations(context.companyId),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/stock" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour au stock
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">Mouvements de stock</h1>
        <p className="mt-1 text-ink-600">
          Chaque entree, sortie, transfert et inventaire, dans l&apos;ordre ou ils ont eu lieu.
        </p>
      </div>

      <Alert tone="info">
        Ce journal ne peut pas etre modifie. Corriger une erreur consiste a enregistrer un
        mouvement inverse, qui reste lui aussi visible : c&apos;est ce qui rend votre historique de
        stock opposable en cas de litige ou de controle.
      </Alert>

      <Card
        title={`${result.total} mouvement(s)`}
        action={
          <form method="get" className="flex flex-wrap items-center gap-2">
            <label htmlFor="kind" className="sr-only">
              Type de mouvement
            </label>
            <Select id="kind" name="kind" defaultValue={query.kind ?? ''} className="min-h-9 text-sm">
              <option value="">Tous les types</option>
              {MOVEMENT_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <label htmlFor="locationId" className="sr-only">
              Point de vente
            </label>
            <Select
              id="locationId"
              name="locationId"
              defaultValue={query.locationId ?? ''}
              className="min-h-9 text-sm"
            >
              <option value="">Tous les points de vente</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
            <button
              type="submit"
              className="min-h-9 rounded-lg bg-ink-800 px-3 text-sm font-semibold text-white"
            >
              Filtrer
            </button>
          </form>
        }
      >
        {result.items.length === 0 ? (
          <EmptyState
            title="Aucun mouvement"
            description="Les entrees, sorties, transferts et inventaires apparaitront ici."
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Date</th>
                    <th className="px-4 py-2 font-medium">Article</th>
                    <th className="px-4 py-2 font-medium">Point de vente</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 text-right font-medium">Variation</th>
                    <th className="px-4 py-2 text-right font-medium">Stock apres</th>
                    <th className="px-4 py-2 font-medium sm:px-5">Motif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {result.items.map((movement) => (
                    <tr key={movement.id}>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600 sm:px-5">
                        {movement.createdAt.toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        <p className="text-xs text-ink-400">{movement.user?.fullName ?? 'Systeme'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink-900">{movement.product.name}</p>
                        <p className="font-mono text-xs text-ink-500">{movement.product.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-600">{movement.location.name}</td>
                      <td className="px-4 py-3">
                        <Badge tone={toneFor(movement.kind)}>
                          {MOVEMENT_LABELS[movement.kind as MovementKind] ?? movement.kind}
                        </Badge>
                      </td>
                      <td
                        className={`tabular px-4 py-3 text-right font-medium ${
                          movement.quantity < 0n ? 'text-red-600' : 'text-emerald-700'
                        }`}
                      >
                        {movement.quantity > 0n ? '+' : ''}
                        {formatQuantity(movement.quantity, context.locale)}
                        {movement.product.unit?.symbol && (
                          <span className="ml-1 text-xs font-normal text-ink-500">
                            {movement.product.unit.symbol}
                          </span>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-ink-700">
                        {formatQuantity(movement.quantityAfter, context.locale)}
                      </td>
                      <td className="px-4 py-3 text-ink-600 sm:px-5">
                        {movement.reason ?? '—'}
                        {movement.reference && (
                          <p className="text-xs text-ink-400">{movement.reference}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.pageCount > 1 && (
              <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
                <PageLink page={query.page - 1} query={query} disabled={query.page <= 1}>
                  Precedent
                </PageLink>
                <span className="text-ink-500">
                  Page {result.page} sur {result.pageCount}
                </span>
                <PageLink
                  page={query.page + 1}
                  query={query}
                  disabled={query.page >= result.pageCount}
                >
                  Suivant
                </PageLink>
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function PageLink({
  page,
  query,
  disabled,
  children,
}: {
  page: number;
  query: { kind?: string; locationId?: string };
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) return <span className="text-ink-300">{children}</span>;

  const params = new URLSearchParams({ page: String(page) });
  if (query.kind) params.set('kind', query.kind);
  if (query.locationId) params.set('locationId', query.locationId);

  return (
    <Link href={`/stock/mouvements?${params}`} className="font-semibold text-brand-700 hover:underline">
      {children}
    </Link>
  );
}
