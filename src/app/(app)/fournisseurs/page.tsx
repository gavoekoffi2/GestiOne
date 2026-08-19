import type { Metadata } from 'next';
import { renderPartnerPage } from '@/components/partners/partner-page';

export const metadata: Metadata = { title: 'Fournisseurs' };
export const dynamic = 'force-dynamic';

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return renderPartnerPage({
    segment: 'fournisseurs',
    kind: 'SUPPLIER',
    readPermission: 'suppliers.read',
    writePermission: 'suppliers.write',
    deletePermission: 'suppliers.delete',
    searchParams,
    labels: {
      title: 'Fournisseurs',
      subtitle: 'Vos fournisseurs, leurs coordonnees et vos conditions d’achat.',
      singular: 'Fournisseur',
      createCta: 'Ajouter un fournisseur',
      emptyTitle: 'Aucun fournisseur pour le moment',
      emptyBody:
        'Ajoutez vos fournisseurs pour les rattacher a vos articles et suivre ce que vous leur devez.',
      creditHint: 'Montant maximum que vous pouvez devoir a ce fournisseur. 0 = pas de limite definie.',
    },
  });
}
