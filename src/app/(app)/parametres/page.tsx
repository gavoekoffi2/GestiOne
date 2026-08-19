import type { Metadata } from 'next';
import { getCompanyProfile } from '@/server/services/companies';
import { listCurrencies } from '@/server/services/currencies';
import { requireTenantWith } from '@/server/tenant';
import { CompanySettingsForm } from './company-form';

export const metadata: Metadata = { title: "Parametres de l'entreprise" };
export const dynamic = 'force-dynamic';

export default async function CompanySettingsPage() {
  const context = await requireTenantWith('settings.company');
  const [company, currencies] = await Promise.all([
    getCompanyProfile(context.companyId),
    listCurrencies(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Parametres de l&apos;entreprise</h1>
        <p className="mt-1 text-ink-600">
          Ces informations apparaissent sur vos devis, factures et recus.
        </p>
      </div>

      <CompanySettingsForm
        company={{
          name: company.name,
          legalName: company.legalName ?? '',
          addressLine: company.addressLine ?? '',
          city: company.city ?? '',
          countryCode: company.countryCode,
          phone: company.phone ?? '',
          email: company.email ?? '',
          website: company.website ?? '',
          taxNumber: company.taxNumber ?? '',
          currencyCode: company.currencyCode,
          primaryColor: company.primaryColor,
          invoicePrefix: company.invoicePrefix,
          quotePrefix: company.quotePrefix,
          salePrefix: company.salePrefix,
          purchasePrefix: company.purchasePrefix,
          documentFooter: company.documentFooter ?? '',
          paymentTerms: company.paymentTerms ?? '',
          defaultDueDays: company.defaultDueDays,
        }}
        currencies={currencies.map((currency) => ({
          code: currency.code,
          name: currency.name,
          decimals: currency.decimals,
        }))}
      />
    </div>
  );
}
