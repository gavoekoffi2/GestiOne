import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, ButtonLink, Card } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { SHIPPED_PHASE } from '@/lib/navigation';
import { getCompanyOverview } from '@/server/services/onboarding';
import { getCompanyProfile } from '@/server/services/companies';
import { hasPermission, type PermissionKey } from '@/server/permissions';
import { requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Tableau de bord' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const context = await requireTenantWith('dashboard.view');
  const [overview, company] = await Promise.all([
    getCompanyOverview(context.companyId),
    getCompanyProfile(context.companyId),
  ]);

  const visibleSteps = overview.steps.filter(
    (step) => !step.permission || hasPermission(context.permissions, step.permission as PermissionKey),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Bonjour {context.userFullName.split(' ')[0]}</h1>
        <p className="mt-1 text-ink-600">
          {company.name} · {company.currency.name} ({company.currencyCode}) · connecte en tant que{' '}
          {context.roleName}
        </p>
      </div>

      {/*
        Le tableau de bord commercial (chiffre d'affaires, creances, stock) est
        livre avec les modules qui produisent ces donnees. Tant qu'ils n'existent
        pas, GestiOne le dit franchement plutot que d'afficher des zeros ou des
        chiffres inventes.
      */}
      <Alert tone="info" title={`Fondation installee (phase ${SHIPPED_PHASE})`}>
        Votre entreprise, vos utilisateurs, vos roles et vos points de vente sont operationnels. Les
        indicateurs commerciaux — chiffre d&apos;affaires, creances, stock et caisse — apparaitront
        ici des la mise en service des modules correspondants. Aucun chiffre n&apos;est affiche tant
        qu&apos;il n&apos;est pas reellement mesure.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Utilisateurs actifs" value={overview.activeUserCount} icon="users" />
        <StatTile label="Points de vente" value={overview.locationCount} icon="pin" />
        <StatTile label="Roles configures" value={overview.roleCount} icon="shield" />
        <StatTile label="Evenements journalises" value={overview.auditCount} icon="list" />
      </div>

      {visibleSteps.length > 0 && (
        <Card
          title="Mise en route"
          description={`${visibleSteps.filter((step) => step.done).length} etape(s) sur ${visibleSteps.length} terminee(s).`}
        >
          <ul className="divide-y divide-ink-200">
            {visibleSteps.map((step) => (
              <li key={step.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  className={
                    step.done
                      ? 'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700'
                      : 'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-400'
                  }
                  aria-hidden="true"
                >
                  {step.done ? '✓' : '·'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{step.label}</p>
                  <p className="text-sm text-ink-500">{step.description}</p>
                </div>
                {step.done ? (
                  <Badge tone="success">Fait</Badge>
                ) : (
                  step.href && (
                    <Link
                      href={step.href}
                      className="shrink-0 text-sm font-semibold text-brand-700 hover:underline"
                    >
                      Configurer
                    </Link>
                  )
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {hasPermission(context.permissions, 'settings.company') && (
        <Card
          title="Parametres de l'entreprise"
          description="Coordonnees, devise, prefixes de numerotation et apparence des documents."
          action={<ButtonLink href="/parametres" variant="secondary">Ouvrir</ButtonLink>}
        >
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Raison sociale" value={company.legalName ?? company.name} />
            <Detail label="Devise" value={`${company.currencyCode} — ${company.currency.symbol}`} />
            <Detail label="Pays" value={company.countryCode} />
            <Detail label="Telephone" value={company.phone} />
            <Detail label="Email" value={company.email} />
            <Detail label="Identifiant fiscal" value={company.taxNumber} />
          </dl>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
      <div className="flex items-center gap-2 text-ink-500">
        <Icon name={icon} className="size-4" />
        <p className="text-sm">{label}</p>
      </div>
      <p className="tabular mt-2 text-3xl font-bold text-ink-900">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className={value ? 'mt-0.5 text-ink-800' : 'mt-0.5 text-ink-400'}>
        {value ?? 'Non renseigne'}
      </dd>
    </div>
  );
}
