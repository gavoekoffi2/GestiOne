'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { ListToolbar, Pagination } from '@/components/ui/list-toolbar';
import { useApi } from '@/components/ui/use-api';
import { COUNTRIES } from '@/lib/countries';

/**
 * Ecran de gestion des tiers, partage par les clients et les fournisseurs.
 *
 * Les deux referentiels ont exactement la meme forme : les separer en deux
 * composants presque identiques garantirait qu'ils divergent au premier
 * correctif applique d'un seul cote.
 */

export interface PartnerRow {
  id: string;
  code: string;
  name: string;
  companyName: string;
  phone: string;
  secondPhone: string;
  email: string;
  addressLine: string;
  city: string;
  countryCode: string;
  taxNumber: string;
  creditLimit: string;
  creditLimitLabel: string;
  notes: string;
  isActive: boolean;
}

export interface PartnerManagerProps {
  segment: 'clients' | 'fournisseurs';
  rows: PartnerRow[];
  page: number;
  pageCount: number;
  total: number;
  currency: { symbol: string; decimals: number };
  canWrite: boolean;
  canDelete: boolean;
  labels: {
    singular: string;
    createCta: string;
    emptyTitle: string;
    emptyBody: string;
    creditHint: string;
  };
}

const EMPTY = {
  name: '',
  companyName: '',
  phone: '',
  secondPhone: '',
  email: '',
  addressLine: '',
  city: '',
  countryCode: '',
  taxNumber: '',
  creditLimit: '0',
  notes: '',
  isActive: true,
};

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/**
 * WhatsApp attend un numero international sans "+" ni separateur. Un numero
 * saisi au format local ("07 00 00 00 00") ne peut pas etre converti de facon
 * fiable : le lien n'est propose que lorsque l'indicatif est explicite.
 */
function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

export function PartnerManager(props: PartnerManagerProps) {
  const { segment, rows, currency, labels, canWrite, canDelete } = props;
  const router = useRouter();
  const api = useApi();
  const [editing, setEditing] = useState<PartnerRow | 'new' | null>(null);

  const values =
    editing === 'new' ? { ...EMPTY, id: '', code: '', creditLimitLabel: '' } : editing;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values) return;

    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get('name') ?? ''),
      companyName: String(form.get('companyName') ?? ''),
      phone: String(form.get('phone') ?? ''),
      secondPhone: String(form.get('secondPhone') ?? ''),
      email: String(form.get('email') ?? ''),
      addressLine: String(form.get('addressLine') ?? ''),
      city: String(form.get('city') ?? ''),
      countryCode: String(form.get('countryCode') ?? ''),
      taxNumber: String(form.get('taxNumber') ?? ''),
      creditLimit: String(form.get('creditLimit') ?? '0'),
      notes: String(form.get('notes') ?? ''),
      isActive: form.get('isActive') === 'on',
    };

    const isNew = editing === 'new';
    const result = await api.send(
      isNew ? `/api/partners/${segment}` : `/api/partners/${segment}/${values.id}`,
      {
        method: isNew ? 'POST' : 'PUT',
        body,
        successMessage: isNew ? `${labels.singular} enregistre.` : 'Modifications enregistrees.',
      },
    );

    if (result) {
      setEditing(null);
      router.refresh();
    }
  }

  async function onDelete(row: PartnerRow) {
    const confirmed = window.confirm(
      `Supprimer ${row.name} (${row.code}) ?\n\nS'il est deja lie a des documents, il sera desactive plutot que supprime afin de preserver l'historique.`,
    );
    if (!confirmed) return;

    const result = await api.send(`/api/partners/${segment}/${row.id}`, {
      method: 'DELETE',
      successMessage: 'Suppression effectuee.',
    });
    if (result) router.refresh();
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {values ? (
        <Card title={editing === 'new' ? labels.createCta : `Modifier ${values.name}`}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="name" required error={api.fieldErrors.name}>
                <Input id="name" name="name" defaultValue={values.name} required />
              </Field>
              <Field label="Entreprise" htmlFor="companyName" error={api.fieldErrors.companyName}>
                <Input id="companyName" name="companyName" defaultValue={values.companyName} />
              </Field>
              <Field
                label="Telephone"
                htmlFor="phone"
                error={api.fieldErrors.phone}
                hint="Avec l'indicatif international, pour permettre l'appel et le partage WhatsApp."
              >
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={values.phone}
                  placeholder="+225 07 00 00 00 00"
                />
              </Field>
              <Field label="Second telephone" htmlFor="secondPhone" error={api.fieldErrors.secondPhone}>
                <Input
                  id="secondPhone"
                  name="secondPhone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={values.secondPhone}
                />
              </Field>
              <Field label="Email" htmlFor="email" error={api.fieldErrors.email}>
                <Input id="email" name="email" type="email" inputMode="email" defaultValue={values.email} />
              </Field>
              <Field label="Identifiant fiscal" htmlFor="taxNumber" error={api.fieldErrors.taxNumber}>
                <Input id="taxNumber" name="taxNumber" defaultValue={values.taxNumber} />
              </Field>
              <Field label="Adresse" htmlFor="addressLine" error={api.fieldErrors.addressLine}>
                <Input id="addressLine" name="addressLine" defaultValue={values.addressLine} />
              </Field>
              <Field label="Ville" htmlFor="city" error={api.fieldErrors.city}>
                <Input id="city" name="city" defaultValue={values.city} />
              </Field>
              <Field label="Pays" htmlFor="countryCode" error={api.fieldErrors.countryCode}>
                <Select id="countryCode" name="countryCode" defaultValue={values.countryCode}>
                  <option value="">Non precise</option>
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Plafond d'encours"
                htmlFor="creditLimit"
                error={api.fieldErrors.creditLimit}
                hint={labels.creditHint}
              >
                <MoneyInput
                  id="creditLimit"
                  name="creditLimit"
                  defaultValue={values.creditLimit}
                  decimals={currency.decimals}
                  symbol={currency.symbol}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes" htmlFor="notes" error={api.fieldErrors.notes}>
                  <Textarea id="notes" name="notes" defaultValue={values.notes} />
                </Field>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={values.isActive}
                className="size-4 rounded border-ink-300"
              />
              Actif
            </label>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  api.reset();
                }}
              >
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        canWrite && (
          <Button
            type="button"
            onClick={() => {
              api.reset();
              setEditing('new');
            }}
          >
            {labels.createCta}
          </Button>
        )
      )}

      <ListToolbar placeholder={`Rechercher (nom, code, telephone, email)`} />

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={labels.emptyTitle} description={labels.emptyBody} />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Code</th>
                    <th className="px-4 py-2 font-medium">Nom</th>
                    <th className="px-4 py-2 font-medium">Contact</th>
                    <th className="px-4 py-2 font-medium">Ville</th>
                    <th className="px-4 py-2 text-right font-medium">Plafond d&apos;encours</th>
                    <th className="px-4 py-2 font-medium sm:px-5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((row) => (
                    <tr key={row.id} className={row.isActive ? undefined : 'bg-ink-50/60'}>
                      <td className="px-4 py-3 font-mono text-xs text-ink-600 sm:px-5">{row.code}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/${segment}/${row.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {row.name}
                        </Link>
                        {row.companyName && <p className="text-xs text-ink-500">{row.companyName}</p>}
                        {!row.isActive && (
                          <span className="mt-1 inline-block">
                            <Badge tone="neutral">Inactif</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.phone ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <a href={telHref(row.phone)} className="text-brand-700 hover:underline">
                              {row.phone}
                            </a>
                            {row.phone.trim().startsWith('+') && (
                              <a
                                href={whatsappHref(row.phone)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-emerald-700 hover:underline"
                              >
                                WhatsApp
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                        {row.email && <p className="text-xs text-ink-500">{row.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-ink-600">{row.city || '—'}</td>
                      <td className="tabular px-4 py-3 text-right text-ink-700">
                        {row.creditLimitLabel}
                      </td>
                      <td className="px-4 py-3 text-right sm:px-5">
                        <div className="flex justify-end gap-1">
                          {canWrite && (
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-9 px-2 text-xs"
                              onClick={() => {
                                api.reset();
                                setEditing(row);
                              }}
                            >
                              Modifier
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-9 px-2 text-xs text-red-600"
                              onClick={() => onDelete(row)}
                              disabled={api.pending}
                            >
                              Supprimer
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <Pagination page={props.page} pageCount={props.pageCount} total={props.total} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
