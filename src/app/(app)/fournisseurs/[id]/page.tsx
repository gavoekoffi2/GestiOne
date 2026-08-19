import type { Metadata } from 'next';
import { renderPartnerAccountPage } from '@/components/partners/partner-account-page';

export const metadata: Metadata = { title: 'Fiche fournisseur' };
export const dynamic = 'force-dynamic';

export default async function SupplierAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return renderPartnerAccountPage({
    kind: 'SUPPLIER',
    partnerId: id,
    readPermission: 'suppliers.read',
  });
}
