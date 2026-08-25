import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  DEFAULT_UNITS,
  countProducts,
  createCategory,
  createProduct,
  createUnit,
  deleteCategory,
  deleteProduct,
  deleteUnit,
  getProduct,
  listCategories,
  listProducts,
  listUnits,
  updateCategory,
  updateProduct,
} from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { createTestCompany, resetDatabase } from '../helpers';

const product = {
  kind: 'GOOD' as const,
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
};

beforeEach(async () => {
  await resetDatabase();
});

describe('unites', () => {
  it('installe un jeu d unites a la creation de l entreprise', async () => {
    const company = await createTestCompany();
    const units = await listUnits(company.companyId);

    expect(units).toHaveLength(DEFAULT_UNITS.length);
    expect(units.every((unit) => unit.isSystem)).toBe(true);
    expect(units.map((unit) => unit.symbol)).toContain('kg');
  });

  it('permet a l entreprise de creer ses propres unites', async () => {
    const company = await createTestCompany();
    const unit = await createUnit(company.companyId, { name: 'Regime de bananes', symbol: 'reg' });

    expect(unit.isSystem).toBe(false);
    expect(await listUnits(company.companyId)).toHaveLength(DEFAULT_UNITS.length + 1);
  });

  it('refuse deux unites au meme symbole', async () => {
    const company = await createTestCompany();
    await expect(createUnit(company.companyId, { name: 'Kilo', symbol: 'kg' })).rejects.toThrow(
      ConflictError,
    );
  });

  it('autorise le meme symbole dans deux entreprises', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await createUnit(alpha.companyId, { name: 'Regime', symbol: 'reg' });
    await expect(createUnit(beta.companyId, { name: 'Regime', symbol: 'reg' })).resolves.toBeDefined();
  });

  it('refuse de supprimer une unite utilisee par un article', async () => {
    const company = await createTestCompany();
    const unit = await createUnit(company.companyId, { name: 'Regime', symbol: 'reg' });
    await createProduct(company.companyId, { ...product, unitId: unit.id });

    await expect(deleteUnit(company.companyId, unit.id)).rejects.toThrow(ValidationError);
  });

  it("refuse l'unite d'une autre entreprise", async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });
    const betaUnit = (await listUnits(beta.companyId))[0]!;

    await expect(deleteUnit(alpha.companyId, betaUnit.id)).rejects.toThrow(NotFoundError);
  });
});

describe('categories', () => {
  it('gere une arborescence', async () => {
    const company = await createTestCompany();
    const parent = await createCategory(company.companyId, { name: 'Boissons', parentId: undefined });
    const child = await createCategory(company.companyId, {
      name: 'Boissons gazeuses',
      parentId: parent.id,
    });

    expect(child.parentId).toBe(parent.id);
    const listed = await listCategories(company.companyId);
    expect(listed.find((category) => category.id === child.id)?.parent?.name).toBe('Boissons');
  });

  it('autorise le meme nom sous deux parents differents', async () => {
    const company = await createTestCompany();
    const a = await createCategory(company.companyId, { name: 'Alimentaire', parentId: undefined });
    const b = await createCategory(company.companyId, { name: 'Entretien', parentId: undefined });

    await createCategory(company.companyId, { name: 'Divers', parentId: a.id });
    await expect(
      createCategory(company.companyId, { name: 'Divers', parentId: b.id }),
    ).resolves.toBeDefined();
  });

  it('refuse un doublon au meme niveau', async () => {
    const company = await createTestCompany();
    await createCategory(company.companyId, { name: 'Boissons', parentId: undefined });
    await expect(
      createCategory(company.companyId, { name: 'Boissons', parentId: undefined }),
    ).rejects.toThrow(ConflictError);
  });

  it('refuse qu une categorie soit sa propre parente', async () => {
    const company = await createTestCompany();
    const category = await createCategory(company.companyId, { name: 'Boissons', parentId: undefined });

    await expect(
      updateCategory(company.companyId, category.id, { name: 'Boissons', parentId: category.id }),
    ).rejects.toThrow(ValidationError);
  });

  it('refuse une boucle dans l arborescence', async () => {
    const company = await createTestCompany();
    const grandParent = await createCategory(company.companyId, { name: 'A', parentId: undefined });
    const parent = await createCategory(company.companyId, { name: 'B', parentId: grandParent.id });
    const child = await createCategory(company.companyId, { name: 'C', parentId: parent.id });

    // Rattacher A sous C fermerait le cycle A -> B -> C -> A.
    await expect(
      updateCategory(company.companyId, grandParent.id, { name: 'A', parentId: child.id }),
    ).rejects.toThrow(ValidationError);
  });

  it('refuse de supprimer une categorie contenant des articles ou des sous-categories', async () => {
    const company = await createTestCompany();
    const parent = await createCategory(company.companyId, { name: 'Boissons', parentId: undefined });
    const child = await createCategory(company.companyId, { name: 'Sodas', parentId: parent.id });

    await expect(deleteCategory(company.companyId, parent.id)).rejects.toThrow(ValidationError);

    await createProduct(company.companyId, { ...product, categoryId: child.id });
    await expect(deleteCategory(company.companyId, child.id)).rejects.toThrow(ValidationError);
  });

  it("refuse la categorie d'une autre entreprise", async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });
    const betaCategory = await createCategory(beta.companyId, { name: 'Boissons', parentId: undefined });

    await expect(
      updateCategory(alpha.companyId, betaCategory.id, { name: 'Detourne', parentId: undefined }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('stock initial a la creation', () => {
  it('cree le mouvement d entree et rend l article vendable aussitot', async () => {
    const company = await createTestCompany();

    const created = await createProduct(
      company.companyId,
      { ...product, initialStock: 24_000n },
      company.userId,
    );

    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { companyId: company.companyId, productId: created.id },
    });
    expect(level.quantity).toBe(24_000n);
    expect(level.locationId).toBe(company.locationId);

    // La quantite passe par le journal, comme n'importe quelle entree : elle
    // reste explicable et l'inventaire reste opposable.
    const movements = await prisma.stockMovement.findMany({
      where: { companyId: company.companyId, productId: created.id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.kind).toBe('IN');
    expect(movements[0]?.quantity).toBe(24_000n);
    expect(movements[0]?.userId).toBe(company.userId);
  });

  it('ne touche pas au stock quand la quantite est absente ou nulle', async () => {
    const company = await createTestCompany();

    const sansValeur = await createProduct(company.companyId, product, company.userId);
    const aZero = await createProduct(
      company.companyId,
      { ...product, name: 'Bidon d huile', initialStock: 0n },
      company.userId,
    );

    const movements = await prisma.stockMovement.count({
      where: { companyId: company.companyId, productId: { in: [sansValeur.id, aZero.id] } },
    });
    expect(movements).toBe(0);
  });

  it('ignore le stock initial d un service, qui ne se stocke pas', async () => {
    const company = await createTestCompany();

    const service = await createProduct(
      company.companyId,
      { ...product, kind: 'SERVICE', name: 'Livraison a domicile', initialStock: 10_000n },
      company.userId,
    );

    expect(
      await prisma.stockMovement.count({
        where: { companyId: company.companyId, productId: service.id },
      }),
    ).toBe(0);
  });

  it('place le stock dans le point de vente demande', async () => {
    const company = await createTestCompany();
    const depot = await prisma.location.create({
      data: {
        companyId: company.companyId,
        name: 'Depot',
        code: 'DEP',
        kind: 'WAREHOUSE',
        isActive: true,
      },
    });

    const created = await createProduct(
      company.companyId,
      { ...product, initialStock: 5_000n, initialStockLocationId: depot.id },
      company.userId,
    );

    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { companyId: company.companyId, productId: created.id },
    });
    expect(level.locationId).toBe(depot.id);
  });
});

describe('articles', () => {
  it('genere une reference lisible a partir du nom', async () => {
    const company = await createTestCompany();
    const created = await createProduct(company.companyId, product);
    expect(created.sku).toBe('SAC-DE-RIZ-25-KG');
  });

  it('suffixe la reference en cas d homonymie', async () => {
    const company = await createTestCompany();
    await createProduct(company.companyId, product);
    const second = await createProduct(company.companyId, product);
    expect(second.sku).toBe('SAC-DE-RIZ-25-KG-2');
  });

  it('accepte une reference fournie et refuse un doublon', async () => {
    const company = await createTestCompany();
    await createProduct(company.companyId, { ...product, sku: 'RIZ25' });
    await expect(
      createProduct(company.companyId, { ...product, name: 'Autre', sku: 'riz25' }),
    ).rejects.toThrow(ConflictError);
  });

  it('refuse un code-barres deja utilise', async () => {
    const company = await createTestCompany();
    await createProduct(company.companyId, { ...product, barcode: '6001234567890' });
    await expect(
      createProduct(company.companyId, { ...product, name: 'Autre', barcode: '6001234567890' }),
    ).rejects.toThrow(ConflictError);
  });

  it('autorise le meme code-barres dans deux entreprises', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await createProduct(alpha.companyId, { ...product, barcode: '6001234567890' });
    await expect(
      createProduct(beta.companyId, { ...product, barcode: '6001234567890' }),
    ).resolves.toBeDefined();
  });

  it('conserve les prix en entiers, sans perte', async () => {
    const company = await createTestCompany();
    const created = await createProduct(company.companyId, {
      ...product,
      costPrice: 12_500n,
      salePrice: 15_750n,
      wholesalePrice: 14_000n,
      wholesaleFrom: 10_000n,
    });

    expect(created.costPrice).toBe(12_500n);
    expect(created.salePrice).toBe(15_750n);
    expect(created.wholesalePrice).toBe(14_000n);
    expect(created.wholesaleFrom).toBe(10_000n);
  });

  it('force un service a ne pas etre suivi en stock', async () => {
    const company = await createTestCompany();
    const service = await createProduct(company.companyId, {
      ...product,
      kind: 'SERVICE',
      name: 'Installation climatiseur',
      minStock: 9_000n,
    });

    expect(service.trackStock).toBe(false);
    expect(service.minStock).toBe(0n);
  });

  it('refuse une categorie, une unite ou un fournisseur d une autre entreprise', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    const betaCategory = await createCategory(beta.companyId, { name: 'X', parentId: undefined });
    const betaUnit = (await listUnits(beta.companyId))[0]!;
    const betaSupplier = await createPartner(beta.companyId, 'SUPPLIER', {
      name: 'Grossiste Beta',
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

    for (const overrides of [
      { categoryId: betaCategory.id },
      { unitId: betaUnit.id },
      { supplierId: betaSupplier.id },
    ]) {
      await expect(
        createProduct(alpha.companyId, { ...product, ...overrides }),
      ).rejects.toThrow(NotFoundError);
    }

    expect(await prisma.product.count()).toBe(0);
  });

  it('refuse un client comme fournisseur', async () => {
    const company = await createTestCompany();
    const customer = await createPartner(company.companyId, 'CUSTOMER', {
      name: 'Ama',
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

    await expect(
      createProduct(company.companyId, { ...product, supplierId: customer.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it('recherche par nom, reference et code-barres exact', async () => {
    const company = await createTestCompany();
    await createProduct(company.companyId, { ...product, barcode: '6001234567890' });
    await createProduct(company.companyId, { ...product, name: 'Huile 5 L', sku: 'HUILE5' });

    expect((await listProducts(company.companyId, { page: 1, pageSize: 25, search: 'riz' })).total).toBe(1);
    expect((await listProducts(company.companyId, { page: 1, pageSize: 25, search: 'HUILE5' })).total).toBe(1);
    expect(
      (await listProducts(company.companyId, { page: 1, pageSize: 25, search: '6001234567890' })).total,
    ).toBe(1);
    // Un code-barres partiel ne doit pas remonter de resultat.
    expect(
      (await listProducts(company.companyId, { page: 1, pageSize: 25, search: '600123' })).total,
    ).toBe(0);
  });

  it('filtre par categorie et par type', async () => {
    const company = await createTestCompany();
    const category = await createCategory(company.companyId, { name: 'Alimentaire', parentId: undefined });
    await createProduct(company.companyId, { ...product, categoryId: category.id });
    await createProduct(company.companyId, { ...product, kind: 'SERVICE', name: 'Livraison' });

    expect(
      (await listProducts(company.companyId, { page: 1, pageSize: 25, categoryId: category.id })).total,
    ).toBe(1);
    expect((await listProducts(company.companyId, { page: 1, pageSize: 25, kind: 'SERVICE' })).total).toBe(1);
  });

  it('desactive plutot que supprimer', async () => {
    const company = await createTestCompany();
    const created = await createProduct(company.companyId, product);

    await deleteProduct(company.companyId, created.id);

    expect((await listProducts(company.companyId, { page: 1, pageSize: 25 })).total).toBe(0);
    expect((await getProduct(company.companyId, created.id)).isActive).toBe(false);
  });

  it("refuse l'article d'une autre entreprise", async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });
    const betaProduct = await createProduct(beta.companyId, product);

    await expect(getProduct(alpha.companyId, betaProduct.id)).rejects.toThrow(NotFoundError);
    await expect(
      updateProduct(alpha.companyId, betaProduct.id, { ...product, name: 'Detourne' }),
    ).rejects.toThrow(NotFoundError);
    await expect(deleteProduct(alpha.companyId, betaProduct.id)).rejects.toThrow(NotFoundError);
  });

  it('compte biens, services et articles inactifs', async () => {
    const company = await createTestCompany();
    await createProduct(company.companyId, product);
    await createProduct(company.companyId, { ...product, kind: 'SERVICE', name: 'Livraison' });
    const retired = await createProduct(company.companyId, { ...product, name: 'Ancien' });
    await deleteProduct(company.companyId, retired.id);

    expect(await countProducts(company.companyId)).toEqual({
      goods: 1,
      services: 1,
      inactive: 1,
      total: 2,
    });
  });
});

describe('rattrapage des unites (migration de la phase 1 vers la phase 2)', () => {
  it('installe les unites manquantes pour une entreprise qui n en a aucune', async () => {
    const company = await createTestCompany();

    // On simule l'etat d'une entreprise creee avant la phase 2.
    await prisma.unit.deleteMany({ where: { companyId: company.companyId } });
    expect(await listUnits(company.companyId)).toHaveLength(0);

    // Le script de rattrapage livre avec la migration, rejoue ici a l'identique.
    await prisma.$executeRawUnsafe(`
      INSERT INTO "units" ("id", "companyId", "name", "symbol", "isSystem", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, c."id", d."name", d."symbol", true, NOW(), NOW()
      FROM "companies" c
      CROSS JOIN (VALUES ${DEFAULT_UNITS.map((unit) => `('${unit.name}', '${unit.symbol}')`).join(', ')})
        AS d("name", "symbol")
      WHERE NOT EXISTS (
        SELECT 1 FROM "units" u WHERE u."companyId" = c."id" AND u."symbol" = d."symbol"
      )
    `);

    expect(await listUnits(company.companyId)).toHaveLength(DEFAULT_UNITS.length);
  });

  it('est rejouable sans creer de doublon', async () => {
    const company = await createTestCompany();

    for (let run = 0; run < 2; run += 1) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "units" ("id", "companyId", "name", "symbol", "isSystem", "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, c."id", d."name", d."symbol", true, NOW(), NOW()
        FROM "companies" c
        CROSS JOIN (VALUES ${DEFAULT_UNITS.map((unit) => `('${unit.name}', '${unit.symbol}')`).join(', ')})
          AS d("name", "symbol")
        WHERE NOT EXISTS (
          SELECT 1 FROM "units" u WHERE u."companyId" = c."id" AND u."symbol" = d."symbol"
        )
      `);
    }

    expect(await listUnits(company.companyId)).toHaveLength(DEFAULT_UNITS.length);
  });
});
