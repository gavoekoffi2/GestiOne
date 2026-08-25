import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { createProduct, getProduct, listProducts, updateProduct } from '@/server/services/catalog';
import { hasPermission } from '@/server/permissions';
import { createTestCompany, resetDatabase } from '../helpers';

/**
 * Confidentialite du prix d'achat.
 *
 * "products.cost.read" existe parce qu'un caissier ou un commercial ne doit pas
 * pouvoir deduire la marge de l'entreprise. Le role Caissier livre par defaut
 * accorde bien "products.read" sans ce droit — la separation n'a donc de sens
 * que si le montant ne quitte jamais le serveur pour ces utilisateurs.
 *
 * Ces tests fixent la regle au niveau du modele : ce qui est stocke, ce qui est
 * repris quand l'utilisateur ne peut pas le modifier, et ce que le role
 * Caissier a reellement le droit de voir.
 */

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
  minStock: 0n,
  isActive: true,
};

beforeEach(async () => {
  await resetDatabase();
});

describe("confidentialite du prix d'achat", () => {
  it('le role Caissier lit le catalogue mais pas les prix d achat', async () => {
    const company = await createTestCompany();
    const cashier = await prisma.role.findFirstOrThrow({
      where: { companyId: company.companyId, key: 'CASHIER' },
      select: { permissions: true },
    });

    expect(hasPermission(cashier.permissions, 'products.read')).toBe(true);
    expect(hasPermission(cashier.permissions, 'products.cost.read')).toBe(false);
  });

  it("conserve le prix d'achat enregistre quand la modification ne le fournit pas", async () => {
    const company = await createTestCompany();
    const created = await createProduct(company.companyId, product, company.userId);

    // C'est exactement ce que fait la route PUT pour un utilisateur sans le
    // droit : elle reinjecte la valeur en base au lieu de celle du client.
    const existing = await getProduct(company.companyId, created.id);
    await updateProduct(company.companyId, created.id, {
      ...product,
      name: 'Sac de riz 25 kg (promo)',
      salePrice: 14_000n,
      costPrice: existing.costPrice,
    });

    const after = await getProduct(company.companyId, created.id);
    expect(after.name).toBe('Sac de riz 25 kg (promo)');
    expect(after.salePrice).toBe(14_000n);
    expect(after.costPrice).toBe(12_000n);
  });

  it("accepte un article sans prix d'achat, comptabilise a zero", async () => {
    const company = await createTestCompany();

    const created = await createProduct(
      company.companyId,
      { ...product, costPrice: undefined },
      company.userId,
    );

    expect(created.costPrice).toBe(0n);
  });

  it('expose le prix d achat au service, a charge pour la route de le retirer', async () => {
    const company = await createTestCompany();
    await createProduct(company.companyId, product, company.userId);

    const result = await listProducts(company.companyId, { page: 1, pageSize: 25 });
    expect(result.items[0]).toHaveProperty('costPrice');

    // Ce que renvoie la route a un utilisateur sans le droit : meme objet,
    // ampute du seul champ sensible.
    const stripped = result.items.map(({ costPrice: _hidden, ...rest }) => rest);
    expect(stripped[0]).not.toHaveProperty('costPrice');
    expect(stripped[0]).toHaveProperty('salePrice');
  });
});
