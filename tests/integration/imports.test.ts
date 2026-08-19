import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { previewImport, runImport, templateFor } from '@/server/services/imports';
import { createPartner } from '@/server/services/partners';
import { ValidationError } from '@/server/errors';
import { createTestCompany, resetDatabase } from '../helpers';

const XOF = { code: 'XOF', symbol: 'F CFA', decimals: 0, symbolPosition: 'after' as const };
const EUR = { code: 'EUR', symbol: '€', decimals: 2, symbolPosition: 'after' as const };

beforeEach(async () => {
  await resetDatabase();
});

describe('previewImport — clients', () => {
  it('analyse un fichier valide sans rien ecrire', async () => {
    const company = await createTestCompany();
    const csv = 'Nom,Telephone,Ville\nAma Diallo,+225 07 11 22 33 44,Abidjan\nYao Kouassi,,Bouake';

    const preview = await previewImport(company.companyId, 'clients', csv, XOF);

    expect(preview.readyCount).toBe(2);
    expect(preview.errorCount).toBe(0);
    // L'analyse ne doit rien creer : l'utilisateur valide avant.
    expect(await prisma.partner.count()).toBe(0);
  });

  it('reconnait les colonnes malgre casse, accents et alias', async () => {
    const company = await createTestCompany();
    const csv = 'NOM;Téléphone;VILLE\nAma;0700000000;Abidjan';

    const preview = await previewImport(company.companyId, 'clients', csv, XOF);
    expect(preview.detectedDelimiter).toBe(';');
    expect(preview.readyCount).toBe(1);
    expect(preview.rows[0]?.values.phone).toBe('0700000000');
  });

  it('signale les colonnes obligatoires absentes', async () => {
    const company = await createTestCompany();
    const preview = await previewImport(company.companyId, 'clients', 'Ville,Email\nAbidjan,a@b.c', XOF);

    expect(preview.missingColumns).toEqual(['Nom']);
    expect(preview.rows).toHaveLength(0);
  });

  it('detecte les doublons deja en base', async () => {
    const company = await createTestCompany();
    await createPartner(company.companyId, 'CUSTOMER', {
      name: 'Ama Diallo',
      companyName: undefined,
      phone: undefined,
      secondPhone: undefined,
      email: undefined,
      addressLine: undefined,
      city: undefined,
      countryCode: undefined,
      taxNumber: undefined,
      creditLimit: 0n,
      notes: undefined,
      isActive: true,
    });

    // La comparaison ignore la casse et les espaces.
    const preview = await previewImport(
      company.companyId,
      'clients',
      'Nom\n  ama diallo  \nYao Kouassi',
      XOF,
    );

    expect(preview.duplicateCount).toBe(1);
    expect(preview.readyCount).toBe(1);
    expect(preview.rows[0]?.status).toBe('duplicate');
  });

  it('detecte les doublons a l interieur du fichier', async () => {
    const company = await createTestCompany();
    const preview = await previewImport(
      company.companyId,
      'clients',
      'Nom\nAma Diallo\nAma Diallo',
      XOF,
    );

    expect(preview.readyCount).toBe(1);
    expect(preview.duplicateCount).toBe(1);
  });

  it('signale une ligne sans nom et un montant invalide', async () => {
    const company = await createTestCompany();
    const csv = "Nom,Plafond d'encours\n,50000\nYao,abc\nAma,250000";

    const preview = await previewImport(company.companyId, 'clients', csv, XOF);
    expect(preview.errorCount).toBe(2);
    expect(preview.readyCount).toBe(1);
    expect(preview.rows[0]?.message).toMatch(/nom/i);
    expect(preview.rows[1]?.message).toMatch(/invalide/i);
  });

  it('numerote les lignes comme dans le fichier', async () => {
    const company = await createTestCompany();
    const preview = await previewImport(company.companyId, 'clients', 'Nom\nAma\nYao', XOF);
    // Ligne 1 = en-tete ; la premiere donnee est donc en ligne 2.
    expect(preview.rows.map((row) => row.line)).toEqual([2, 3]);
  });
});

describe('runImport — clients', () => {
  it('cree les clients exploitables et ignore les doublons', async () => {
    const company = await createTestCompany();
    await createPartner(company.companyId, 'CUSTOMER', {
      name: 'Ama Diallo',
      companyName: undefined,
      phone: undefined,
      secondPhone: undefined,
      email: undefined,
      addressLine: undefined,
      city: undefined,
      countryCode: undefined,
      taxNumber: undefined,
      creditLimit: 0n,
      notes: undefined,
      isActive: true,
    });

    const csv =
      "Nom,Telephone,Ville,Plafond d'encours\nAma Diallo,,,0\nYao Kouassi,+225 05 00 00 00 00,Bouake,150000";

    const result = await runImport(company.companyId, 'clients', csv, XOF);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toEqual([]);

    const yao = await prisma.partner.findFirstOrThrow({ where: { name: 'Yao Kouassi' } });
    expect(yao.city).toBe('Bouake');
    expect(yao.creditLimit).toBe(150_000n);
    // Le doublon n'a pas ete ecrase : un fichier reimporte par erreur ne doit
    // pas remplacer des donnees corrigees a la main.
    expect(await prisma.partner.count()).toBe(2);
  });

  it('respecte les decimales de la devise', async () => {
    const company = await createTestCompany();
    const csv = "Nom,Plafond d'encours\nAma,\"1 250,75\"";

    await runImport(company.companyId, 'clients', csv, EUR);
    const ama = await prisma.partner.findFirstOrThrow({ where: { name: 'Ama' } });
    expect(ama.creditLimit).toBe(125_075n);
  });

  it('refuse un fichier sans les colonnes obligatoires', async () => {
    const company = await createTestCompany();
    await expect(
      runImport(company.companyId, 'clients', 'Ville\nAbidjan', XOF),
    ).rejects.toThrow(ValidationError);
  });

  it("n'importe jamais dans une autre entreprise", async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await runImport(alpha.companyId, 'clients', 'Nom\nClient Alpha', XOF);

    expect(await prisma.partner.count({ where: { companyId: beta.companyId } })).toBe(0);
  });
});

describe('runImport — produits', () => {
  it('cree les articles, leurs categories et rattache les unites', async () => {
    const company = await createTestCompany();
    const csv = [
      "Nom,Reference,Categorie,Unite,Prix d'achat,Prix de vente,Stock minimum",
      'Sac de riz 25 kg,RIZ25,Alimentaire,sac,12000,15000,5',
      'Huile 5 L,HUILE5,Alimentaire,L,5000,6500,10',
    ].join('\n');

    const result = await runImport(company.companyId, 'produits', csv, XOF);
    expect(result.created).toBe(2);

    const riz = await prisma.product.findFirstOrThrow({
      where: { sku: 'RIZ25' },
      include: { category: true, unit: true },
    });
    expect(riz.costPrice).toBe(12_000n);
    expect(riz.salePrice).toBe(15_000n);
    expect(riz.minStock).toBe(5_000n);
    expect(riz.category?.name).toBe('Alimentaire');
    expect(riz.unit?.symbol).toBe('sac');

    // La categorie n'est creee qu'une fois pour les deux articles.
    expect(await prisma.category.count({ where: { companyId: company.companyId } })).toBe(1);
  });

  it("importe sans unite quand celle du fichier est inconnue", async () => {
    const company = await createTestCompany();
    const csv = "Nom,Unite,Prix d'achat,Prix de vente\nRegime de bananes,regime,2000,3000";

    await runImport(company.companyId, 'produits', csv, XOF);
    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Regime de bananes' } });
    // On ne cree pas d'unite a l'aveugle : l'utilisateur la renseignera.
    expect(product.unitId).toBeNull();
  });

  it('signale les prix invalides sans bloquer les autres lignes', async () => {
    const company = await createTestCompany();
    const csv = [
      "Nom,Prix d'achat,Prix de vente",
      'Article correct,1000,1500',
      'Article fautif,abc,1500',
      'Autre correct,2000,2500',
    ].join('\n');

    const preview = await previewImport(company.companyId, 'produits', csv, XOF);
    expect(preview.errorCount).toBe(1);
    expect(preview.readyCount).toBe(2);

    const result = await runImport(company.companyId, 'produits', csv, XOF);
    // Une ligne fautive n'annule pas les autres.
    expect(result.created).toBe(2);
    expect(await prisma.product.count()).toBe(2);
  });

  it('genere une reference quand la colonne est absente', async () => {
    const company = await createTestCompany();
    const csv = "Nom,Prix d'achat,Prix de vente\nSac de riz 25 kg,12000,15000";

    await runImport(company.companyId, 'produits', csv, XOF);
    const product = await prisma.product.findFirstOrThrow();
    expect(product.sku).toBe('SAC-DE-RIZ-25-KG');
  });

  it('gere un fichier Excel francais complet', async () => {
    const company = await createTestCompany();
    // BOM, point-virgule, guillemets, CRLF : ce que produit reellement Excel.
    const csv =
      '﻿"Nom";"Catégorie";"Prix d\'achat";"Prix de vente"\r\n' +
      '"Sac de riz, 25 kg";"Alimentaire";"12000";"15000"\r\n';

    const result = await runImport(company.companyId, 'produits', csv, XOF);
    expect(result.created).toBe(1);
    const product = await prisma.product.findFirstOrThrow();
    expect(product.name).toBe('Sac de riz, 25 kg');
    expect(product.salePrice).toBe(15_000n);
  });
});

describe('templateFor', () => {
  it('produit un modele avec en-tetes et exemple', () => {
    const template = templateFor('produits');
    expect(template.charCodeAt(0)).toBe(0xfeff);
    expect(template).toContain('Prix de vente');
    expect(template).toContain('Sac de riz 25 kg');
  });
});
