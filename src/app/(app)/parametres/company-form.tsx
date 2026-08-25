'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';
import { COUNTRIES } from '@/lib/countries';

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
      successMessage: 'Paramètres enregistrés.',
    });
    if (result) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      <Card title="Identité" description="Le nom affiché en tête de vos documents.">
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
            hint="NIF, RCCM, numéro de TVA — selon votre pays."
          >
            <Input id="taxNumber" name="taxNumber" defaultValue={company.taxNumber} />
          </Field>
          <Field label="Site web" htmlFor="website" error={api.fieldErrors.website}>
            <Input id="website" name="website" defaultValue={company.website} placeholder="https://" />
          </Field>
        </div>
      </Card>

      <Card title="Coordonnées">
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
          <Field label="Téléphone" htmlFor="phone" error={api.fieldErrors.phone}>
            <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={company.phone} />
          </Field>
          <Field label="Email" htmlFor="email" error={api.fieldErrors.email}>
            <Input id="email" name="email" type="email" inputMode="email" defaultValue={company.email} />
          </Field>
        </div>
      </Card>

      <Card
        title="Devise et conditions de paiement"
        description="La devise détermine la précision des montants dans toute l'application."
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
                  : `Les montants sont saisis avec ${selectedCurrency.decimals} décimales.`
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
            label="Délai de paiement par défaut"
            htmlFor="defaultDueDays"
            required
            error={api.fieldErrors.defaultDueDays}
            hint="Nombre de jours entre l'émission d'une facture et son échéance."
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
                placeholder="Paiement à 30 jours. Tout retard entraîne des pénalités."
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card
        title="Documents"
        description="Préfixes de numérotation et apparence de vos factures, devis et reçus."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Préfixe facture" htmlFor="invoicePrefix" required error={api.fieldErrors.invoicePrefix}>
            <Input id="invoicePrefix" name="invoicePrefix" defaultValue={company.invoicePrefix} required />
          </Field>
          <Field label="Préfixe devis" htmlFor="quotePrefix" required error={api.fieldErrors.quotePrefix}>
            <Input id="quotePrefix" name="quotePrefix" defaultValue={company.quotePrefix} required />
          </Field>
          <Field label="Préfixe vente" htmlFor="salePrefix" required error={api.fieldErrors.salePrefix}>
            <Input id="salePrefix" name="salePrefix" defaultValue={company.salePrefix} required />
          </Field>
          <Field label="Préfixe achat" htmlFor="purchasePrefix" required error={api.fieldErrors.purchasePrefix}>
            <Input id="purchasePrefix" name="purchasePrefix" defaultValue={company.purchasePrefix} required />
          </Field>
        </div>

        <p className="mt-2 text-xs text-ink-500">
          Vos factures seront numérotées sous la forme{' '}
          <span className="font-mono font-semibold text-ink-700">
            {company.invoicePrefix}-{new Date().getFullYear()}-00001
          </span>
          .
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Couleur principale"
            htmlFor="primaryColor"
            required
            error={api.fieldErrors.primaryColor}
            hint="Utilisée sur l'en-tête de vos documents imprimés."
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
