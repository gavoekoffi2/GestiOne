import type { Metadata } from 'next';
import { renderPartnerAccountPage } from '@/components/partners/partner-account-page';

export const metadata: Metadata = { title: 'Fiche client' };
export const dynamic = 'force-dynamic';

export default async function CustomerAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return renderPartnerAccountPage({
    kind: 'CUSTOMER',
    partnerId: id,
    readPermission: 'customers.read',
  });
}
