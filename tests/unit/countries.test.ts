import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryLabel, findCountry } from '@/lib/countries';

/**
 * Liste des pays.
 *
 * Elle alimente l'inscription (pays + devise suggeree) et l'en-tete des
 * documents commerciaux. Deux erreurs y seraient invisibles a la relecture et
 * visibles par le client qui recoit la facture : un code duplique, et un code
 * affiche brut a la place du nom du pays.
 */
describe('pays', () => {
  it('ne comporte aucun code duplique', () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('associe a chaque pays une devise et un indicatif exploitables', () => {
    for (const country of COUNTRIES) {
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      expect(country.currency).toMatch(/^[A-Z]{3}$/);
      expect(country.dialCode).toMatch(/^\+\d{1,4}$/);
      expect(country.name.trim()).not.toBe('');
    }
  });

  it('rend le nom du pays plutot que son code ISO', () => {
    expect(countryLabel('CI')).toBe("Côte d'Ivoire");
    expect(countryLabel('SN')).toBe('Sénégal');
  });

  it('reste lisible sur une valeur absente ou inconnue', () => {
    // Un code inconnu vaut mieux affiche que perdu : il reste une information.
    expect(countryLabel('ZZ')).toBe('ZZ');
    expect(countryLabel(null)).toBe('');
    expect(countryLabel(undefined)).toBe('');
    expect(countryLabel('')).toBe('');
  });

  it('retrouve un pays par son code', () => {
    expect(findCountry('GH')?.name).toBe('Ghana');
    expect(findCountry('XX')).toBeUndefined();
  });
});
