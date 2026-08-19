'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { Combobox, EMPTY_COMBOBOX, type ComboboxValue } from '@/components/ui/combobox';
import { Icon } from '@/components/layout/icons';
import { MoneyInput } from '@/components/ui/money-input';
import { useApi } from '@/components/ui/use-api';
import { computeTotals, type LineInput } from '@/lib/totals';
import { formatMoney, parseAmount, type CurrencyFormat } from '@/lib/money';
import { parseQuantity } from '@/lib/quantity';

/**
 * Composeur de document, partage par les devis et les factures.
 *
 * Les deux documents ont exactement la meme structure de lignes et de totaux ;
 * seuls le titre, la destination et quelques champs de date changent. Le total
 * est recalcule localement avec la meme fonction que le serveur, de sorte que
 * le montant affiche pendant la saisie soit exactement celui qui sera
 * enregistre.
 */

export interface BuilderOption {
  id: string;
  label: string;
  /** Telephone ou code : distingue deux homonymes dans la liste. */
  hint?: string;
}

export interface BuilderProduct extends BuilderOption {
  unitPrice: string;
  unitPriceMinor: string;
}

interface DraftLine {
  productId: string;
  description: string;
  quantityText: string;
  unitPriceText: string;
  discountText: string;
  taxRateId: string;
}

const EMPTY_LINE: DraftLine = {
  productId: '',
  description: '',
  quantityText: '1',
  unitPriceText: '',
  discountText: '',
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

function safePercent(text: string): number {
  const parsed = Number((text || '0').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return 0;
  return Math.round(parsed * 100);
}

export function DocumentBuilder({
  kind,
  endpoint,
  products,
  customers,
  locations,
  taxRates,
  defaultLocationId,
  defaultCustomerId = '',
  currency,
  locale,
  canDiscount,
  basePath,
}: {
  kind: 'quote' | 'invoice';
  endpoint: string;
  products: BuilderProduct[];
  customers: BuilderOption[];
  locations: BuilderOption[];
  taxRates: Array<BuilderOption & { rate: number }>;
  defaultLocationId: string;
  /** Client preselectionne, lorsqu'on arrive depuis sa fiche. */
  defaultCustomerId?: string;
  currency: CurrencyFormat;
  locale: string;
  canDiscount: boolean;
  /** Prefixe de l'URL de destination : le document cree y est ajoute en segment. */
  basePath: string;
}) {
  const router = useRouter();
  const api = useApi();
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [customer, setCustomer] = useState<ComboboxValue>(() => {
    const option = customers.find((entry) => entry.id === defaultCustomerId);
    return option ? { id: option.id, name: option.label } : EMPTY_COMBOBOX;
  });
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [globalDiscount, setGlobalDiscount] = useState('');
  const [issueNow, setIssueNow] = useState(kind === 'invoice');

  const totals = useMemo(() => {
    const input: LineInput[] = lines.map((line) => {
      let unitPrice = 0n;
      try {
        unitPrice = parseAmount(line.unitPriceText || '0', currency.decimals);
      } catch {
        unitPrice = 0n;
      }
      return {
        quantity: safeQuantity(line.quantityText),
        unitPrice,
        discountRate: safePercent(line.discountText),
        taxRate: taxRates.find((tax) => tax.id === line.taxRateId)?.rate ?? 0,
      };
    });

    try {
      return computeTotals(input, { rate: safePercent(globalDiscount) || undefined });
    } catch {
      return null;
    }
  }, [lines, globalDiscount, taxRates, currency.decimals]);

  function update(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function selectProduct(index: number, productId: string) {
    const product = products.find((entry) => entry.id === productId);
    update(index, {
      productId,
      description: product?.label ?? '',
      unitPriceText: product?.unitPrice ?? '',
    });
  }

  async function submit() {
    const payload: Record<string, unknown> = {
      customerId: customer.id || undefined,
      customerName: customer.id ? undefined : customer.name.trim() || undefined,
      locationId: locationId || undefined,
      discountRate: globalDiscount || undefined,
      lines: lines
        .filter((line) => safeQuantity(line.quantityText) > 0n)
        .map((line) => ({
          productId: line.productId || undefined,
          description: line.description || undefined,
          quantity: line.quantityText,
          unitPrice: line.unitPriceText || undefined,
          discountRate: line.discountText || undefined,
          taxRateId: line.taxRateId || undefined,
        })),
    };
    if (kind === 'invoice') payload.issue = issueNow;

    const result = await api.send<{ id: string }>(endpoint, { method: 'POST', body: payload });
    if (result) router.push(`${basePath}/${result.id}`);
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}

      <Card title="Destinataire">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Client"
            htmlFor="doc-customer"
            error={api.fieldErrors.customerId ?? api.fieldErrors.customerName}
            hint="Tapez le nom : la fiche est creee si elle n existe pas encore."
          >
            <Combobox
              id="doc-customer"
              options={customers}
              value={customer}
              onChange={setCustomer}
              placeholder="Nom du client"
              createLabel={(typed) => `Nouveau client : ${typed}`}
            />
          </Field>

          {locations.length > 0 && (
            <Field
              label="Point de vente"
              htmlFor="doc-location"
              error={api.fieldErrors.locationId}
              hint={
                kind === 'invoice'
                  ? "Le stock des articles suivis sortira de ce point de vente a l'emission."
                  : undefined
              }
            >
              <Select
                id="doc-location"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
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
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Article" htmlFor={`line-product-${index}`}>
                      <Select
                        id={`line-product-${index}`}
                        value={line.productId}
                        onChange={(event) => selectProduct(index, event.target.value)}
                      >
                        <option value="">Ligne libre</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Designation" htmlFor={`line-desc-${index}`}>
                      <Input
                        id={`line-desc-${index}`}
                        value={line.description}
                        onChange={(event) => update(index, { description: event.target.value })}
                        placeholder="Prestation, article..."
                      />
                    </Field>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Quantite" htmlFor={`line-qty-${index}`}>
                      <Input
                        id={`line-qty-${index}`}
                        value={line.quantityText}
                        onChange={(event) => update(index, { quantityText: event.target.value })}
                        inputMode="decimal"
                        className="text-right tabular"
                      />
                    </Field>
                    <Field label="Prix unitaire" htmlFor={`line-price-${index}`}>
                      <MoneyInput
                        id={`line-price-${index}`}
                        value={line.unitPriceText}
                        onChange={(event) => update(index, { unitPriceText: event.target.value })}
                        decimals={currency.decimals}
                        symbol={currency.symbol}
                      />
                    </Field>
                    {canDiscount && (
                      <Field label="Remise %" htmlFor={`line-disc-${index}`}>
                        <Input
                          id={`line-disc-${index}`}
                          value={line.discountText}
                          onChange={(event) => update(index, { discountText: event.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className="text-right tabular"
                        />
                      </Field>
                    )}
                    {taxRates.length > 0 && (
                      <Field label="Taxe" htmlFor={`line-tax-${index}`}>
                        <Select
                          id={`line-tax-${index}`}
                          value={line.taxRateId}
                          onChange={(event) => update(index, { taxRateId: event.target.value })}
                        >
                          <option value="">Aucune</option>
                          {taxRates.map((tax) => (
                            <option key={tax.id} value={tax.id}>
                              {tax.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </div>
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
          <div className="space-y-3">
            {canDiscount && (
              <Field label="Remise globale (%)" htmlFor="doc-discount">
                <Input
                  id="doc-discount"
                  value={globalDiscount}
                  onChange={(event) => setGlobalDiscount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="max-w-32 text-right tabular"
                />
              </Field>
            )}

            {kind === 'invoice' && (
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={issueNow}
                  onChange={(event) => setIssueNow(event.target.checked)}
                  className="mt-0.5 size-4 rounded border-ink-300"
                />
                <span>
                  Emettre immediatement
                  <span className="block text-xs text-ink-500">
                    La facture devient exigible et le stock des articles suivis sort. Sinon elle
                    reste en brouillon, modifiable.
                  </span>
                </span>
              </label>
            )}
          </div>

          <dl className="space-y-1 rounded-lg bg-ink-50 p-3 text-sm">
            <Row label="Sous-total" value={formatMoney(totals?.subtotal ?? 0n, currency, locale)} />
            {(totals?.discountTotal ?? 0n) > 0n && (
              <Row label="Remise" value={`- ${formatMoney(totals!.discountTotal, currency, locale)}`} />
            )}
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
            {api.pending
              ? 'Enregistrement...'
              : kind === 'quote'
                ? 'Creer le devis'
                : issueNow
                  ? 'Creer et emettre la facture'
                  : 'Enregistrer le brouillon'}
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
