'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';
import { COUNTRIES } from '@/lib/countries';
import { LogoPicker } from '@/components/admin/logo-picker';
import { DOCUMENT_FORMATS } from '@/lib/validation/company';

export interface CompanyFormValues {
  name: string;
  legalName: string;
  addressLine: string;
  city: string;
  countryCode: string;
  phone: string;
  email: string;
  website: string;
  taxNumber: string;
  currencyCode: string;
  primaryColor: string;
  invoicePrefix: string;
  quotePrefix: string;
  salePrefix: string;
  purchasePrefix: string;
  documentFooter: string;
  paymentTerms: string;
  defaultDueDays: number;
  logoUrl: string;
  documentFormat: string;
}

export function CompanySettingsForm({
  company,
  currencies,
}: {
  company: CompanyFormValues;
  currencies: Array<{ code: string; name: string; decimals: number }>;
}) {
  const router = useRouter();
  const api = useApi();
  const [currencyCode, setCurrencyCode] = useState(company.currencyCode);

  const selectedCurrency = currencies.find((currency) => currency.code === currencyCode);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    const result = await api.send('/api/company', {
      method: 'PUT',
      body: payload,
      successMessage: 'Parametres enregistres.',
    });
    if (result) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      <Card title="Identite" description="Le nom affiche en tete de vos documents.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom commercial" htmlFor="name" required error={api.fieldErrors.name}>
            <Input id="name" name="name" defaultValue={company.name} required />
          </Field>
          <Field label="Raison sociale" htmlFor="legalName" error={api.fieldErrors.legalName}>
            <Input id="legalName" name="legalName" defaultValue={company.legalName} />
          </Field>
          <Field
            label="Identifiant fiscal"
            htmlFor="taxNumber"
            error={api.fieldErrors.taxNumber}
            hint="NIF, RCCM, numero de TVA — selon votre pays."
          >
            <Input id="taxNumber" name="taxNumber" defaultValue={company.taxNumber} />
          </Field>
          <Field label="Site web" htmlFor="website" error={api.fieldErrors.website}>
            <Input id="website" name="website" defaultValue={company.website} placeholder="https://" />
          </Field>
        </div>
      </Card>

      <Card title="Coordonnees">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Adresse" htmlFor="addressLine" error={api.fieldErrors.addressLine}>
            <Input id="addressLine" name="addressLine" defaultValue={company.addressLine} />
          </Field>
          <Field label="Ville" htmlFor="city" error={api.fieldErrors.city}>
            <Input id="city" name="city" defaultValue={company.city} />
          </Field>
          <Field label="Pays" htmlFor="countryCode" required error={api.fieldErrors.countryCode}>
            <Select id="countryCode" name="countryCode" defaultValue={company.countryCode}>
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Telephone" htmlFor="phone" error={api.fieldErrors.phone}>
            <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={company.phone} />
          </Field>
          <Field label="Email" htmlFor="email" error={api.fieldErrors.email}>
            <Input id="email" name="email" type="email" inputMode="email" defaultValue={company.email} />
          </Field>
        </div>
      </Card>

      <Card
        title="Devise et conditions de paiement"
        description="La devise determine la precision des montants dans toute l'application."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Devise"
            htmlFor="currencyCode"
            required
            error={api.fieldErrors.currencyCode}
            hint={
              selectedCurrency
                ? selectedCurrency.decimals === 0
                  ? 'Cette devise ne se divise pas : les montants sont des nombres entiers.'
                  : `Les montants sont saisis avec ${selectedCurrency.decimals} decimales.`
                : undefined
            }
          >
            <Select
              id="currencyCode"
              name="currencyCode"
              value={currencyCode}
              onChange={(event) => setCurrencyCode(event.target.value)}
            >
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} — {currency.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Delai de paiement par defaut"
            htmlFor="defaultDueDays"
            required
            error={api.fieldErrors.defaultDueDays}
            hint="Nombre de jours entre l'emission d'une facture et son echeance."
          >
            <Input
              id="defaultDueDays"
              name="defaultDueDays"
              type="number"
              min={0}
              max={365}
              inputMode="numeric"
              defaultValue={company.defaultDueDays}
              required
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Conditions de paiement" htmlFor="paymentTerms" error={api.fieldErrors.paymentTerms}>
              <Textarea
                id="paymentTerms"
                name="paymentTerms"
                defaultValue={company.paymentTerms}
                placeholder="Paiement a 30 jours. Tout retard entraine des penalites."
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card
        title="Documents"
        description="Prefixes de numerotation et apparence de vos factures, devis et recus."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Prefixe facture" htmlFor="invoicePrefix" required error={api.fieldErrors.invoicePrefix}>
            <Input id="invoicePrefix" name="invoicePrefix" defaultValue={company.invoicePrefix} required />
          </Field>
          <Field label="Prefixe devis" htmlFor="quotePrefix" required error={api.fieldErrors.quotePrefix}>
            <Input id="quotePrefix" name="quotePrefix" defaultValue={company.quotePrefix} required />
          </Field>
          <Field label="Prefixe vente" htmlFor="salePrefix" required error={api.fieldErrors.salePrefix}>
            <Input id="salePrefix" name="salePrefix" defaultValue={company.salePrefix} required />
          </Field>
          <Field label="Prefixe achat" htmlFor="purchasePrefix" required error={api.fieldErrors.purchasePrefix}>
            <Input id="purchasePrefix" name="purchasePrefix" defaultValue={company.purchasePrefix} required />
          </Field>
        </div>

        <p className="mt-2 text-xs text-ink-500">
          Vos factures seront numerotees sous la forme{' '}
          <span className="font-mono font-semibold text-ink-700">
            {company.invoicePrefix}-{new Date().getFullYear()}-00001
          </span>
          .
        </p>

        <div className="mt-5 border-t border-ink-200 pt-5">
          <Field label="Logo" htmlFor="logo-file" error={api.fieldErrors.logoUrl}>
            <LogoPicker name="logoUrl" defaultValue={company.logoUrl} />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Format d'impression"
            htmlFor="documentFormat"
            required
            error={api.fieldErrors.documentFormat}
            hint="Format propose par defaut. Il reste modifiable au moment d'imprimer."
          >
            <Select
              id="documentFormat"
              name="documentFormat"
              defaultValue={company.documentFormat}
              className="max-w-sm"
            >
              {DOCUMENT_FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label} — {format.hint}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Couleur principale"
            htmlFor="primaryColor"
            required
            error={api.fieldErrors.primaryColor}
            hint="Utilisee sur l'en-tete de vos documents imprimes."
          >
            <Input
              id="primaryColor"
              name="primaryColor"
              type="color"
              defaultValue={company.primaryColor}
              className="h-11 w-24 p-1"
              required
            />
          </Field>
          <Field label="Pied de page des documents" htmlFor="documentFooter" error={api.fieldErrors.documentFooter}>
            <Textarea
              id="documentFooter"
              name="documentFooter"
              defaultValue={company.documentFooter}
              placeholder="Merci de votre confiance."
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={api.pending}>
          {api.pending ? 'Enregistrement...' : 'Enregistrer les modifications'}
        </Button>
      </div>
    </form>
  );
}
