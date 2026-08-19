import type { Metadata } from 'next';
import { listLocations } from '@/server/services/locations';
import { requireTenantWith } from '@/server/tenant';
import { LocationsManager } from './locations-manager';

export const metadata: Metadata = { title: 'Points de vente' };
export const dynamic = 'force-dynamic';

export default async function LocationsPage() {
  const context = await requireTenantWith('settings.locations');
  const locations = await listLocations(context.companyId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Points de vente</h1>
        <p className="mt-1 text-ink-600">
          Boutiques, agences et depots. Chacun disposera de son propre stock et de sa propre caisse.
        </p>
      </div>

      <LocationsManager
        locations={locations.map((location) => ({
          id: location.id,
          name: location.name,
          code: location.code,
          kind: location.kind,
          addressLine: location.addressLine ?? '',
          city: location.city ?? '',
          phone: location.phone ?? '',
          isDefault: location.isDefault,
          isActive: location.isActive,
        }))}
      />
    </div>
  );
}
