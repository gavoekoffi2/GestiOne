'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';

export interface MethodRow {
  id: string;
  name: string;
  kind: string;
  isSystem: boolean;
  isActive: boolean;
  affectsCash: boolean;
  requiresReference: boolean;
  isCredit: boolean;
}

export interface TaxRow {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
  isActive: boolean;
}

const KINDS = [
  { value: 'CASH', label: 'Especes' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  { value: 'BANK_TRANSFER', label: 'Virement' },
  { value: 'CARD', label: 'Carte' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Autre' },
];

export function CommerceSettings({
  methods,
  taxRates,
  canWrite,
}: {
  methods: MethodRow[];
  taxRates: TaxRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [method, setMethod] = useState<MethodRow | 'new' | null>(null);
  const [tax, setTax] = useState<TaxRow | 'new' | null>(null);

  async function submitMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!method) return;
    const form = new FormData(event.currentTarget);
    const isNew = method === 'new';

    const result = await api.send(
      isNew ? '/api/payment-methods' : `/api/payment-methods/${method.id}`,
      {
        method: isNew ? 'POST' : 'PUT',
        body: {
          name: String(form.get('name') ?? ''),
          kind: String(form.get('kind') ?? 'OTHER'),
          affectsCash: form.get('affectsCash') === 'on',
          requiresReference: form.get('requiresReference') === 'on',
          isActive: form.get('isActive') === 'on',
        },
        successMessage: isNew ? 'Mode de reglement cree.' : 'Mode de reglement modifie.',
      },
    );
    if (result) {
      setMethod(null);
      router.refresh();
    }
  }

  async function submitTax(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tax) return;
    const form = new FormData(event.currentTarget);
    const isNew = tax === 'new';

    const result = await api.send(isNew ? '/api/tax-rates' : `/api/tax-rates/${tax.id}`, {
      method: isNew ? 'POST' : 'PUT',
      body: {
        name: String(form.get('name') ?? ''),
        rate: String(form.get('rate') ?? '0'),
        isDefault: form.get('isDefault') === 'on',
        isActive: form.get('isActive') === 'on',
      },
      successMessage: isNew ? 'Taux cree.' : 'Taux modifie.',
    });
    if (result) {
      setTax(null);
      router.refresh();
    }
  }

  async function remove(kind: 'payment-methods' | 'tax-rates', id: string, label: string) {
    if (!window.confirm(`Supprimer "${label}" ?`)) return;
    const result = await api.send(`/api/${kind}/${id}`, {
      method: 'DELETE',
      successMessage: 'Suppression effectuee.',
    });
    if (result) router.refresh();
  }

  return (
    <div className="space-y-5">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      <Card
        title="Modes de reglement"
        description="Ce que vos clients peuvent utiliser pour payer, et ce que vous utilisez pour regler vos fournisseurs."
        action={
          canWrite && !method ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-9 text-xs"
              onClick={() => { api.reset(); setMethod('new'); }}
            >
              Ajouter
            </Button>
          ) : undefined
        }
      >
        {method && (
          <form onSubmit={submitMethod} className="mb-5 space-y-4 rounded-lg bg-ink-50 p-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="method-name" required error={api.fieldErrors.name}>
                <Input
                  id="method-name"
                  name="name"
                  defaultValue={method === 'new' ? '' : method.name}
                  required
                  placeholder="Wave, Orange Money..."
                />
              </Field>
              <Field
                label="Type"
                htmlFor="method-kind"
                error={api.fieldErrors.kind}
                hint={
                  method !== 'new' && method.isSystem
                    ? "Le type d'un mode fourni n'est pas modifiable : il conditionne le comportement de la caisse."
                    : undefined
                }
              >
                <Select
                  id="method-kind"
                  name="kind"
                  defaultValue={method === 'new' ? 'OTHER' : method.kind}
                  disabled={method !== 'new' && method.isSystem}
                >
                  {KINDS.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="affectsCash"
                  defaultChecked={method === 'new' ? false : method.affectsCash}
                  disabled={method !== 'new' && method.isSystem}
                  className="mt-0.5 size-4 rounded border-ink-300"
                />
                <span>
                  Alimente la caisse
                  <span className="block text-xs text-ink-500">
                    A cocher uniquement si l&apos;argent finit physiquement dans le tiroir.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="requiresReference"
                  defaultChecked={method === 'new' ? false : method.requiresReference}
                  className="mt-0.5 size-4 rounded border-ink-300"
                />
                <span>
                  Exige une reference
                  <span className="block text-xs text-ink-500">
                    Numero de transaction, de cheque ou de bordereau.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={method === 'new' ? true : method.isActive}
                  className="size-4 rounded border-ink-300"
                />
                Actif
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setMethod(null); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        )}

        <ul className="divide-y divide-ink-100">
          {methods.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">{row.name}</p>
                <p className="text-xs text-ink-500">
                  {row.isCredit
                    ? "Ne solde pas la facture : constate une creance"
                    : row.affectsCash
                      ? 'Alimente la caisse'
                      : 'N’alimente pas la caisse'}
                  {row.requiresReference && ' · reference exigee'}
                </p>
              </div>
              {row.isSystem && <Badge tone="info">Fourni</Badge>}
              {!row.isActive && <Badge tone="neutral">Inactif</Badge>}
              {canWrite && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 px-2 text-xs"
                  onClick={() => { api.reset(); setMethod(row); }}
                >
                  Modifier
                </Button>
              )}
              {canWrite && !row.isSystem && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 px-2 text-xs text-red-600"
                  onClick={() => remove('payment-methods', row.id, row.name)}
                  disabled={api.pending}
                >
                  Supprimer
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Taux de taxe"
        description="TVA ou equivalent, applicable ligne par ligne sur vos devis et factures."
        action={
          canWrite && !tax ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-9 text-xs"
              onClick={() => { api.reset(); setTax('new'); }}
            >
              Ajouter
            </Button>
          ) : undefined
        }
      >
        {tax && (
          <form onSubmit={submitTax} className="mb-5 space-y-4 rounded-lg bg-ink-50 p-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="tax-name" required error={api.fieldErrors.name}>
                <Input
                  id="tax-name"
                  name="name"
                  defaultValue={tax === 'new' ? '' : tax.name}
                  required
                  placeholder="TVA 18 %"
                />
              </Field>
              <Field label="Taux (%)" htmlFor="tax-rate" required error={api.fieldErrors.rate}>
                <Input
                  id="tax-rate"
                  name="rate"
                  inputMode="decimal"
                  defaultValue={tax === 'new' ? '' : (tax.rate / 100).toString().replace('.', ',')}
                  required
                  className="max-w-32 text-right tabular"
                />
              </Field>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="isDefault"
                  defaultChecked={tax === 'new' ? false : tax.isDefault}
                  className="size-4 rounded border-ink-300"
                />
                Taux par defaut
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={tax === 'new' ? true : tax.isActive}
                  className="size-4 rounded border-ink-300"
                />
                Actif
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setTax(null); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        )}

        {taxRates.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-500">
            Aucun taux configure. Si votre activite n&apos;est pas assujettie, il n&apos;y a rien a
            faire.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {taxRates.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{row.name}</p>
                  <p className="tabular text-xs text-ink-500">
                    {(row.rate / 100).toString().replace('.', ',')} %
                  </p>
                </div>
                {row.isDefault && <Badge tone="info">Par defaut</Badge>}
                {!row.isActive && <Badge tone="neutral">Inactif</Badge>}
                {canWrite && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-9 px-2 text-xs"
                      onClick={() => { api.reset(); setTax(row); }}
                    >
                      Modifier
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-9 px-2 text-xs text-red-600"
                      onClick={() => remove('tax-rates', row.id, row.name)}
                      disabled={api.pending}
                    >
                      Supprimer
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
