import { describe, expect, it } from 'vitest';
import { CsvError, cell, detectDelimiter, mapColumns, normaliseHeader, parseCsv } from '@/lib/csv';

describe('detectDelimiter', () => {
  it('reconnait la virgule et le point-virgule', () => {
    expect(detectDelimiter('a,b,c')).toBe(',');
    // Format produit par Excel en locale francaise.
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
  });

  it('ignore les separateurs entre guillemets', () => {
    expect(detectDelimiter('"Diallo, Ama";Telephone;Ville')).toBe(';');
  });

  it('retombe sur la virgule pour une colonne unique', () => {
    expect(detectDelimiter('Nom')).toBe(',');
  });
});

describe('parseCsv', () => {
  it('lit un fichier simple', () => {
    const result = parseCsv('Nom,Ville\nAma,Abidjan\nYao,Bouake');
    expect(result.headers).toEqual(['Nom', 'Ville']);
    expect(result.rows).toEqual([
      ['Ama', 'Abidjan'],
      ['Yao', 'Bouake'],
    ]);
  });

  it('retire le BOM UTF-8', () => {
    const result = parseCsv('﻿Nom,Ville\nAma,Abidjan');
    // Sans cela, la premiere en-tete porterait un caractere invisible et
    // aucune correspondance de colonne ne fonctionnerait.
    expect(result.headers[0]).toBe('Nom');
  });

  it('gere les fins de ligne CRLF', () => {
    const result = parseCsv('Nom,Ville\r\nAma,Abidjan\r\n');
    expect(result.rows).toEqual([['Ama', 'Abidjan']]);
  });

  it('gere les champs entre guillemets contenant un separateur', () => {
    const result = parseCsv('Nom,Adresse\n"Diallo, Ama","Rue 12, Cocody"');
    expect(result.rows[0]).toEqual(['Diallo, Ama', 'Rue 12, Cocody']);
  });

  it('gere les guillemets echappes', () => {
    const result = parseCsv('Nom\n"Rue ""du"" marche"');
    expect(result.rows[0]?.[0]).toBe('Rue "du" marche');
  });

  it('gere un retour a la ligne dans un champ', () => {
    const result = parseCsv('Nom,Notes\nAma,"Ligne 1\nLigne 2"');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.[1]).toBe('Ligne 1\nLigne 2');
  });

  it('ignore les lignes vides de fin de fichier', () => {
    const result = parseCsv('Nom,Ville\nAma,Abidjan\n\n\n');
    expect(result.rows).toHaveLength(1);
  });

  it('accepte le point-virgule', () => {
    const result = parseCsv('Nom;Ville\nAma;Abidjan');
    expect(result.headers).toEqual(['Nom', 'Ville']);
    expect(result.rows[0]).toEqual(['Ama', 'Abidjan']);
  });

  it('refuse un fichier vide', () => {
    expect(() => parseCsv('')).toThrow(CsvError);
    expect(() => parseCsv('\n\n')).toThrow(CsvError);
  });
});

describe('normaliseHeader', () => {
  it('ignore casse, accents et ponctuation', () => {
    expect(normaliseHeader('Prix de vente')).toBe('prixdevente');
    expect(normaliseHeader('PRIX DE VENTE')).toBe('prixdevente');
    expect(normaliseHeader('Prix d’achat')).toBe('prixdachat');
    expect(normaliseHeader('Téléphone')).toBe('telephone');
  });
});

describe('mapColumns', () => {
  const definitions = [
    { key: 'name', label: 'Nom', required: true },
    { key: 'phone', label: 'Telephone', aliases: ['Tel', 'Numero'] },
    { key: 'email', label: 'Email' },
  ];

  it('associe les colonnes malgre casse et accents', () => {
    const { mapping, missing } = mapColumns(['NOM', 'Téléphone', 'Ville'], definitions);
    expect(mapping.name).toBe(0);
    expect(mapping.phone).toBe(1);
    expect(mapping.email).toBeUndefined();
    expect(missing).toEqual([]);
  });

  it('accepte un alias', () => {
    const { mapping } = mapColumns(['Nom', 'Tel'], definitions);
    expect(mapping.phone).toBe(1);
  });

  it('signale les colonnes obligatoires absentes', () => {
    const { missing } = mapColumns(['Ville', 'Email'], definitions);
    expect(missing).toEqual(['Nom']);
  });
});

describe('cell', () => {
  it('rend une chaine vide pour une colonne absente ou une ligne courte', () => {
    expect(cell(['Ama'], { name: 0, phone: 1 }, 'phone')).toBe('');
    expect(cell(['Ama'], { name: 0 }, 'email')).toBe('');
  });

  it('retire les espaces autour de la valeur', () => {
    expect(cell(['  Ama  '], { name: 0 }, 'name')).toBe('Ama');
  });
});
