import type { Metadata } from 'next';
import Link from 'next/link';
import { listCategories, listUnits } from '@/server/services/catalog';
import { can, requireTenantWith } from '@/server/tenant';
import { OrganisationManager } from '@/components/catalog/organisation-manager';

export const metadata: Metadata = { title: 'Categories et unites' };
export const dynamic = 'force-dynamic';

export default async function OrganisationPage() {
  const context = await requireTenantWith('products.read');
  const [categories, units] = await Promise.all([
    listCategories(context.companyId),
    listUnits(context.companyId),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/produits" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour au catalogue
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">Categories et unites</h1>
        <p className="mt-1 text-ink-600">
          L&apos;organisation de votre catalogue : comment vos articles sont classes et dans quelles
          unites ils se vendent.
        </p>
      </div>

      <OrganisationManager
        canWrite={can(context, 'products.write')}
        canDelete={can(context, 'products.delete')}
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          parentId: category.parentId ?? '',
          parentName: category.parent?.name ?? '',
          productCount: category._count.products,
        }))}
        units={units.map((unit) => ({
          id: unit.id,
          name: unit.name,
          symbol: unit.symbol,
          isSystem: unit.isSystem,
          productCount: unit._count.products,
        }))}
      />
    </div>
  );
}
