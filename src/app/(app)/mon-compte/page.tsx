import type { Metadata } from 'next';
import { AccountManager } from '@/components/account/account-manager';
import { formatDate, formatRelative } from '@/lib/dates';
import { PASSWORD_MIN_LENGTH } from '@/lib/validation/password';
import { describeDevice, getProfile, listActiveSessions } from '@/server/services/profile';
import { requireTenant } from '@/server/tenant';

export const metadata: Metadata = { title: 'Mon compte' };
export const dynamic = 'force-dynamic';

/**
 * Compte personnel.
 *
 * Aucune permission n'est exigee : la page n'expose que les donnees de
 * l'utilisateur connecte, et changer son propre mot de passe ne releve pas de
 * l'administration de l'entreprise. Un caissier qui n'a le droit de rien
 * d'autre doit pouvoir le faire.
 */
export default async function AccountPage() {
  const context = await requireTenant();

  const [profile, sessions] = await Promise.all([
    getProfile(context.userId),
    listActiveSessions(context.userId, context.sessionId),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Mon compte</h1>
        <p className="mt-1 text-ink-600">
          Vos informations personnelles, votre mot de passe et les appareils connectes a votre
          compte.
        </p>
        <p className="mt-1 text-sm text-ink-500">
          {context.roleName} chez {context.companyName}
          {profile.lastLoginAt
            ? ` · derniere connexion ${formatRelative(profile.lastLoginAt)}`
            : ''}{' '}
          · compte cree le {formatDate(profile.createdAt)}
        </p>
      </div>

      <AccountManager
        fullName={profile.fullName}
        phone={profile.phone ?? ''}
        email={profile.email}
        passwordMinLength={PASSWORD_MIN_LENGTH}
        devices={sessions.map((session) => ({
          id: session.id,
          label: describeDevice(session.userAgent),
          ipAddress: session.ipAddress ?? 'adresse inconnue',
          lastSeenLabel: formatRelative(session.lastSeenAt),
          createdLabel: formatRelative(session.createdAt),
          isCurrent: session.isCurrent,
        }))}
      />
    </div>
  );
}
