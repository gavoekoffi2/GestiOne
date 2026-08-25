import type { Metadata } from 'next';
import { listLocations } from '@/server/services/locations';
import { listMembers, listRoles } from '@/server/services/members';
import { requireTenantWith } from '@/server/tenant';
import { MembersManager } from './members-manager';

export const metadata: Metadata = { title: 'Utilisateurs' };
export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const context = await requireTenantWith('settings.users');
  const [members, roles, locations] = await Promise.all([
    listMembers(context.companyId),
    listRoles(context.companyId),
    listLocations(context.companyId),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Utilisateurs</h1>
        <p className="mt-1 text-ink-600">
          Chaque collaborateur reçoit un rôle, qui détermine exactement ce qu&apos;il peut voir et
          faire.
        </p>
      </div>

      <MembersManager
        currentMembershipId={context.membershipId}
        members={members.map((member) => ({
          id: member.id,
          fullName: member.user.fullName,
          email: member.user.email,
          phone: member.user.phone ?? '',
          roleId: member.roleId,
          roleName: member.role.name,
          defaultLocationId: member.defaultLocationId ?? '',
          defaultLocationName: member.defaultLocation?.name ?? '',
          isOwner: member.isOwner,
          isActive: member.isActive,
          lastLoginAt: member.user.lastLoginAt ? member.user.lastLoginAt.toISOString() : null,
        }))}
        roles={roles.map((role) => ({ id: role.id, name: role.name }))}
        locations={locations
          .filter((location) => location.isActive)
          .map((location) => ({ id: location.id, name: location.name }))}
      />
    </div>
  );
}
