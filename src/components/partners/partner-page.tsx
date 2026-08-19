import { formatMoney, toDecimalString } from '@/lib/money';
import { listQuerySchema } from '@/lib/validation/list-query';
import { getCurrencyFormat } from '@/server/currency';
import { countPartners, listPartners } from '@/server/services/partners';
import { can, requireTenantWith } from '@/server/tenant';
import type { PermissionKey } from '@/server/permissions';
import { PartnerManager } from '@/components/partners/partner-manager';
import type { PartnerKind } from '@/lib/validation/catalog';

/**
 * Rendu serveur commun aux pages Clients et Fournisseurs : lecture des filtres
 * d'URL, chargement pagine et mise en forme des montants dans la devise de
 * l'entreprise.
 */
export async function renderPartnerPage({
  segment,
  kind,
  readPermission,
  writePermission,
  deletePermission,
  labels,
  searchParams,
}: {
  segment: 'clients' | 'fournisseurs';
  kind: PartnerKind;
  readPermission: PermissionKey;
  writePermission: PermissionKey;
  deletePermission: PermissionKey;
  labels: {
    title: string;
    subtitle: string;
    singular: string;
    createCta: string;
    emptyTitle: string;
    emptyBody: string;
    creditHint: string;
  };
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith(readPermission);
  const raw = await searchParams;
  const query = listQuerySchema.parse({
    page: raw.page ?? 1,
    pageSize: 25,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    includeInactive: raw.includeInactive,
  });

  const [result, counts, currency] = await Promise.all([
    listPartners(context.companyId, kind, query),
    countPartners(context.companyId, kind),
    getCurrencyFormat(context.currencyCode),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">{labels.title}</h1>
        <p className="mt-1 text-ink-600">{labels.subtitle}</p>
        <p className="mt-1 text-sm text-ink-500">
          {counts.active} actif(s)
          {counts.inactive > 0 ? ` · ${counts.inactive} inactif(s)` : ''}
        </p>
      </div>

      <PartnerManager
        segment={segment}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        currency={{ symbol: currency.symbol, decimals: currency.decimals }}
        canWrite={can(context, writePermission)}
        canDelete={can(context, deletePermission)}
        labels={labels}
        rows={result.items.map((partner) => ({
          id: partner.id,
          code: partner.code,
          name: partner.name,
          companyName: partner.companyName ?? '',
          phone: partner.phone ?? '',
          secondPhone: partner.secondPhone ?? '',
          email: partner.email ?? '',
          addressLine: partner.addressLine ?? '',
          city: partner.city ?? '',
          countryCode: partner.countryCode ?? '',
          taxNumber: partner.taxNumber ?? '',
          // Le formulaire reedite la valeur brute, le tableau affiche la version
          // formatee : deux besoins distincts, deux champs.
          creditLimit: toDecimalString(partner.creditLimit, currency.decimals),
          creditLimitLabel:
            partner.creditLimit > 0n
              ? formatMoney(partner.creditLimit, currency, context.locale)
              : '—',
          notes: partner.notes ?? '',
          isActive: partner.isActive,
        }))}
      />
    </div>
  );
}
