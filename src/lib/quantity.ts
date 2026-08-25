/**
 * Les quantites suivent la meme logique que les montants : ce sont des entiers,
 * exprimes en milliemes d'unite. Cela permet de vendre 0,750 kg ou 2,5 m sans
 * jamais introduire de flottant dans un calcul de stock.
 */

import { groupDigits, separatorsFor } from './money';

export type Quantity = bigint;

export const QUANTITY_SCALE = 1000n;
export const QUANTITY_DECIMALS = 3;

export class QuantityError extends Error {}

export function parseQuantity(input: string | number | bigint): Quantity {
  if (typeof input === 'bigint') return input;
  const text = typeof input === 'number' ? input.toFixed(QUANTITY_DECIMALS) : input.trim();
  const raw = text.replace(/\s| /g, '').replace(/,/g, '.');
  if (raw === '') throw new QuantityError('Quantité vide.');

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new QuantityError(`Quantité invalide : "${input}".`);
  }

  const scaled = (fraction + '000').slice(0, QUANTITY_DECIMALS);
  const value = BigInt(whole || '0') * QUANTITY_SCALE + BigInt(scaled || '0');
  return negative ? -value : value;
}

/** "2,5" plutot que "2,500" : on retire les zeros decimaux inutiles. */
export function formatQuantity(quantity: Quantity, locale = 'fr'): string {
  const separators = separatorsFor(locale);
  const negative = quantity < 0n;
  const absolute = negative ? -quantity : quantity;
  const whole = groupDigits((absolute / QUANTITY_SCALE).toString(), separators.group);
  const fraction = (absolute % QUANTITY_SCALE)
    .toString()
    .padStart(QUANTITY_DECIMALS, '0')
    .replace(/0+$/, '');
  const body = fraction === '' ? whole : `${whole}${separators.decimal}${fraction}`;
  return negative ? `-${body}` : body;
}

export function toQuantityString(quantity: Quantity): string {
  const negative = quantity < 0n;
  const absolute = negative ? -quantity : quantity;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = (absolute % QUANTITY_SCALE).toString().padStart(QUANTITY_DECIMALS, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
