import { describe, expect, it } from 'vitest';
import {
  applyRate,
  divideRounded,
  formatMoney,
  multiplyByQuantity,
  parseAmount,
  sum,
  toDecimalString,
  MoneyError,
} from '@/lib/money';

const XOF = { code: 'XOF', symbol: 'F CFA', decimals: 0, symbolPosition: 'after' as const };
const EUR = { code: 'EUR', symbol: '€', decimals: 2, symbolPosition: 'after' as const };
const USD = { code: 'USD', symbol: '$', decimals: 2, symbolPosition: 'before' as const };

describe('parseAmount', () => {
  it('lit un entier dans une devise sans decimale', () => {
    expect(parseAmount('1500', 0)).toBe(1500n);
    expect(parseAmount(1500, 0)).toBe(1500n);
  });

  it('convertit en unites mineures pour une devise a 2 decimales', () => {
    expect(parseAmount('15.00', 2)).toBe(1500n);
    expect(parseAmount('15', 2)).toBe(1500n);
    expect(parseAmount('15.5', 2)).toBe(1550n);
  });

  it('accepte la virgule decimale et les espaces de milliers', () => {
    expect(parseAmount('1 250,75', 2)).toBe(125075n);
    // Espace insecable et espace fine insecable : ce que produit un
    // copier-coller depuis un tableur ou une page web.
    expect(parseAmount('1\u00A0250,75', 2)).toBe(125075n);
    expect(parseAmount('1\u202F250,75', 2)).toBe(125075n);
  });

  it('interprete les points groupes comme des separateurs de milliers', () => {
    expect(parseAmount('1.250.000', 0)).toBe(1250000n);
  });

  it('gere les montants negatifs', () => {
    expect(parseAmount('-42.50', 2)).toBe(-4250n);
  });

  it('tronque au-dela de la precision de la devise', () => {
    expect(parseAmount('10.999', 2)).toBe(1099n);
    expect(parseAmount('10.9', 0)).toBe(10n);
  });

  it('rejette les saisies non numeriques', () => {
    expect(() => parseAmount('abc', 2)).toThrow(MoneyError);
    expect(() => parseAmount('', 2)).toThrow(MoneyError);
    expect(() => parseAmount('12x4', 2)).toThrow(MoneyError);
  });

  it('conserve la precision sur de tres grands montants', () => {
    // 9 007 199 254 740 993 depasse Number.MAX_SAFE_INTEGER : un parseFloat
    // perdrait la derniere unite.
    expect(parseAmount('9007199254740993', 0)).toBe(9007199254740993n);
  });
});

describe('formatMoney', () => {
  it('formate le franc CFA sans decimale', () => {
    expect(formatMoney(1500n, XOF)).toBe('1 500 F CFA');
  });

  it('formate une devise a 2 decimales', () => {
    expect(formatMoney(125075n, EUR)).toBe('1 250,75 €');
  });

  it('place le symbole avant quand la devise le demande', () => {
    expect(formatMoney(125075n, USD)).toBe('$1 250,75');
  });

  it('formate les montants negatifs', () => {
    expect(formatMoney(-4250n, EUR)).toBe('-42,50 €');
  });

  it('conserve les zeros decimaux', () => {
    expect(formatMoney(1500n, EUR)).toBe('15,00 €');
    expect(formatMoney(1505n, EUR)).toBe('15,05 €');
  });
});

describe('toDecimalString', () => {
  it('produit une valeur exploitable en CSV', () => {
    expect(toDecimalString(125075n, 2)).toBe('1250.75');
    expect(toDecimalString(1500n, 0)).toBe('1500');
    expect(toDecimalString(-5n, 2)).toBe('-0.05');
  });
});

describe('applyRate', () => {
  it('applique une TVA de 18 %', () => {
    expect(applyRate(10000n, 1800)).toBe(1800n);
  });

  it('arrondit au plus proche', () => {
    // 333 * 12,5 % = 41,625 -> 42
    expect(applyRate(333n, 1250)).toBe(42n);
    // 100 * 0,5 % = 0,5 -> 1 (le demi s'ecarte de zero)
    expect(applyRate(100n, 50)).toBe(1n);
  });

  it('est symetrique sur les montants negatifs', () => {
    expect(applyRate(-333n, 1250)).toBe(-42n);
  });

  it('refuse un taux non entier', () => {
    expect(() => applyRate(1000n, 18.5)).toThrow(MoneyError);
  });
});

describe('divideRounded', () => {
  it('arrondit correctement', () => {
    expect(divideRounded(10n, 4n)).toBe(3n);
    expect(divideRounded(10n, 3n)).toBe(3n);
    expect(divideRounded(11n, 3n)).toBe(4n);
    expect(divideRounded(-10n, 4n)).toBe(-3n);
  });

  it('refuse la division par zero', () => {
    expect(() => divideRounded(1n, 0n)).toThrow(MoneyError);
  });
});

describe('multiplyByQuantity', () => {
  it('multiplie un prix par une quantite entiere', () => {
    expect(multiplyByQuantity(2500n, 3000n)).toBe(7500n);
  });

  it('multiplie par une quantite fractionnaire', () => {
    // 0,750 kg a 2 000 F/kg
    expect(multiplyByQuantity(2000n, 750n)).toBe(1500n);
  });

  it('arrondit le resultat a l unite mineure', () => {
    // 1 333 * 0,333 = 443,889 -> 444
    expect(multiplyByQuantity(1333n, 333n)).toBe(444n);
  });
});

describe('sum', () => {
  it('additionne sans perte de precision', () => {
    // Le piege classique : 0,1 + 0,2 !== 0,3 en virgule flottante.
    const cents = [parseAmount('0.1', 2), parseAmount('0.2', 2)];
    expect(sum(cents)).toBe(parseAmount('0.30', 2));
  });

  it('rend zero pour une liste vide', () => {
    expect(sum([])).toBe(0n);
  });
});
