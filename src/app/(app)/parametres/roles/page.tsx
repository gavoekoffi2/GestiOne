import type { Metadata } from 'next';
import { listRoles } from '@/server/services/members';
import { PERMISSION_GROUPS } from '@/server/permissions';
import { requireTenantWith } from '@/server/tenant';
import { RolesManager } from './roles-manager';

export const metadata: Metadata = { title: 'Rôles et permissions' };
export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const context = await requireTenantWith('settings.roles');
  const roles = await listRoles(context.companyId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Rôles et permissions</h1>
        <p className="mt-1 text-ink-600">
          Un rôle est une liste de droits. Les permissions sont vérifiées par le serveur à chaque
          opération : masquer un bouton ne suffit pas, et n&apos;est pas ce qui protège vos données.
        </p>
      </div>

      <RolesManager
        roles={roles.map((role) => ({
          id: role.id,
          key: role.key,
          name: role.name,
          description: role.description ?? '',
          permissions: role.permissions,
          isSystem: role.isSystem,
          memberCount: role._count.memberships,
        }))}
        groups={PERMISSION_GROUPS.map((group) => ({
          key: group.key,
          label: group.label,
          permissions: group.permissions.map((permission) => ({
            key: permission.key,
            label: permission.label,
          })),
        }))}
      />
    </div>
  );
}
