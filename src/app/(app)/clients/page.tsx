import type { Metadata } from 'next';
import { renderPartnerPage } from '@/components/partners/partner-page';

export const metadata: Metadata = { title: 'Clients' };
export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return renderPartnerPage({
    segment: 'clients',
    kind: 'CUSTOMER',
    readPermission: 'customers.read',
    writePermission: 'customers.write',
    deletePermission: 'customers.delete',
    searchParams,
    labels: {
      title: 'Clients',
      subtitle:
        'Vos clients, leurs coordonnées et le plafond d’encours que vous leur accordez.',
      singular: 'Client',
      createCta: 'Ajouter un client',
      emptyTitle: 'Aucun client pour le moment',
      emptyBody:
        'Ajoutez vos clients pour retrouver instantanément leurs coordonnées et suivre ce qu’ils vous doivent.',
      creditHint:
        'Montant maximum que ce client peut devoir. Laissez à 0 pour interdire la vente à crédit.',
    },
  });
}
