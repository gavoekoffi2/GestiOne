import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, Select } from '@/components/ui/primitives';
import { AUDIT_ACTION_LABELS, listAuditLogs } from '@/server/services/audit-query';
import { requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: "Journal d'audit" };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

function toneFor(action: string) {
  if (action === 'LOGIN_FAILED' || action === 'DELETE' || action === 'CANCEL') return 'danger';
  if (action === 'PERMISSION_CHANGE') return 'warning';
  if (action === 'CREATE' || action === 'PAYMENT') return 'success';
  return 'neutral';
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string }>;
}) {
  const context = await requireTenantWith('settings.audit');
  const params = await searchParams;

  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const action = params.action && params.action in AUDIT_ACTION_LABELS ? params.action : undefined;

  const result = await listAuditLogs(context.companyId, { page, pageSize: PAGE_SIZE, action });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Journal d&apos;audit</h1>
        <p className="mt-1 text-ink-600">
          Trace de toutes les operations sensibles. Ce journal ne peut etre ni modifie ni efface,
          y compris par un administrateur.
        </p>
      </div>

      <Card
        title={`${result.total} evenement(s)`}
        action={
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="action" className="sr-only">
              Filtrer par type
            </label>
            <Select id="action" name="action" defaultValue={action ?? ''} className="min-h-9 text-sm">
              <option value="">Tous les types</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
            <button
              type="submit"
              className="min-h-9 rounded-lg bg-ink-800 px-3 text-sm font-semibold text-white"
            >
              Filtrer
            </button>
          </form>
        }
      >
        {result.entries.length === 0 ? (
          <EmptyState
            title="Aucun evenement"
            description="Les operations sensibles apparaitront ici des qu'elles seront effectuees."
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Date et heure</th>
                    <th className="px-4 py-2 font-medium">Utilisateur</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Objet</th>
                    <th className="px-4 py-2 font-medium sm:px-5">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {result.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600 sm:px-5">
                        {entry.createdAt.toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {entry.user?.fullName ?? 'Systeme'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={toneFor(entry.action)}>
                          {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-ink-600">{entry.entityType}</td>
                      <td className="px-4 py-3 text-ink-600 sm:px-5">{entry.summary ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.pageCount > 1 && (
              <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
                <PageLink page={page - 1} action={action} disabled={page <= 1}>
                  Precedent
                </PageLink>
                <span className="text-ink-500">
                  Page {result.page} sur {result.pageCount}
                </span>
                <PageLink page={page + 1} action={action} disabled={page >= result.pageCount}>
                  Suivant
                </PageLink>
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function PageLink({
  page,
  action,
  disabled,
  children,
}: {
  page: number;
  action?: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-ink-300">{children}</span>;
  }
  const query = new URLSearchParams({ page: String(page) });
  if (action) query.set('action', action);
  return (
    <Link
      href={`/parametres/audit?${query.toString()}`}
      className="font-semibold text-brand-700 hover:underline"
    >
      {children}
    </Link>
  );
}
