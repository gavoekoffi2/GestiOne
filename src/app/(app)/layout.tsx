import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { visibleNavigation } from '@/lib/navigation';
import { hasPermission } from '@/server/permissions';
import { getSessionUser, getTenantContext } from '@/server/tenant';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getTenantContext();
  if (!context) redirect('/connexion');

  const session = await getSessionUser();

  return (
    <AppShell
      navigation={visibleNavigation(context.permissions, hasPermission)}
      user={{
        fullName: context.userFullName,
        email: context.userEmail,
        roleName: context.roleName,
      }}
      company={{
        id: context.companyId,
        name: context.companyName,
        currencyCode: context.currencyCode,
      }}
      memberships={session?.memberships ?? []}
    >
      {children}
    </AppShell>
  );
}
