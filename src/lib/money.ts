/**
 * Arithmetique monetaire de GestiOne.
 *
 * Aucun montant n'est jamais represente par un nombre a virgule flottante :
 * `0.1 + 0.2 !== 0.3` est une erreur inacceptable sur une facture. Tous les
 * montants circulent sous forme d'entiers `bigint` exprimes dans la plus petite
 * unite de la devise ("unite mineure") :
 *
 *   XOF (0 decimale)  : 1500n  =>  1 500 F CFA
 *   EUR (2 decimales) : 1500n  =>  15,00 EUR
 *
 * Le nombre de decimales vient toujours de la devise de l'entreprise, jamais
 * d'une constante codee en dur.
 */

export type Money = bigint;

export interface CurrencyFormat {
  code: string;
  symbol: string;
  decimals: number;
  symbolPosition: 'before' | 'after';
}

export class MoneyError extends Error {}

/** Puissance de dix entiere, sans passer par Math.pow (qui rend un float). */
function pow10(exponent: number): bigint {
  let result = 1n;
  for (let i = 0; i < exponent; i += 1) result *= 10n;
  return result;
}

/**
 * Convertit une saisie utilisateur ("1 250,75", "1250.75", 1250.75) en unites
 * mineures. La chaine est analysee caractere par caractere : on ne repasse
 * jamais par `parseFloat`, qui perdrait des centimes sur les grands montants.
 */
export function parseAmount(input: string | number | bigint, decimals: number): Money {
  if (typeof input === 'bigint') return input;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('Montant invalide.');
    return parseAmount(input.toFixed(decimals), decimals);
  }

  // Les espaces (y compris insecables et fines, souvent issues d'un copier-coller)
  // et l'apostrophe suisse sont des separateurs de milliers, jamais des chiffres.
  const raw = input.trim().replace(/[\s\u00A0\u202F\u2009']/g, '');
  if (raw === '') throw new MoneyError('Montant vide.');

  // Un seul separateur decimal est accepte : le dernier "," ou "." rencontre,
  // a condition qu'il ne soit pas suivi de trois chiffres groupes (separateur
  // de milliers). On normalise d'abord la virgule en point.
  const normalised = raw.replace(/,/g, '.');
  const parts = normalised.split('.');

  let sign = 1n;
  let integerPart: string;
  let fractionPart = '';

  if (parts.length === 1) {
    integerPart = parts[0] as string;
  } else {
    const last = parts[parts.length - 1] as string;
    // "1.250.000" => separateurs de milliers uniquement.
    if (parts.length > 2 && last.length === 3) {
      integerPart = parts.join('');
    } else {
      integerPart = parts.slice(0, -1).join('');
      fractionPart = last;
    }
  }

  if (integerPart.startsWith('-')) {
    sign = -1n;
    integerPart = integerPart.slice(1);
  } else if (integerPart.startsWith('+')) {
    integerPart = integerPart.slice(1);
  }

  if (integerPart === '') integerPart = '0';
  if (!/^\d+$/.test(integerPart) || (fractionPart !== '' && !/^\d+$/.test(fractionPart))) {
    throw new MoneyError(`Montant invalide : "${input}".`);
  }

  // Tronque ou complete la partie decimale a la precision de la devise.
  const scaled = (fractionPart + '0'.repeat(decimals)).slice(0, decimals);
  const value = BigInt(integerPart) * pow10(decimals) + (decimals > 0 ? BigInt(scaled || '0') : 0n);
  return sign * value;
}

/** Rend le montant sous forme decimale simple ("1250.75"), pour un export CSV. */
export function toDecimalString(amount: Money, decimals: number): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const divisor = pow10(decimals);
  const whole = absolute / divisor;
  const rest = absolute % divisor;
  const body = decimals === 0 ? `${whole}` : `${whole}.${rest.toString().padStart(decimals, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Regroupement des milliers, fait a la main plutot que via `Intl.NumberFormat`.
 *
 * `Intl` rend en francais une espace fine insecable (U+202F) dont le rendu est
 * imprevisible sur une imprimante thermique, dans un PDF ou dans un CSV, et qui
 * varie selon la version d'ICU embarquee. Les montants de GestiOne finissent
 * sur des documents imprimes : ils doivent etre reproductibles au caractere
 * pres.
 */
export interface NumberSeparators {
  group: string;
  decimal: string;
}

export function separatorsFor(locale: string): NumberSeparators {
  return locale.startsWith('en')
    ? { group: ',', decimal: '.' }
    : { group: ' ', decimal: ',' };
}

export function groupDigits(digits: string, separator: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits[i];
  }
  return out;
}

/** Formatage lisible pour l'interface : "1 250,75 EUR" ou "1 500 F CFA". */
export function formatMoney(amount: Money, currency: CurrencyFormat, locale = 'fr'): string {
  const separators = separatorsFor(locale);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const divisor = pow10(currency.decimals);
  const whole = groupDigits((absolute / divisor).toString(), separators.group);
  const rest = absolute % divisor;

  const body =
    currency.decimals === 0
      ? whole
      : `${whole}${separators.decimal}${rest.toString().padStart(currency.decimals, '0')}`;

  const withSymbol =
    currency.symbolPosition === 'before'
      ? `${currency.symbol}${body}`
      : `${body} ${currency.symbol}`;

  return negative ? `-${withSymbol}` : withSymbol;
}

/**
 * Applique un pourcentage (remise, taxe) exprime en centiemes de point
 * (1250 = 12,50 %) avec un arrondi au demi superieur, deterministe et
 * symetrique pour les montants negatifs.
 */
export function applyRate(amount: Money, rateBasisPoints: number): Money {
  if (!Number.isInteger(rateBasisPoints)) {
    throw new MoneyError('Le taux doit etre un entier en centiemes de point.');
  }
  const numerator = amount * BigInt(rateBasisPoints);
  return divideRounded(numerator, 10_000n);
}

/** Division entiere avec arrondi au plus proche (0,5 s'ecarte de zero). */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('Division par zero.');
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Multiplie un prix unitaire par une quantite fractionnaire (millièmes). */
export function multiplyByQuantity(unitPrice: Money, quantityMilli: bigint): Money {
  return divideRounded(unitPrice * quantityMilli, 1000n);
}

export function sum(amounts: Iterable<Money>): Money {
  let total = 0n;
  for (const amount of amounts) total += amount;
  return total;
}

export function max(a: Money, b: Money): Money {
  return a > b ? a : b;
}

export function clampToZero(amount: Money): Money {
  return amount < 0n ? 0n : amount;
}
