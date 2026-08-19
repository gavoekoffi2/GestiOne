import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { formatDocumentNumber, nextDocumentNumber, periodKey } from '@/server/sequences';
import { createTestCompany, resetDatabase } from '../helpers';

beforeEach(async () => {
  await resetDatabase();
});

describe('formatDocumentNumber', () => {
  it('produit le format documente', () => {
    expect(formatDocumentNumber('FAC', '2026', 1, 5)).toBe('FAC-2026-00001');
    expect(formatDocumentNumber('DEV', '2026-04', 42, 4)).toBe('DEV-2026-04-0042');
    expect(formatDocumentNumber('VTE', 'ALL', 7, 6)).toBe('VTE-000007');
  });

  it("n'ampute pas un numero qui depasse le remplissage", () => {
    expect(formatDocumentNumber('FAC', '2026', 123456, 5)).toBe('FAC-2026-123456');
  });
});

describe('periodKey', () => {
  it('calcule la periode en UTC', () => {
    const date = new Date('2026-04-15T10:00:00Z');
    expect(periodKey('YEAR', date)).toBe('2026');
    expect(periodKey('MONTH', date)).toBe('2026-04');
    expect(periodKey('NONE', date)).toBe('ALL');
  });
});

describe('nextDocumentNumber', () => {
  it('incremente a partir de 1', async () => {
    const company = await createTestCompany();
    const now = new Date('2026-04-15T10:00:00Z');

    const first = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, company.companyId, 'INVOICE', { prefix: 'FAC', now }),
    );
    const second = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, company.companyId, 'INVOICE', { prefix: 'FAC', now }),
    );

    expect(first).toBe('FAC-2026-00001');
    expect(second).toBe('FAC-2026-00002');
  });

  it('tient un compteur separe par type de document', async () => {
    const company = await createTestCompany();
    const now = new Date('2026-04-15T10:00:00Z');

    const invoice = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, company.companyId, 'INVOICE', { prefix: 'FAC', now }),
    );
    const quote = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, company.companyId, 'QUOTE', { prefix: 'DEV', now }),
    );

    expect(invoice).toBe('FAC-2026-00001');
    expect(quote).toBe('DEV-2026-00001');
  });

  it('repart a 1 a chaque nouvelle annee', async () => {
    const company = await createTestCompany();

    const y2026 = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, company.companyId, 'INVOICE', {
        prefix: 'FAC',
        now: new Date('2026-12-31T23:00:00Z'),
      }),
    );
    const y2027 = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, company.companyId, 'INVOICE', {
        prefix: 'FAC',
        now: new Date('2027-01-01T01:00:00Z'),
      }),
    );

    expect(y2026).toBe('FAC-2026-00001');
    expect(y2027).toBe('FAC-2027-00001');
  });

  it('tient un compteur separe par entreprise', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });
    const now = new Date('2026-04-15T10:00:00Z');

    await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, alpha.companyId, 'INVOICE', { prefix: 'FAC', now }),
    );
    const betaFirst = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, beta.companyId, 'INVOICE', { prefix: 'FAC', now }),
    );

    // Le compteur d'Alpha ne doit pas faire avancer celui de Beta.
    expect(betaFirst).toBe('FAC-2026-00001');
  });

  it("n'attribue jamais deux fois le meme numero sous concurrence", async () => {
    const company = await createTestCompany();
    const now = new Date('2026-04-15T10:00:00Z');

    // 25 transactions simultanees : c'est exactement le scenario "deux caissiers
    // valident une vente en meme temps" qui produit des doublons de facture
    // quand le compteur est calcule cote application.
    const numbers = await Promise.all(
      Array.from({ length: 25 }, () =>
        prisma.$transaction((tx) =>
          nextDocumentNumber(tx, company.companyId, 'INVOICE', { prefix: 'FAC', now }),
        ),
      ),
    );

    expect(new Set(numbers).size).toBe(25);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 25 }, (_, index) =>
        formatDocumentNumber('FAC', '2026', index + 1, 5),
      ).sort(),
    );
  });

  it('respecte le prefixe choisi par l entreprise', async () => {
    const company = await createTestCompany();
    const number = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, company.companyId, 'INVOICE', {
        prefix: 'GST',
        now: new Date('2026-04-15T10:00:00Z'),
      }),
    );
    expect(number).toBe('GST-2026-00001');
  });
});
