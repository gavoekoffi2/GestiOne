'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { MoneyInput } from '@/components/ui/money-input';
import { useApi } from '@/components/ui/use-api';
import { computeTotals, type LineInput } from '@/lib/totals';
import { formatMoney, parseAmount, type CurrencyFormat } from '@/lib/money';
import { parseQuantity } from '@/lib/quantity';

export interface PurchaseOption {
  id: string;
  label: string;
}

export interface PurchaseProduct extends PurchaseOption {
  unitCost: string;
}

interface DraftLine {
  productId: string;
  description: string;
  quantityText: string;
  unitCostText: string;
  taxRateId: string;
}

const EMPTY_LINE: DraftLine = {
  productId: '',
  description: '',
  quantityText: '1',
  unitCostText: '',
  taxRateId: '',
};

function safeQuantity(text: string): bigint {
  try {
    const value = parseQuantity(text || '0');
    return value > 0n ? value : 0n;
  } catch {
    return 0n;
  }
}

export function PurchaseBuilder({
  products,
  suppliers,
  locations,
  taxRates,
  defaultLocationId,
  currency,
  locale,
  canReceive,
}: {
  products: PurchaseProduct[];
  suppliers: PurchaseOption[];
  locations: PurchaseOption[];
  taxRates: Array<PurchaseOption & { rate: number }>;
  defaultLocationId: string;
  currency: CurrencyFormat;
  locale: string;
  canReceive: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [reference, setReference] = useState('');
  const [mode, setMode] = useState<'draft' | 'order' | 'receive'>(canReceive ? 'receive' : 'order');

  const totals = useMemo(() => {
    const input: LineInput[] = lines.map((line) => {
      let unitPrice = 0n;
      try {
        unitPrice = parseAmount(line.unitCostText || '0', currency.decimals);
      } catch {
        unitPrice = 0n;
      }
      return {
        quantity: safeQuantity(line.quantityText),
        unitPrice,
        taxRate: taxRates.find((tax) => tax.id === line.taxRateId)?.rate ?? 0,
      };
    });

    try {
      return computeTotals(input);
    } catch {
      return null;
    }
  }, [lines, taxRates, currency.decimals]);

  function update(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function selectProduct(index: number, productId: string) {
    const product = products.find((entry) => entry.id === productId);
    update(index, {
      productId,
      description: product?.label ?? '',
      unitCostText: product?.unitCost ?? '',
    });
  }

  async function submit() {
    const result = await api.send<{ id: string }>('/api/purchases', {
      method: 'POST',
      body: {
        supplierId: supplierId || undefined,
        locationId: locationId || undefined,
        reference: reference || undefined,
        order: mode === 'order',
        receiveNow: mode === 'receive',
        lines: lines
          .filter((line) => safeQuantity(line.quantityText) > 0n)
          .map((line) => ({
            productId: line.productId || undefined,
            description: line.description || undefined,
            quantity: line.quantityText,
            unitCost: line.unitCostText || undefined,
            taxRateId: line.taxRateId || undefined,
          })),
      },
    });
    if (result) router.push(`/achats/${result.id}`);
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}

      <Card title="Fournisseur">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fournisseur" htmlFor="supplierId" error={api.fieldErrors.supplierId}>
            <Select
              id="supplierId"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">Non precise</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.label}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Point de vente"
            htmlFor="locationId"
            error={api.fieldErrors.locationId}
            hint="La marchandise receptionnee y entrera en stock."
          >
            <Select
              id="locationId"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" htmlFor="reference" error={api.fieldErrors.reference}>
            <Input
              id="reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Bon de livraison n°"
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Lignes"
        action={
          <Button
            type="button"
            variant="secondary"
            className="min-h-9 text-xs"
            onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}
          >
            Ajouter une ligne
          </Button>
        }
      >
        <ul className="space-y-4">
          {lines.map((line, index) => (
            <li key={index} className="rounded-lg border border-ink-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Article" htmlFor={`p-line-product-${index}`}>
                    <Select
                      id={`p-line-product-${index}`}
                      value={line.productId}
                      onChange={(event) => selectProduct(index, event.target.value)}
                    >
                      <option value="">Ligne libre</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{product.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Designation" htmlFor={`p-line-desc-${index}`}>
                    <Input
                      id={`p-line-desc-${index}`}
                      value={line.description}
                      onChange={(event) => update(index, { description: event.target.value })}
                    />
                  </Field>
                  <Field label="Quantite" htmlFor={`p-line-qty-${index}`}>
                    <Input
                      id={`p-line-qty-${index}`}
                      value={line.quantityText}
                      onChange={(event) => update(index, { quantityText: event.target.value })}
                      inputMode="decimal"
                      className="text-right tabular"
                    />
                  </Field>
                  <Field
                    label="Cout unitaire"
                    htmlFor={`p-line-cost-${index}`}
                    hint="Le prix reellement negocie pour ce lot."
                  >
                    <MoneyInput
                      id={`p-line-cost-${index}`}
                      value={line.unitCostText}
                      onChange={(event) => update(index, { unitCostText: event.target.value })}
                      decimals={currency.decimals}
                      symbol={currency.symbol}
                    />
                  </Field>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <span className="tabular font-semibold text-ink-900">
                    {formatMoney(totals?.lines[index]?.total ?? 0n, currency, locale)}
                  </span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                      className="grid size-9 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Retirer la ligne ${index + 1}`}
                    >
                      <Icon name="close" className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Total">
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink-700">Que voulez-vous faire ?</legend>
            {[
              {
                value: 'receive' as const,
                label: 'Achat direct',
                hint: 'La marchandise est deja arrivee : elle entre en stock immediatement.',
                disabled: !canReceive,
              },
              {
                value: 'order' as const,
                label: 'Passer commande',
                hint: 'La dette est enregistree ; vous receptionnerez a la livraison.',
                disabled: false,
              },
              {
                value: 'draft' as const,
                label: 'Garder en brouillon',
                hint: "N'engage rien : ni dette, ni stock.",
                disabled: false,
              },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-2 text-sm ${
                  option.disabled ? 'text-ink-400' : 'text-ink-700'
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={option.value}
                  checked={mode === option.value}
                  disabled={option.disabled}
                  onChange={() => setMode(option.value)}
                  className="mt-1 size-4"
                />
                <span>
                  {option.label}
                  <span className="block text-xs text-ink-500">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <dl className="space-y-1 rounded-lg bg-ink-50 p-3 text-sm">
            <Row label="Sous-total" value={formatMoney(totals?.subtotal ?? 0n, currency, locale)} />
            {(totals?.taxTotal ?? 0n) > 0n && (
              <Row label="Taxes" value={formatMoney(totals!.taxTotal, currency, locale)} />
            )}
            <div className="border-t border-ink-200 pt-1">
              <Row label="Total" value={formatMoney(totals?.total ?? 0n, currency, locale)} strong />
            </div>
          </dl>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={submit} disabled={api.pending}>
            {api.pending ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Annuler
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold text-ink-900' : 'text-ink-600'}>{label}</dt>
      <dd className={`tabular ${strong ? 'text-lg font-bold text-ink-900' : 'text-ink-800'}`}>
        {value}
      </dd>
    </div>
  );
}
