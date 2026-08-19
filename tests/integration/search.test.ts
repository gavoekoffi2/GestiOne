import { beforeEach, describe, expect, it } from 'vitest';
import { globalSearch } from '@/server/services/search';
import { createInvoice } from '@/server/services/invoices';
import { createProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { recordEntry } from '@/server/services/stock';
import { createTestCompany, resetDatabase, serviceContext } from '../helpers';

const ALL = ['*'];

const partnerBase = {
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
};

async function setup() {
  const company = await createTestCompany();
  const ctx = await serviceContext(company.companyId, company.userId);

  const customer = await createPartner(company.companyId, 'CUSTOMER', {
    ...partnerBase,
    name: 'Ama Diallo',
    phone: '+225 07 11 22 33 44',
  });
  await createPartner(company.companyId, 'SUPPLIER', {
    ...partnerBase,
    name: 'Grossiste Adjame',
  });
  const product = await createProduct(company.companyId, {
    kind: 'GOOD',
    name: 'Sac de riz 25 kg',
    sku: undefined,
    barcode: '6001234567890',
    description: undefined,
    categoryId: undefined,
    unitId: undefined,
    supplierId: undefined,
    costPrice: 12_000n,
    salePrice: 15_000n,
    wholesalePrice: undefined,
    wholesaleFrom: 0n,
    specialPrice: undefined,
    minStock: 0n,
    isActive: true,
  });

  await recordEntry(
    { companyId: company.companyId, userId: company.userId },
    { productId: product.id, locationId: company.locationId, quantity: 100_000n },
  );
  const invoice = await createInvoice(ctx, {
    customerId: customer.id,
    locationId: company.locationId,
    issue: true,
    lines: [{ productId: product.id, quantity: 2_000n }],
  });

  return { ...company, ctx, customerId: customer.id, productId: product.id, invoice };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('globalSearch', () => {
  it('trouve un client par son nom', async () => {
    const s = await setup();
    const hits = await globalSearch(s.companyId, ALL, 'diallo');
    expect(hits.find((hit) => hit.kind === 'customer')?.title).toBe('Ama Diallo');
  });

  it('trouve un client par son telephone', async () => {
    const s = await setup();
    // Un commercant a le client au telephone : il tape le numero, pas le nom.
    const hits = await globalSearch(s.companyId, ALL, '11 22');
    expect(hits.find((hit) => hit.kind === 'customer')?.title).toBe('Ama Diallo');
  });

  it('trouve un article par sa reference et par son code-barres', async () => {
    const s = await setup();
    expect(
      (await globalSearch(s.companyId, ALL, 'SAC-DE-RIZ')).some((hit) => hit.kind === 'product'),
    ).toBe(true);
    expect(
      (await globalSearch(s.companyId, ALL, '6001234567890')).some((hit) => hit.kind === 'product'),
    ).toBe(true);
  });

  it('trouve une facture par son numero et mene a son detail', async () => {
    const s = await setup();
    const hits = await globalSearch(s.companyId, ALL, s.invoice.number);
    const invoice = hits.find((hit) => hit.kind === 'invoice');
    expect(invoice?.title).toBe(s.invoice.number);
    expect(invoice?.href).toBe(`/factures/${s.invoice.id}`);
  });

  it('trouve une facture par le nom de son client', async () => {
    const s = await setup();
    const hits = await globalSearch(s.companyId, ALL, 'Ama');
    expect(hits.some((hit) => hit.kind === 'invoice')).toBe(true);
  });

  it('ignore une recherche trop courte', async () => {
    const s = await setup();
    // Une seule lettre remonterait la moitie du catalogue sans rien apprendre.
    expect(await globalSearch(s.companyId, ALL, 'a')).toEqual([]);
    expect(await globalSearch(s.companyId, ALL, '  ')).toEqual([]);
  });

  it('respecte les permissions de chaque module', async () => {
    const s = await setup();

    const productsOnly = await globalSearch(s.companyId, ['products.read'], 'a');
    expect(productsOnly).toEqual([]);

    const limited = await globalSearch(s.companyId, ['customers.read'], 'Ama');
    // La recherche ne doit pas devenir un moyen de contourner les droits en
    // devinant des noms.
    expect(limited.every((hit) => hit.kind === 'customer')).toBe(true);

    expect(await globalSearch(s.companyId, [], 'Ama')).toEqual([]);
  });

  it("ne trouve jamais les donnees d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();

    // Les deux entreprises ont un client "Ama Diallo" homonyme. La recherche
    // remonte le client *et* sa facture — mais uniquement ceux d'Alpha.
    const hits = await globalSearch(alpha.companyId, ALL, 'Diallo');
    const alphaCustomers = hits.filter((hit) => hit.kind === 'customer');
    expect(alphaCustomers).toHaveLength(1);
    expect(alphaCustomers[0]?.id).toBe(alpha.customerId);
    expect(hits.some((hit) => hit.id === beta.customerId)).toBe(false);
    expect(hits.some((hit) => hit.id === beta.invoice.id)).toBe(false);

    // Et le numero de facture de Beta ne remonte jamais celle d'Alpha.
    const betaHits = await globalSearch(beta.companyId, ALL, beta.invoice.number);
    expect(betaHits.some((hit) => hit.id === alpha.invoice.id)).toBe(false);
  });

  it('separe clients et fournisseurs', async () => {
    const s = await setup();
    const hits = await globalSearch(s.companyId, ALL, 'Grossiste');
    expect(hits[0]?.kind).toBe('supplier');
  });
});
