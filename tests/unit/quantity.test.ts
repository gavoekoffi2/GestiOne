import { describe, expect, it } from 'vitest';
import { formatQuantity, parseQuantity, toQuantityString, QuantityError } from '@/lib/quantity';

describe('parseQuantity', () => {
  it('lit une quantite entiere', () => {
    expect(parseQuantity('3')).toBe(3000n);
    expect(parseQuantity(3)).toBe(3000n);
  });

  it('lit une quantite fractionnaire', () => {
    expect(parseQuantity('0,75')).toBe(750n);
    expect(parseQuantity('2.5')).toBe(2500n);
    expect(parseQuantity('12,345')).toBe(12345n);
  });

  it('tronque au-dela du milliemme', () => {
    expect(parseQuantity('1,23456')).toBe(1234n);
  });

  it('gere les quantites negatives (sortie de stock)', () => {
    expect(parseQuantity('-4')).toBe(-4000n);
  });

  it('rejette une saisie invalide', () => {
    expect(() => parseQuantity('deux')).toThrow(QuantityError);
    expect(() => parseQuantity('')).toThrow(QuantityError);
  });
});

describe('formatQuantity', () => {
  it('retire les zeros decimaux inutiles', () => {
    expect(formatQuantity(3000n)).toBe('3');
    expect(formatQuantity(2500n)).toBe('2,5');
    expect(formatQuantity(750n)).toBe('0,75');
  });

  it('groupe les milliers', () => {
    expect(formatQuantity(1250000n)).toBe('1 250');
  });

  it('formate en anglais avec le point decimal', () => {
    expect(formatQuantity(2500n, 'en')).toBe('2.5');
    expect(formatQuantity(1250000n, 'en')).toBe('1,250');
  });
});

describe('toQuantityString', () => {
  it('produit une valeur exploitable en export', () => {
    expect(toQuantityString(2500n)).toBe('2.500');
    expect(toQuantityString(-750n)).toBe('-0.750');
  });
});
