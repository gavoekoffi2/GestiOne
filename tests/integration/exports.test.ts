import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { escapeCsvCell, runExport, toCsv } from '@/server/services/exports';
import { createInvoice } from '@/server/services/invoices';
import { createProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { recordEntry } from '@/server/services/stock';
import { createTestCompany, resetDatabase, serviceContext } from '../helpers';

const XOF = { code: 'XOF', symbol: 'F CFA', decimals: 0, symbolPosition: 'after' as const };
const EUR = { code: 'EUR', symbol: '€', decimals: 2, symbolPosition: 'after' as const };

const wholeYear = () => ({
  from: new Date(new Date().getFullYear(), 0, 1),
  to: new Date(new Date().getFullYear(), 11, 31, 23, 59, 59),
});

describe('escapeCsvCell', () => {
  it('laisse passer une valeur simple', () => {
    expect(escapeCsvCell('Ama Diallo')).toBe('Ama Diallo');
  });

  it('entoure de guillemets une valeur contenant un separateur', () => {
    expect(escapeCsvCell('Diallo, Ama')).toBe('"Diallo, Ama"');
    expect(escapeCsvCell('Ligne 1\nLigne 2')).toBe('"Ligne 1\nLigne 2"');
    expect(escapeCsvCell('Rue "du" marche')).toBe('"Rue ""du"" marche"');
  });

  it('neutralise les formules de tableur', () => {
    // Une cellule commencant par ces caracteres est executee par Excel et
    // LibreOffice a l'ouverture du fichier.
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('@import')).toBe("'@import");
  });

  it('neutralise une injection de commande realiste', () => {
    const attack = '=cmd|\' /C calc\'!A0';
    const escaped = escapeCsvCell(attack);
    expect(escaped.startsWith("'")).toBe(true);
    expect(escaped.startsWith('=')).toBe(false);
  });

  it('ne prefixe pas un nombre negatif deja entre guillemets par la suite', () => {
    // "-500" est un montant legitime : il est neutralise malgre tout, car le
    // tableur ne distingue pas un nombre negatif d'une formule commencant par
    // un tiret. Mieux vaut une apostrophe qu'une execution.
    expect(escapeCsvCell('-500')).toBe("'-500");
  });
});

describe('toCsv', () => {
  it('produit un fichier avec BOM et fins de ligne CRLF', () => {
    const csv = toCsv(['A', 'B'], [['1', '2']]);
    // Sans BOM, Excel sous Windows affiche des caracteres accentues casses.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
  });

  it('gere un export vide', () => {
    const csv = toCsv(['A', 'B'], []);
    expect(csv).toContain('A,B');
  });
});

describe('exports', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setup() {
    const company = await createTestCompany();
    const ctx = await serviceContext(company.companyId, company.userId);
    const product = await createProduct(company.companyId, {
      kind: 'GOOD',
      name: 'Sac de riz 25 kg',
      sku: undefined,
      barcode: undefined,
      description: undefined,
      categoryId: undefined,
      unitId: undefined,
      supplierId: undefined,
      costPrice: 12_000n,
      salePrice: 15_000n,
      wholesalePrice: undefined,
      wholesaleFrom: 0n,
      specialPrice: undefined,
      minStock: 5_000n,
      isActive: true,
    });
    const customer = await createPartner(company.companyId, 'CUSTOMER', {
      name: 'Ama Diallo',
      companyName: undefined,
      phone: '+225 07 11 22 33 44',
      secondPhone: undefined,
      email: undefined,
      addressLine: undefined,
      city: 'Abidjan',
      countryCode: 'CI',
      taxNumber: undefined,
      creditLimit: 250_000n,
      notes: undefined,
      isActive: true,
    });
    await recordEntry(
      { companyId: company.companyId, userId: company.userId },
      { productId: product.id, locationId: company.locationId, quantity: 100_000n },
    );
    return { ...company, ctx, productId: product.id, customerId: customer.id };
  }

  it('exporte les clients avec un point decimal', async () => {
    const s = await setup();
    const csv = await runExport(
      'clients',
      { companyId: s.companyId, currency: EUR, locale: 'fr' },
      wholeYear(),
    );

    expect(csv).toContain('CLI-0001');
    expect(csv).toContain('Ama Diallo');
    // 250 000 en unites mineures d'euro = 2500.00. Une virgule decalerait les
    // colonnes d'un CSV separe par des virgules.
    expect(csv).toContain('2500.00');
    expect(csv).not.toContain('2500,00');
  });

  it('exporte les montants sans decimale en franc CFA', async () => {
    const s = await setup();
    const csv = await runExport(
      'produits',
      { companyId: s.companyId, currency: XOF, locale: 'fr' },
      wholeYear(),
    );

    expect(csv).toContain('SAC-DE-RIZ-25-KG');
    expect(csv).toContain('12000');
    expect(csv).toContain('15000');
  });

  it('exporte les factures et leur reste du', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });

    const csv = await runExport(
      'factures',
      { companyId: s.companyId, currency: XOF, locale: 'fr' },
      wholeYear(),
    );
    expect(csv).toContain('FAC-');
    expect(csv).toContain('60000');
  });

  it('exporte le detail ligne a ligne des ventes', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });

    const csv = await runExport(
      'lignes-de-vente',
      { companyId: s.companyId, currency: XOF, locale: 'fr' },
      wholeYear(),
    );
    expect(csv).toContain('Sac de riz 25 kg');
    expect(csv).toContain('3.000');
    expect(csv).toContain('45000');
  });

  it('exporte les creances avec les jours de retard', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      dueDate: new Date(Date.now() - 10 * 86_400_000),
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    const csv = await runExport(
      'creances',
      { companyId: s.companyId, currency: XOF, locale: 'fr' },
      wholeYear(),
    );
    expect(csv).toContain('+225 07 11 22 33 44');
    expect(csv).toMatch(/,(9|10|11),/);
  });

  it('exporte l etat du stock', async () => {
    const s = await setup();
    const csv = await runExport(
      'stock',
      { companyId: s.companyId, currency: XOF, locale: 'fr' },
      wholeYear(),
    );
    expect(csv).toContain('Sac de riz 25 kg');
    expect(csv).toContain('100.000');
    expect(csv).toContain('Disponible');
  });

  it("n'exporte jamais les donnees d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    await createPartner(beta.companyId, 'CUSTOMER', {
      name: 'Client secret de Beta',
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

    const csv = await runExport(
      'clients',
      { companyId: alpha.companyId, currency: XOF, locale: 'fr' },
      wholeYear(),
    );
    expect(csv).not.toContain('Client secret de Beta');
  });

  it('neutralise une formule presente dans un nom de client', async () => {
    const s = await setup();
    await prisma.partner.create({
      data: {
        companyId: s.companyId,
        kind: 'CUSTOMER',
        code: 'CLI-9999',
        name: '=cmd|\' /C calc\'!A0',
      },
    });

    const csv = await runExport(
      'clients',
      { companyId: s.companyId, currency: XOF, locale: 'fr' },
      wholeYear(),
    );
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/,=cmd/);
  });
});
