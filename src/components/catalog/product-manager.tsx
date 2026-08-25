'use client';

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
import { PRODUCT_KINDS } from '@/lib/validation/catalog';

export interface ProductRow {
  id: string;
  kind: 'GOOD' | 'SERVICE';
  name: string;
  sku: string;
  barcode: string;
  description: string;
  categoryId: string;
  categoryName: string;
  unitId: string;
  unitSymbol: string;
  supplierId: string;
  supplierName: string;
  costPrice: string;
  salePrice: string;
  wholesalePrice: string;
  wholesaleFrom: string;
  specialPrice: string;
  minStock: string;
  isActive: boolean;
  costPriceLabel: string;
  salePriceLabel: string;
  marginLabel: string | null;
}

export interface Option {
  id: string;
  label: string;
}

const EMPTY = {
  kind: 'GOOD' as const,
  name: '',
  sku: '',
  barcode: '',
  description: '',
  categoryId: '',
  unitId: '',
  supplierId: '',
  costPrice: '0',
  salePrice: '0',
  wholesalePrice: '',
  wholesaleFrom: '',
  specialPrice: '',
  minStock: '0',
  isActive: true,
};

export function ProductManager({
  rows,
  categories,
  units,
  suppliers,
  currency,
  page,
  pageCount,
  total,
  canWrite,
  canDelete,
  canSeeCost,
}: {
  rows: ProductRow[];
  categories: Option[];
  units: Option[];
  suppliers: Option[];
  currency: { symbol: string; decimals: number };
  page: number;
  pageCount: number;
  total: number;
  canWrite: boolean;
  canDelete: boolean;
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null);
  const [kind, setKind] = useState<'GOOD' | 'SERVICE'>('GOOD');

  const values =
    editing === 'new'
      ? { ...EMPTY, id: '', categoryName: '', unitSymbol: '', supplierName: '', costPriceLabel: '', salePriceLabel: '', marginLabel: null }
      : editing;

  function startEdit(target: ProductRow | 'new') {
    api.reset();
    setEditing(target);
    setKind(target === 'new' ? 'GOOD' : target.kind);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values) return;

    const form = new FormData(event.currentTarget);
    const body = {
      kind: String(form.get('kind') ?? 'GOOD'),
      name: String(form.get('name') ?? ''),
      sku: String(form.get('sku') ?? ''),
      barcode: String(form.get('barcode') ?? ''),
      description: String(form.get('description') ?? ''),
      categoryId: String(form.get('categoryId') ?? ''),
      unitId: String(form.get('unitId') ?? ''),
      supplierId: String(form.get('supplierId') ?? ''),
      ...(canSeeCost ? { costPrice: String(form.get('costPrice') ?? '0') } : {}),
      salePrice: String(form.get('salePrice') ?? '0'),
      wholesalePrice: String(form.get('wholesalePrice') ?? ''),
      wholesaleFrom: String(form.get('wholesaleFrom') ?? ''),
      specialPrice: String(form.get('specialPrice') ?? ''),
      minStock: String(form.get('minStock') ?? '0'),
      isActive: form.get('isActive') === 'on',
      initialStock: String(form.get('initialStock') ?? ''),
    };

    const isNew = editing === 'new';
    const result = await api.send(isNew ? '/api/products' : `/api/products/${values.id}`, {
      method: isNew ? 'POST' : 'PUT',
      body,
      successMessage: isNew ? 'Article enregistré.' : 'Modifications enregistrées.',
    });

    if (result) {
      setEditing(null);
      router.refresh();
    }
  }

  async function onDelete(row: ProductRow) {
    const confirmed = window.confirm(
      `Retirer "${row.name}" du catalogue ?\n\nL'article est désactivé, jamais effacé : ses mouvements de stock et ses ventes passées restent consultables.`,
    );
    if (!confirmed) return;

    const result = await api.send(`/api/products/${row.id}`, {
      method: 'DELETE',
      successMessage: 'Article retiré du catalogue.',
    });
    if (result) router.refresh();
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {values ? (
        <Card title={editing === 'new' ? 'Nouvel article' : `Modifier ${values.name}`}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="kind" required error={api.fieldErrors.kind}>
                <Select
                  id="kind"
                  name="kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as 'GOOD' | 'SERVICE')}
                >
                  {PRODUCT_KINDS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nom" htmlFor="name" required error={api.fieldErrors.name}>
                <Input id="name" name="name" defaultValue={values.name} required placeholder="Sac de riz 25 kg" />
              </Field>
              <Field
                label="Référence"
                htmlFor="sku"
                error={api.fieldErrors.sku}
                hint="Laissez vide : GestiOne la génère à partir du nom."
              >
                <Input id="sku" name="sku" defaultValue={values.sku} />
              </Field>
              <Field
                label="Code-barres"
                htmlFor="barcode"
                error={api.fieldErrors.barcode}
                hint="Scannez-le directement dans ce champ."
              >
                <Input id="barcode" name="barcode" inputMode="numeric" defaultValue={values.barcode} />
              </Field>
              <Field label="Catégorie" htmlFor="categoryId" error={api.fieldErrors.categoryId}>
                <Select id="categoryId" name="categoryId" defaultValue={values.categoryId}>
                  <option value="">Sans catégorie</option>
                  {categories.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Unité de mesure"
                htmlFor="unitId"
                error={api.fieldErrors.unitId}
                hint="Carton, sac, kilogramme, litre... Créez les vôtres depuis l'onglet Unités."
              >
                <Select id="unitId" name="unitId" defaultValue={values.unitId}>
                  <option value="">Non précisée</option>
                  {units.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Fournisseur principal" htmlFor="supplierId" error={api.fieldErrors.supplierId}>
                <Select id="supplierId" name="supplierId" defaultValue={values.supplierId}>
                  <option value="">Aucun</option>
                  {suppliers.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description" htmlFor="description" error={api.fieldErrors.description}>
                  <Textarea id="description" name="description" defaultValue={values.description} />
                </Field>
              </div>
            </div>

            <fieldset className="rounded-lg border border-ink-200 p-4">
              <legend className="px-1 text-sm font-semibold text-ink-800">Prix</legend>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Sans le droit de voir les prix d'achat, le champ n'est ni affiche
                    ni soumis : le prix enregistre reste celui de la base. */}
                {canSeeCost && (
                  <Field label="Prix d'achat" htmlFor="costPrice" required error={api.fieldErrors.costPrice}>
                    <MoneyInput
                      id="costPrice"
                      name="costPrice"
                      defaultValue={values.costPrice}
                      decimals={currency.decimals}
                      symbol={currency.symbol}
                    />
                  </Field>
                )}
                <Field label="Prix de vente" htmlFor="salePrice" required error={api.fieldErrors.salePrice}>
                  <MoneyInput
                    id="salePrice"
                    name="salePrice"
                    defaultValue={values.salePrice}
                    decimals={currency.decimals}
                    symbol={currency.symbol}
                  />
                </Field>
                <Field
                  label="Prix spécial"
                  htmlFor="specialPrice"
                  error={api.fieldErrors.specialPrice}
                  hint="Tarif négocié, appliqué manuellement à la vente."
                >
                  <MoneyInput
                    id="specialPrice"
                    name="specialPrice"
                    defaultValue={values.specialPrice}
                    decimals={currency.decimals}
                    symbol={currency.symbol}
                  />
                </Field>
                <Field label="Prix grossiste" htmlFor="wholesalePrice" error={api.fieldErrors.wholesalePrice}>
                  <MoneyInput
                    id="wholesalePrice"
                    name="wholesalePrice"
                    defaultValue={values.wholesalePrice}
                    decimals={currency.decimals}
                    symbol={currency.symbol}
                  />
                </Field>
                <Field
                  label="À partir de"
                  htmlFor="wholesaleFrom"
                  error={api.fieldErrors.wholesaleFrom}
                  hint="Quantité à partir de laquelle le prix grossiste s'applique."
                >
                  <Input
                    id="wholesaleFrom"
                    name="wholesaleFrom"
                    inputMode="decimal"
                    defaultValue={values.wholesaleFrom}
                    className="text-right tabular"
                  />
                </Field>
              </div>
            </fieldset>

            {/*
              Un service ne se stocke pas : afficher un seuil de rupture pour une
              prestation n'aurait aucun sens et inviterait a saisir une valeur
              qui ne serait jamais utilisee.
            */}
            {kind === 'GOOD' && (
              <div className="grid gap-4 sm:grid-cols-2">
                {/*
                  Sans stock, GestiOne refuse la vente. Saisir la quantite ici
                  evite d'enchainer creation de l'article puis entree de stock
                  pour pouvoir vendre — l'obstacle numero un d'un premier jour.
                */}
                {editing === 'new' && (
                  <Field
                    label="Stock actuel en boutique"
                    htmlFor="initialStock"
                    error={api.fieldErrors.initialStock}
                    hint="Enregistré comme une entrée de stock. Laissez 0 si vous n'en avez pas encore."
                  >
                    <Input
                      id="initialStock"
                      name="initialStock"
                      inputMode="decimal"
                      defaultValue="0"
                      className="max-w-40 text-right tabular"
                    />
                  </Field>
                )}

                <Field
                  label="Stock minimum (alerte de rupture)"
                  htmlFor="minStock"
                  error={api.fieldErrors.minStock}
                  hint="GestiOne vous alertera lorsque le stock passera sous ce seuil."
                >
                  <Input
                    id="minStock"
                    name="minStock"
                    inputMode="decimal"
                    defaultValue={values.minStock}
                    className="max-w-40 text-right tabular"
                  />
                </Field>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={values.isActive}
                className="size-4 rounded border-ink-300"
              />
              Article actif (disponible à la vente)
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
          <Button type="button" onClick={() => startEdit('new')}>
            Ajouter un article
          </Button>
        )
      )}

      <ListToolbar
        placeholder="Rechercher (nom, référence, code-barres)"
        filters={[
          {
            name: 'kind',
            label: 'Tous les types',
            options: PRODUCT_KINDS.map((entry) => ({ value: entry.value, label: entry.label })),
          },
          {
            name: 'categoryId',
            label: 'Toutes les catégories',
            options: categories.map((option) => ({ value: option.id, label: option.label })),
          },
        ]}
        showInactive
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Aucun article"
            description="Ajoutez vos produits et services pour pouvoir les vendre, les facturer et suivre leur stock."
            action={
              canWrite ? (
                <Button type="button" onClick={() => startEdit('new')}>
                  Ajouter un article
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Article</th>
                    <th className="px-4 py-2 font-medium">Catégorie</th>
                    <th className="px-4 py-2 font-medium">Unité</th>
                    {canSeeCost && <th className="px-4 py-2 text-right font-medium">Prix d&apos;achat</th>}
                    <th className="px-4 py-2 text-right font-medium">Prix de vente</th>
                    {canSeeCost && <th className="px-4 py-2 text-right font-medium">Marge</th>}
                    <th className="px-4 py-2 font-medium sm:px-5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((row) => (
                    <tr key={row.id} className={row.isActive ? undefined : 'bg-ink-50/60'}>
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-ink-900">{row.name}</p>
                          {row.kind === 'SERVICE' && <Badge tone="info">Service</Badge>}
                          {!row.isActive && <Badge tone="neutral">Inactif</Badge>}
                        </div>
                        <p className="font-mono text-xs text-ink-500">{row.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-600">{row.categoryName || '—'}</td>
                      <td className="px-4 py-3 text-ink-600">{row.unitSymbol || '—'}</td>
                      {canSeeCost && (
                        <td className="tabular px-4 py-3 text-right text-ink-600">{row.costPriceLabel}</td>
                      )}
                      <td className="tabular px-4 py-3 text-right font-medium text-ink-900">
                        {row.salePriceLabel}
                      </td>
                      {canSeeCost && (
                        <td className="tabular px-4 py-3 text-right text-ink-600">
                          {row.marginLabel ?? '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right sm:px-5">
                        <div className="flex justify-end gap-1">
                          {canWrite && (
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-9 px-2 text-xs"
                              onClick={() => startEdit(row)}
                            >
                              Modifier
                            </Button>
                          )}
                          {canDelete && row.isActive && (
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-9 px-2 text-xs text-red-600"
                              onClick={() => onDelete(row)}
                              disabled={api.pending}
                            >
                              Retirer
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
              <Pagination page={page} pageCount={pageCount} total={total} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
