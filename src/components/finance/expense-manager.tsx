'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, EmptyState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { ListToolbar, Pagination } from '@/components/ui/list-toolbar';
import { useApi } from '@/components/ui/use-api';

export interface ExpenseRow {
  id: string;
  number: string;
  date: string;
  description: string;
  categoryName: string;
  locationName: string;
  methodName: string;
  reference: string;
  amountLabel: string;
  userName: string;
}

export interface FinanceOption {
  id: string;
  label: string;
}

export function ExpenseManager({
  rows,
  categories,
  locations,
  methods,
  suppliers,
  defaultLocationId,
  currency,
  page,
  pageCount,
  total,
  canWrite,
  canDelete,
}: {
  rows: ExpenseRow[];
  categories: FinanceOption[];
  locations: FinanceOption[];
  methods: FinanceOption[];
  suppliers: FinanceOption[];
  defaultLocationId: string;
  currency: { symbol: string; decimals: number };
  page: number;
  pageCount: number;
  total: number;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [open, setOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send('/api/expenses', {
      method: 'POST',
      body: {
        categoryId: String(form.get('categoryId') ?? ''),
        locationId: String(form.get('locationId') ?? ''),
        supplierId: String(form.get('supplierId') ?? ''),
        methodId: String(form.get('methodId') ?? ''),
        amount: String(form.get('amount') ?? ''),
        spentAt: String(form.get('spentAt') ?? ''),
        description: String(form.get('description') ?? ''),
        reference: String(form.get('reference') ?? ''),
        notes: String(form.get('notes') ?? ''),
      },
      successMessage: 'Depense enregistree.',
    });
    if (result) {
      setOpen(false);
      router.refresh();
    }
  }

  async function remove(row: ExpenseRow) {
    const reason = window.prompt(
      `Supprimer la depense ${row.number} (${row.amountLabel}) ?\n\nIndiquez le motif :`,
    );
    if (!reason?.trim()) return;

    const result = await api.send(`/api/expenses/${row.id}`, {
      method: 'DELETE',
      body: { reason },
      successMessage: 'Depense supprimee. La caisse a ete recreditee si necessaire.',
    });
    if (result) router.refresh();
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {open ? (
        <Card title="Nouvelle depense">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Description" htmlFor="description" required error={api.fieldErrors.description}>
                <Input id="description" name="description" required placeholder="Carburant livraison" />
              </Field>
              <Field label="Montant" htmlFor="amount" required error={api.fieldErrors.amount}>
                <MoneyInput
                  id="amount"
                  name="amount"
                  decimals={currency.decimals}
                  symbol={currency.symbol}
                  required
                />
              </Field>
              <Field label="Categorie" htmlFor="categoryId" error={api.fieldErrors.categoryId}>
                <Select id="categoryId" name="categoryId" defaultValue="">
                  <option value="">Sans categorie</option>
                  {categories.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Mode de reglement"
                htmlFor="methodId"
                error={api.fieldErrors.methodId}
                hint="Un reglement en especes sort de la caisse du point de vente choisi."
              >
                <Select id="methodId" name="methodId" defaultValue="">
                  <option value="">Non precise</option>
                  {methods.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Point de vente" htmlFor="locationId" error={api.fieldErrors.locationId}>
                <Select id="locationId" name="locationId" defaultValue={defaultLocationId}>
                  <option value="">Aucun</option>
                  {locations.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" htmlFor="spentAt" error={api.fieldErrors.spentAt}>
                <Input
                  id="spentAt"
                  name="spentAt"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </Field>
              <Field label="Fournisseur" htmlFor="supplierId" error={api.fieldErrors.supplierId}>
                <Select id="supplierId" name="supplierId" defaultValue="">
                  <option value="">Aucun</option>
                  {suppliers.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference" htmlFor="reference" error={api.fieldErrors.reference}>
                <Input id="reference" name="reference" placeholder="N° de recu" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes" htmlFor="notes" error={api.fieldErrors.notes}>
                  <Textarea id="notes" name="notes" className="min-h-16" />
                </Field>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer la depense'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setOpen(false); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        canWrite && (
          <Button type="button" onClick={() => { api.reset(); setOpen(true); }}>
            Enregistrer une depense
          </Button>
        )
      )}

      <ListToolbar
        placeholder="Rechercher (numero, description, reference)"
        filters={[
          {
            name: 'categoryId',
            label: 'Toutes les categories',
            options: categories.map((option) => ({ value: option.id, label: option.label })),
          },
        ]}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Aucune depense"
            description="Enregistrez vos charges — loyer, transport, salaires — pour connaitre votre resultat reel."
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Numero</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Description</th>
                    <th className="px-4 py-2 font-medium">Categorie</th>
                    <th className="px-4 py-2 font-medium">Reglement</th>
                    <th className="px-4 py-2 text-right font-medium">Montant</th>
                    <th className="px-4 py-2 font-medium sm:px-5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-mono text-xs text-ink-600 sm:px-5">
                        {row.number}
                        <p className="font-sans text-xs text-ink-400">{row.userName}</p>
                      </td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600">{row.date}</td>
                      <td className="px-4 py-3 text-ink-800">
                        {row.description}
                        {row.reference && <p className="text-xs text-ink-400">{row.reference}</p>}
                      </td>
                      <td className="px-4 py-3 text-ink-600">{row.categoryName || '—'}</td>
                      <td className="px-4 py-3 text-ink-600">
                        {row.methodName || '—'}
                        {row.locationName && <p className="text-xs text-ink-400">{row.locationName}</p>}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-medium text-red-600">
                        - {row.amountLabel}
                      </td>
                      <td className="px-4 py-3 text-right sm:px-5">
                        {canDelete && (
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-9 px-2 text-xs text-red-600"
                            onClick={() => remove(row)}
                            disabled={api.pending}
                          >
                            Supprimer
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <Pagination page={page} pageCount={pageCount} total={total} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
