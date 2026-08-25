/**
 * Calcul des totaux d'un document commercial (devis, facture, vente).
 *
 * Tout est en entiers : quantites en milliemes d'unite, montants en unite
 * mineure de la devise, taux en centiemes de point (1850 = 18,50 %).
 *
 * Le point delicat est la **remise globale**. Elle porte sur le document, mais
 * la taxe se calcule ligne par ligne (les taux peuvent differer d'une ligne a
 * l'autre). Il faut donc repartir la remise sur les lignes avant de taxer. Une
 * repartition proportionnelle naive perd ou cree des centimes par arrondi : sur
 * une facture, un total qui ne tombe pas juste est un litige. On utilise donc la
 * methode du plus fort reste, qui garantit que la somme des remises reparties
 * egale exactement la remise annoncee.
 */

import { applyRate, divideRounded, multiplyByQuantity, type Money } from './money';
import type { Quantity } from './quantity';

export interface LineInput {
  /** Quantite en milliemes d'unite. */
  quantity: Quantity;
  /** Prix unitaire en unite mineure. */
  unitPrice: Money;
  /** Remise de ligne, en centiemes de point. */
  discountRate?: number;
  /** Taux de taxe de la ligne, en centiemes de point. */
  taxRate?: number;
}

export interface LineTotals {
  /** Quantite x prix unitaire, avant toute remise. */
  gross: Money;
  /** Remise propre a la ligne. */
  lineDiscount: Money;
  /** Part de la remise globale imputee a cette ligne. */
  allocatedDiscount: Money;
  /** Base taxable : brut - remise de ligne - part de remise globale. */
  taxable: Money;
  /** Taxe de la ligne. */
  tax: Money;
  /** Base taxable + taxe. */
  total: Money;
}

export interface DocumentDiscount {
  /** Remise globale exprimee en montant fixe. */
  amount?: Money;
  /** Remise globale exprimee en centiemes de point du sous-total. */
  rate?: number;
}

export interface DocumentTotals {
  lines: LineTotals[];
  /** Somme des lignes apres remise de ligne, avant remise globale et taxes. */
  subtotal: Money;
  /** Remise globale reellement appliquee. */
  discountTotal: Money;
  /** Somme des bases taxables. */
  taxableTotal: Money;
  /** Somme des taxes. */
  taxTotal: Money;
  /** Montant du au total. */
  total: Money;
}

export class TotalsError extends Error {}

/**
 * Repartit `amount` sur des parts proportionnelles a `weights`, sans perdre
 * ni creer d'unite : la somme du resultat est exactement `amount`.
 *
 * Methode du plus fort reste — on attribue d'abord les parts entieres, puis les
 * unites restantes aux lignes dont la partie fractionnaire est la plus grande.
 */
export function distributeProportionally(amount: Money, weights: readonly Money[]): Money[] {
  const count = weights.length;
  if (count === 0) return [];

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);

  // Sans base de repartition, on ne peut rien imputer proportionnellement :
  // la remise porte alors entierement sur la premiere ligne.
  if (totalWeight <= 0n) {
    const result = new Array<Money>(count).fill(0n);
    result[0] = amount;
    return result;
  }

  const shares: Money[] = [];
  const remainders: Array<{ index: number; remainder: bigint }> = [];
  let allocated = 0n;

  for (let index = 0; index < count; index += 1) {
    const numerator = amount * (weights[index] as Money);
    const share = numerator / totalWeight; // division entiere, tronquee
    shares.push(share);
    allocated += share;
    remainders.push({ index, remainder: numerator % totalWeight });
  }

  let leftover = amount - allocated;

  // `leftover` est du signe de `amount` et strictement inferieur au nombre de
  // lignes : on distribue une unite a la fois, aux plus forts restes.
  remainders.sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0));

  let cursor = 0;
  const step = leftover >= 0n ? 1n : -1n;
  while (leftover !== 0n && cursor < remainders.length * 2) {
    const target = remainders[cursor % remainders.length]!;
    shares[target.index] = (shares[target.index] as Money) + step;
    leftover -= step;
    cursor += 1;
  }

  return shares;
}

export function computeTotals(
  lines: readonly LineInput[],
  discount: DocumentDiscount = {},
): DocumentTotals {
  if (discount.amount !== undefined && discount.rate !== undefined) {
    throw new TotalsError(
      'Une remise globale est soit un montant, soit un pourcentage, pas les deux.',
    );
  }

  // 1. Brut et remise de chaque ligne.
  const gross: Money[] = [];
  const lineDiscounts: Money[] = [];
  const nets: Money[] = [];

  for (const line of lines) {
    if (line.quantity < 0n) throw new TotalsError('Une quantité ne peut pas être négative.');
    if (line.unitPrice < 0n) throw new TotalsError('Un prix unitaire ne peut pas être négatif.');

    const rate = line.discountRate ?? 0;
    if (rate < 0 || rate > 10_000) {
      throw new TotalsError('Une remise de ligne doit être comprise entre 0 et 100 %.');
    }

    const lineGross = multiplyByQuantity(line.unitPrice, line.quantity);
    const lineDiscount = applyRate(lineGross, rate);

    gross.push(lineGross);
    lineDiscounts.push(lineDiscount);
    nets.push(lineGross - lineDiscount);
  }

  const subtotal = nets.reduce((sum, net) => sum + net, 0n);

  // 2. Remise globale.
  let discountTotal = 0n;
  if (discount.rate !== undefined) {
    if (discount.rate < 0 || discount.rate > 10_000) {
      throw new TotalsError('Une remise globale doit être comprise entre 0 et 100 %.');
    }
    discountTotal = applyRate(subtotal, discount.rate);
  } else if (discount.amount !== undefined) {
    if (discount.amount < 0n) throw new TotalsError('Une remise ne peut pas être négative.');
    if (discount.amount > subtotal) {
      throw new TotalsError('La remise ne peut pas dépasser le montant du document.');
    }
    discountTotal = discount.amount;
  }

  const allocations = distributeProportionally(discountTotal, nets);

  // 3. Base taxable et taxe, ligne par ligne.
  const result: LineTotals[] = [];
  let taxableTotal = 0n;
  let taxTotal = 0n;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as LineInput;
    const taxRate = line.taxRate ?? 0;
    if (taxRate < 0 || taxRate > 100_000) {
      throw new TotalsError('Un taux de taxe invalide a été fourni.');
    }

    const taxable = (nets[index] as Money) - (allocations[index] as Money);
    const tax = applyRate(taxable, taxRate);

    taxableTotal += taxable;
    taxTotal += tax;

    result.push({
      gross: gross[index] as Money,
      lineDiscount: lineDiscounts[index] as Money,
      allocatedDiscount: allocations[index] as Money,
      taxable,
      tax,
      total: taxable + tax,
    });
  }

  return {
    lines: result,
    subtotal,
    discountTotal,
    taxableTotal,
    taxTotal,
    total: taxableTotal + taxTotal,
  };
}

/**
 * Prix unitaire applicable selon la quantite commandee.
 *
 * Un prix special negocie prime sur tout ; sinon le prix de gros s'applique a
 * partir du seuil fixe sur l'article ; sinon le prix de detail.
 */
export function resolveUnitPrice(
  product: {
    salePrice: Money;
    wholesalePrice: Money | null;
    wholesaleFrom: Quantity | null;
    specialPrice: Money | null;
  },
  quantity: Quantity,
  options: { useSpecialPrice?: boolean } = {},
): Money {
  if (options.useSpecialPrice && product.specialPrice !== null) return product.specialPrice;

  if (
    product.wholesalePrice !== null &&
    product.wholesaleFrom !== null &&
    product.wholesaleFrom > 0n &&
    quantity >= product.wholesaleFrom
  ) {
    return product.wholesalePrice;
  }

  return product.salePrice;
}

/** Reste a payer, jamais negatif : un trop-percu n'est pas une dette du client. */
export function balanceDue(total: Money, paid: Money): Money {
  const remaining = total - paid;
  return remaining > 0n ? remaining : 0n;
}

export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export function paymentStatus(total: Money, paid: Money): PaymentStatus {
  if (paid <= 0n) return 'UNPAID';
  if (paid >= total) return 'PAID';
  return 'PARTIALLY_PAID';
}

/** Divise un total en parts entieres egales, le reste allant aux premieres parts. */
export function splitEvenly(amount: Money, parts: number): Money[] {
  if (parts <= 0) throw new TotalsError('Le nombre de parts doit être positif.');
  return distributeProportionally(amount, new Array<Money>(parts).fill(1n));
}

export { divideRounded };
