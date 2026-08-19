'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { MoneyInput } from '@/components/ui/money-input';
import { useApi } from '@/components/ui/use-api';
import { computeTotals, type LineInput } from '@/lib/totals';
import { formatMoney, parseAmount, type CurrencyFormat } from '@/lib/money';
import { formatQuantity, parseQuantity } from '@/lib/quantity';

/**
 * Ecran de vente au comptoir.
 *
 * Concu pour etre utilisable d'une main sur un telephone, debout derriere un
 * comptoir : recherche immediate (nom, reference, code-barres scanne), panier
 * a grosses zones tactiles, total toujours visible, et un seul bouton pour
 * conclure. Le total est recalcule **localement avec la meme fonction que le
 * serveur** afin que le montant annonce au client soit exactement celui qui
 * sera enregistre — mais c'est le serveur qui fait foi.
 */

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  unitSymbol: string;
  /** Prix formate pour l'affichage, dans la devise de l'entreprise. */
  salePriceLabel: string;
  /** Prix brut reeditable dans le champ de saisie. */
  salePrice: string;
  /** Prix en unite mineure, transmis en chaine (les bigint ne passent pas en JSON). */
  salePriceMinor: string;
  kind: 'GOOD' | 'SERVICE';
  stock: string;
  trackStock: boolean;
}

export interface PosOption {
  id: string;
  label: string;
}

export interface PosMethod extends PosOption {
  isCredit: boolean;
  requiresReference: boolean;
}

interface CartLine {
  productId: string;
  name: string;
  unitSymbol: string;
  unitPriceMinor: bigint;
  unitPriceText: string;
  quantityText: string;
  discountText: string;
  taxRateId: string;
  trackStock: boolean;
  stock: bigint;
}

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

export function PointOfSale({
  products,
  customers,
  methods,
  taxRates,
  locations,
  defaultLocationId,
  currency,
  locale,
  canDiscount,
}: {
  products: PosProduct[];
  customers: PosOption[];
  methods: PosMethod[];
  taxRates: Array<PosOption & { rate: number }>;
  locations: PosOption[];
  defaultLocationId: string;
  currency: CurrencyFormat;
  locale: string;
  canDiscount: boolean;
}) {
  const router = useRouter();
  const api = useApi();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [globalDiscount, setGlobalDiscount] = useState('');
  const [receipt, setReceipt] = useState<null | {
    number: string;
    total: bigint;
    paid: bigint;
    balanceDue: bigint;
    changeDue: bigint;
    invoiceId: string;
  }>(null);

  const method = methods.find((entry) => entry.id === methodId);
  const isCredit = !method || method.isCredit;

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products.slice(0, 12);
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(needle) ||
          product.sku.toLowerCase().includes(needle) ||
          product.barcode === search.trim(),
      )
      .slice(0, 12);
  }, [products, search]);

  const totals = useMemo(() => {
    const lines: LineInput[] = cart.map((line) => ({
      quantity: safeQuantity(line.quantityText),
      unitPrice: line.unitPriceMinor,
      discountRate: safePercent(line.discountText),
      taxRate: taxRates.find((tax) => tax.id === line.taxRateId)?.rate ?? 0,
    }));

    try {
      return computeTotals(lines, { rate: safePercent(globalDiscount) || undefined });
    } catch {
      return null;
    }
  }, [cart, globalDiscount, taxRates]);

  const total = totals?.total ?? 0n;

  function addProduct(product: PosProduct) {
    setSearch('');
    setCart((current) => {
      const existing = current.findIndex((line) => line.productId === product.id);
      if (existing >= 0) {
        const next = [...current];
        const line = next[existing]!;
        next[existing] = {
          ...line,
          quantityText: formatQuantity(safeQuantity(line.quantityText) + 1000n, 'en'),
        };
        return next;
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          unitSymbol: product.unitSymbol,
          unitPriceMinor: BigInt(product.salePriceMinor),
          unitPriceText: product.salePrice,
          quantityText: '1',
          discountText: '',
          taxRateId: taxRates.find((tax) => tax.id)?.id ?? '',
          trackStock: product.trackStock,
          stock: BigInt(product.stock),
        },
      ];
    });
  }

  function updateLine(index: number, patch: Partial<CartLine>) {
    setCart((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setCart((current) => current.filter((_, i) => i !== index));
  }

  function reset() {
    setCart([]);
    setCustomerId('');
    setTendered('');
    setReference('');
    setGlobalDiscount('');
    api.reset();
  }

  async function submit() {
    if (cart.length === 0) return;

    const body: Record<string, unknown> = {
      customerId: customerId || undefined,
      locationId,
      discountRate: globalDiscount || undefined,
      lines: cart.map((line) => ({
        productId: line.productId,
        quantity: line.quantityText,
        unitPrice: line.unitPriceText,
        discountRate: line.discountText || undefined,
        taxRateId: line.taxRateId || undefined,
      })),
      payment: isCredit
        ? undefined
        : { methodId, amount: tendered || undefined, reference: reference || undefined },
    };

    const result = await api.send<{
      invoiceId: string;
      number: string;
      total: string;
      paid: string;
      balanceDue: string;
      changeDue: string;
    }>('/api/sales', { method: 'POST', body });

    if (result) {
      setReceipt({
        invoiceId: result.invoiceId,
        number: result.number,
        total: BigInt(result.total),
        paid: BigInt(result.paid),
        balanceDue: BigInt(result.balanceDue),
        changeDue: BigInt(result.changeDue),
      });
      setCart([]);
      setTendered('');
      setReference('');
      setGlobalDiscount('');
      router.refresh();
    }
  }

  // Alerte de stock : on previent avant l'envoi plutot que de laisser le
  // serveur refuser la vente une fois le client servi.
  const stockWarnings = cart.filter(
    (line) => line.trackStock && safeQuantity(line.quantityText) > line.stock,
  );

  if (receipt) {
    return (
      <Card title={`Vente ${receipt.number} enregistree`}>
        <dl className="space-y-2 text-sm">
          <Row label="Total" value={formatMoney(receipt.total, currency, locale)} strong />
          <Row label="Encaisse" value={formatMoney(receipt.paid, currency, locale)} />
          {receipt.changeDue > 0n && (
            <Row
              label="Monnaie a rendre"
              value={formatMoney(receipt.changeDue, currency, locale)}
              strong
            />
          )}
          {receipt.balanceDue > 0n && (
            <Row
              label="Reste du par le client"
              value={formatMoney(receipt.balanceDue, currency, locale)}
              strong
            />
          )}
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" onClick={() => { setReceipt(null); reset(); }}>
            Nouvelle vente
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push(`/factures/${receipt.invoiceId}`)}
          >
            Voir le recu
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Card title="Articles">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400">
              <Icon name="search" className="size-4" />
            </span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom, reference, ou scannez un code-barres"
              aria-label="Rechercher un article"
              className="pl-9"
              autoFocus
            />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {matches.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                className="flex min-h-16 flex-col justify-center rounded-lg border border-ink-200 px-3 py-2 text-left transition hover:border-brand-500 hover:bg-brand-50"
              >
                <span className="font-medium text-ink-900">{product.name}</span>
                <span className="tabular text-sm text-ink-600">{product.salePriceLabel}</span>
                {product.trackStock && (
                  <span
                    className={
                      BigInt(product.stock) <= 0n
                        ? 'text-xs font-medium text-red-600'
                        : 'text-xs text-ink-400'
                    }
                  >
                    {formatQuantity(BigInt(product.stock), locale)} {product.unitSymbol} en stock
                  </span>
                )}
              </button>
            ))}
            {matches.length === 0 && (
              <p className="col-span-full py-4 text-center text-sm text-ink-500">
                Aucun article ne correspond a &laquo; {search} &raquo;.
              </p>
            )}
          </div>
        </Card>

        <Card title={`Panier (${cart.length})`}>
          {cart.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">
              Choisissez des articles ci-dessus pour composer la vente.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {cart.map((line, index) => {
                const quantity = safeQuantity(line.quantityText);
                const lineTotal = totals?.lines[index]?.total ?? 0n;
                const short = line.trackStock && quantity > line.stock;

                return (
                  <li key={line.productId} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{line.name}</p>
                        {short && (
                          <p className="text-xs font-medium text-red-600">
                            Stock disponible : {formatQuantity(line.stock, locale)} {line.unitSymbol}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular font-semibold text-ink-900">
                          {formatMoney(lineTotal, currency, locale)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="grid size-9 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Retirer ${line.name}`}
                        >
                          <Icon name="close" className="size-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      <label className="text-xs text-ink-500">
                        Quantite
                        <Input
                          value={line.quantityText}
                          onChange={(event) => updateLine(index, { quantityText: event.target.value })}
                          inputMode="decimal"
                          className="mt-0.5 text-right tabular"
                        />
                      </label>
                      <label className="text-xs text-ink-500">
                        Prix unitaire
                        <MoneyInput
                          value={line.unitPriceText}
                          onChange={(event) =>
                            updateLine(index, {
                              unitPriceText: event.target.value,
                              unitPriceMinor: (() => {
                                try {
                                  return parseAmount(event.target.value || '0', currency.decimals);
                                } catch {
                                  return line.unitPriceMinor;
                                }
                              })(),
                            })
                          }
                          decimals={currency.decimals}
                          symbol={currency.symbol}
                          className="mt-0.5"
                        />
                      </label>
                      {canDiscount && (
                        <label className="text-xs text-ink-500">
                          Remise %
                          <Input
                            value={line.discountText}
                            onChange={(event) => updateLine(index, { discountText: event.target.value })}
                            inputMode="decimal"
                            placeholder="0"
                            className="mt-0.5 text-right tabular"
                          />
                        </label>
                      )}
                      {taxRates.length > 0 && (
                        <label className="text-xs text-ink-500">
                          Taxe
                          <Select
                            value={line.taxRateId}
                            onChange={(event) => updateLine(index, { taxRateId: event.target.value })}
                            className="mt-0.5"
                          >
                            <option value="">Aucune</option>
                            {taxRates.map((tax) => (
                              <option key={tax.id} value={tax.id}>
                                {tax.label}
                              </option>
                            ))}
                          </Select>
                        </label>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        {api.error && <Alert tone="error">{api.error}</Alert>}
        {stockWarnings.length > 0 && (
          <Alert tone="warning" title="Stock insuffisant">
            {stockWarnings.map((line) => line.name).join(', ')} : la quantite demandee depasse le
            stock enregistre. La vente sera refusee. Ajustez la quantite ou faites une entree de
            stock.
          </Alert>
        )}

        <Card title="Encaissement">
          <div className="space-y-3">
            {locations.length > 1 && (
              <Field label="Point de vente" htmlFor="pos-location">
                <Select
                  id="pos-location"
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

            <Field
              label="Client"
              htmlFor="pos-customer"
              hint={isCredit ? 'Obligatoire pour une vente a credit.' : 'Facultatif.'}
            >
              <Select
                id="pos-customer"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Client de passage</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.label}
                  </option>
                ))}
              </Select>
            </Field>

            {canDiscount && (
              <Field label="Remise globale (%)" htmlFor="pos-discount">
                <Input
                  id="pos-discount"
                  value={globalDiscount}
                  onChange={(event) => setGlobalDiscount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="text-right tabular"
                />
              </Field>
            )}

            <div className="rounded-lg bg-ink-50 p-3">
              <dl className="space-y-1 text-sm">
                <Row label="Sous-total" value={formatMoney(totals?.subtotal ?? 0n, currency, locale)} />
                {(totals?.discountTotal ?? 0n) > 0n && (
                  <Row
                    label="Remise"
                    value={`- ${formatMoney(totals!.discountTotal, currency, locale)}`}
                  />
                )}
                {(totals?.taxTotal ?? 0n) > 0n && (
                  <Row label="Taxes" value={formatMoney(totals!.taxTotal, currency, locale)} />
                )}
                <div className="border-t border-ink-200 pt-1">
                  <Row label="Total" value={formatMoney(total, currency, locale)} strong />
                </div>
              </dl>
            </div>

            <Field label="Mode de reglement" htmlFor="pos-method">
              <Select
                id="pos-method"
                value={methodId}
                onChange={(event) => setMethodId(event.target.value)}
              >
                {methods.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </Field>

            {!isCredit && (
              <>
                <Field
                  label="Montant recu"
                  htmlFor="pos-tendered"
                  hint="Laissez vide si le client paie exactement le total."
                >
                  <MoneyInput
                    id="pos-tendered"
                    value={tendered}
                    onChange={(event) => setTendered(event.target.value)}
                    decimals={currency.decimals}
                    symbol={currency.symbol}
                  />
                </Field>

                {tendered && (() => {
                  let given = 0n;
                  try {
                    given = parseAmount(tendered, currency.decimals);
                  } catch {
                    return null;
                  }
                  if (given > total) {
                    return (
                      <Alert tone="info">
                        Monnaie a rendre : <strong>{formatMoney(given - total, currency, locale)}</strong>
                      </Alert>
                    );
                  }
                  if (given < total) {
                    return (
                      <Alert tone="warning">
                        Reste a payer : <strong>{formatMoney(total - given, currency, locale)}</strong>
                        {' '}— la vente sera enregistree comme partiellement payee.
                      </Alert>
                    );
                  }
                  return null;
                })()}

                {method?.requiresReference && (
                  <Field
                    label="Reference"
                    htmlFor="pos-reference"
                    required
                    hint="Numero de transaction, de cheque ou de bordereau."
                  >
                    <Input
                      id="pos-reference"
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </Field>
                )}
              </>
            )}

            {isCredit && (
              <Alert tone="warning">
                Vente a credit : la facture restera due et apparaitra dans les creances du client.
              </Alert>
            )}

            <Button
              type="button"
              onClick={submit}
              disabled={api.pending || cart.length === 0}
              className="w-full"
            >
              {api.pending
                ? 'Enregistrement...'
                : `Encaisser ${formatMoney(total, currency, locale)}`}
            </Button>

            {cart.length > 0 && (
              <Button type="button" variant="ghost" onClick={reset} className="w-full">
                Vider le panier
              </Button>
            )}
          </div>
        </Card>
      </div>
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
