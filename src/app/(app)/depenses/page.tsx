import type { Metadata } from 'next';
import { z } from 'zod';
import { Card } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { ExpenseManager } from '@/components/finance/expense-manager';
import { formatMoney } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import { expensesByCategory, listExpenseCategories, listExpenses } from '@/server/services/expenses';
import { listPaymentMethods } from '@/server/services/commerce-setup';
import { listLocations } from '@/server/services/locations';
import { listPartners } from '@/server/services/partners';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Depenses' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().max(64).optional(),
});

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('expenses.read');
  const raw = await searchParams;
  const query = querySchema.parse({
    page: raw.page ?? 1,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    categoryId: typeof raw.categoryId === 'string' ? raw.categoryId : undefined,
  });

  // Mois en cours, en heure locale de l'entreprise.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [result, categories, methods, locations, suppliers, breakdown, currency] =
    await Promise.all([
      listExpenses(context.companyId, {
        page: query.page,
        pageSize: 30,
        search: query.search,
        categoryId: query.categoryId || undefined,
      }),
      listExpenseCategories(context.companyId),
      listPaymentMethods(context.companyId),
      listLocations(context.companyId),
      listPartners(context.companyId, 'SUPPLIER', { page: 1, pageSize: 200 }),
      expensesByCategory(context.companyId, monthStart),
      getCurrencyFormat(context.currencyCode),
    ]);

  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);
  const monthTotal = breakdown.reduce((sum, row) => sum + row.total, 0n);
  const activeLocations = locations.filter((location) => location.isActive);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Depenses</h1>
        <p className="mt-1 text-ink-600">
          Vos charges de fonctionnement. Une depense reglee en especes sort automatiquement de la
          caisse.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
          <div className="flex items-center gap-2 text-ink-500">
            <Icon name="minus" className="size-4" />
            <p className="text-sm">Depenses du mois</p>
          </div>
          <p className="tabular mt-2 text-2xl font-bold text-ink-900">{money(monthTotal)}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
          <div className="flex items-center gap-2 text-ink-500">
            <Icon name="list" className="size-4" />
            <p className="text-sm">Total affiche</p>
          </div>
          <p className="tabular mt-2 text-2xl font-bold text-ink-900">{money(result.sum)}</p>
        </div>
      </div>

      {breakdown.length > 0 && (
        <Card title="Repartition du mois" description="Ou part votre argent, par categorie.">
          <ul className="space-y-2">
            {breakdown.map((row) => {
              const share = monthTotal > 0n ? Number((row.total * 100n) / monthTotal) : 0;
              return (
                <li key={row.categoryId ?? 'none'}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-700">{row.name}</span>
                    <span className="tabular font-medium text-ink-900">{money(row.total)}</span>
                  </div>
                  <div
                    className="mt-1 h-1.5 rounded-full bg-ink-100"
                    role="img"
                    aria-label={`${row.name} : ${share} % des depenses du mois`}
                  >
                    <div
                      className="h-full rounded-full bg-brand-600"
                      style={{ width: `${Math.max(share, 1)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ExpenseManager
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        currency={{ symbol: currency.symbol, decimals: currency.decimals }}
        canWrite={can(context, 'expenses.write')}
        canDelete={can(context, 'expenses.delete')}
        defaultLocationId={context.defaultLocationId ?? ''}
        categories={categories.map((category) => ({ id: category.id, label: category.name }))}
        methods={methods.map((method) => ({ id: method.id, label: method.name }))}
        locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
        suppliers={suppliers.items.map((supplier) => ({ id: supplier.id, label: supplier.name }))}
        rows={result.items.map((expense) => ({
          id: expense.id,
          number: expense.number,
          date: expense.spentAt.toLocaleDateString('fr-FR'),
          description: expense.description,
          categoryName: expense.category?.name ?? '',
          locationName: expense.location?.name ?? '',
          methodName: expense.method?.name ?? '',
          reference: expense.reference ?? '',
          amountLabel: money(expense.amount),
          userName: expense.user?.fullName ?? 'Systeme',
        }))}
      />
    </div>
  );
}
