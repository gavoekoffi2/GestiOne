import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { slugify } from '@/lib/validation/common';
import type { CategoryInput, ProductInput, UnitInput } from '@/lib/validation/catalog';
import { applyMovement } from '@/server/services/stock';

/**
 * Catalogue : categories, unites de mesure et articles.
 */

/**
 * Unites installees a la creation d'une entreprise. La liste couvre le commerce
 * de detail et de gros courant ; l'entreprise reste libre d'en creer d'autres
 * (regime, casier, botte, bidon de 20 L...).
 */
export const DEFAULT_UNITS = [
  { name: 'Unité', symbol: 'u' },
  { name: 'Pièce', symbol: 'pce' },
  { name: 'Carton', symbol: 'crt' },
  { name: 'Sac', symbol: 'sac' },
  { name: 'Paquet', symbol: 'paq' },
  { name: 'Kilogramme', symbol: 'kg' },
  { name: 'Gramme', symbol: 'g' },
  { name: 'Tonne', symbol: 't' },
  { name: 'Litre', symbol: 'L' },
  { name: 'Mètre', symbol: 'm' },
  { name: 'Mètre carré', symbol: 'm2' },
  { name: 'Heure', symbol: 'h' },
  { name: 'Jour', symbol: 'j' },
] as const;

export async function provisionDefaultUnits(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.unit.createMany({
    data: DEFAULT_UNITS.map((unit) => ({ ...unit, companyId, isSystem: true })),
    skipDuplicates: true,
  });
}

// --------------------------------------------------------------------------
// Categories
// --------------------------------------------------------------------------

export async function listCategories(companyId: string) {
  return prisma.category.findMany({
    where: { companyId },
    include: {
      parent: { select: { id: true, name: true } },
      _count: { select: { products: true } },
    },
    orderBy: { name: 'asc' },
  });
}

async function assertCategory(companyId: string, categoryId: string) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, companyId },
    select: { id: true, parentId: true },
  });
  if (!category) throw new NotFoundError('Catégorie introuvable.');
  return category;
}

export async function createCategory(companyId: string, input: CategoryInput) {
  if (input.parentId) await assertCategory(companyId, input.parentId);

  const duplicate = await prisma.category.findFirst({
    where: { companyId, name: input.name, parentId: input.parentId ?? null },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError('Une catégorie porte déjà ce nom au même niveau.');

  return prisma.category.create({
    data: { companyId, name: input.name, parentId: input.parentId ?? null },
  });
}

export async function updateCategory(companyId: string, categoryId: string, input: CategoryInput) {
  await assertCategory(companyId, categoryId);

  if (input.parentId) {
    if (input.parentId === categoryId) {
      throw new ValidationError('Une catégorie ne peut pas être sa propre catégorie parente.');
    }
    await assertCategory(companyId, input.parentId);

    // Une boucle (A -> B -> A) rendrait tout parcours de l'arbre infini.
    let cursor: string | null = input.parentId;
    for (let depth = 0; cursor && depth < 50; depth += 1) {
      if (cursor === categoryId) {
        throw new ValidationError(
          'Ce déplacement créerait une boucle dans l arborescence des catégories.',
        );
      }
      const parent: { parentId: string | null } | null = await prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  const duplicate = await prisma.category.findFirst({
    where: {
      companyId,
      name: input.name,
      parentId: input.parentId ?? null,
      id: { not: categoryId },
    },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError('Une catégorie porte déjà ce nom au même niveau.');

  return prisma.category.update({
    where: { id: categoryId },
    data: { name: input.name, parentId: input.parentId ?? null },
  });
}

export async function deleteCategory(companyId: string, categoryId: string) {
  await assertCategory(companyId, categoryId);

  const [products, children] = await Promise.all([
    prisma.product.count({ where: { companyId, categoryId } }),
    prisma.category.count({ where: { companyId, parentId: categoryId } }),
  ]);

  if (children > 0) {
    throw new ValidationError(
      `Cette catégorie contient ${children} sous-catégorie(s). Supprimez-les ou déplacez-les d'abord.`,
    );
  }
  if (products > 0) {
    throw new ValidationError(
      `Cette catégorie contient ${products} article(s). Reclassez-les avant de la supprimer.`,
    );
  }

  await prisma.category.delete({ where: { id: categoryId } });
}

// --------------------------------------------------------------------------
// Unites
// --------------------------------------------------------------------------

export async function listUnits(companyId: string) {
  return prisma.unit.findMany({
    where: { companyId },
    include: { _count: { select: { products: true } } },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
}

export async function createUnit(companyId: string, input: UnitInput) {
  const duplicate = await prisma.unit.findFirst({
    where: { companyId, symbol: input.symbol },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError(`Le symbole "${input.symbol}" est déjà utilisé.`);

  return prisma.unit.create({
    data: { companyId, name: input.name, symbol: input.symbol, isSystem: false },
  });
}

export async function updateUnit(companyId: string, unitId: string, input: UnitInput) {
  const unit = await prisma.unit.findFirst({ where: { id: unitId, companyId } });
  if (!unit) throw new NotFoundError('Unité introuvable.');

  const duplicate = await prisma.unit.findFirst({
    where: { companyId, symbol: input.symbol, id: { not: unitId } },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError(`Le symbole "${input.symbol}" est déjà utilisé.`);

  return prisma.unit.update({ where: { id: unitId }, data: input });
}

export async function deleteUnit(companyId: string, unitId: string) {
  const unit = await prisma.unit.findFirst({ where: { id: unitId, companyId } });
  if (!unit) throw new NotFoundError('Unité introuvable.');

  const used = await prisma.product.count({ where: { companyId, unitId } });
  if (used > 0) {
    throw new ValidationError(
      `Cette unité est utilisée par ${used} article(s). Changez leur unité avant de la supprimer.`,
    );
  }

  await prisma.unit.delete({ where: { id: unitId } });
}

// --------------------------------------------------------------------------
// Articles
// --------------------------------------------------------------------------

export interface ProductListQuery {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  kind?: 'GOOD' | 'SERVICE';
  includeInactive?: boolean;
}

export async function listProducts(companyId: string, query: ProductListQuery) {
  const search = query.search?.trim();
  const where: Prisma.ProductWhereInput = {
    companyId,
    ...(query.includeInactive ? {} : { isActive: true }),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            // Le code-barres se compare a l'identique : une scannette envoie la
            // valeur exacte, et une recherche partielle y ferait du bruit.
            { barcode: { equals: search } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, symbol: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    items,
  };
}

export async function getProduct(companyId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, companyId },
    include: { category: true, unit: true, supplier: true },
  });
  if (!product) throw new NotFoundError('Article introuvable.');
  return product;
}

/** Genere une reference lisible a partir du nom : "Sac de riz 25kg" -> "SAC-DE-RIZ-25KG". */
async function nextSku(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
): Promise<string> {
  const base = (slugify(name).toUpperCase() || 'ART').slice(0, 24);
  let candidate = base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const taken = await tx.product.findFirst({
      where: { companyId, sku: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
    candidate = `${base}-${suffix}`;
  }
  throw new ConflictError('Impossible de générer une référence unique.');
}

async function assertRelations(companyId: string, input: ProductInput) {
  if (input.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, companyId },
      select: { id: true },
    });
    if (!category) throw new NotFoundError('Catégorie introuvable.');
  }
  if (input.unitId) {
    const unit = await prisma.unit.findFirst({
      where: { id: input.unitId, companyId },
      select: { id: true },
    });
    if (!unit) throw new NotFoundError('Unité introuvable.');
  }
  if (input.supplierId) {
    const supplier = await prisma.partner.findFirst({
      where: { id: input.supplierId, companyId, kind: 'SUPPLIER' },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundError('Fournisseur introuvable.');
  }
}

function toProductData(input: ProductInput) {
  const isService = input.kind === 'SERVICE';
  return {
    kind: input.kind,
    name: input.name,
    barcode: input.barcode ?? null,
    description: input.description ?? null,
    categoryId: input.categoryId ?? null,
    unitId: input.unitId ?? null,
    supplierId: input.supplierId ?? null,
    costPrice: input.costPrice,
    salePrice: input.salePrice,
    wholesalePrice: input.wholesalePrice ?? null,
    wholesaleFrom: input.wholesalePrice !== undefined ? input.wholesaleFrom : null,
    specialPrice: input.specialPrice ?? null,
    // Un service n'a pas de stock : forcer ces valeurs ici evite d'avoir a s'en
    // souvenir dans chaque ecran et dans chaque import.
    trackStock: !isService,
    minStock: isService ? 0n : input.minStock,
    isActive: input.isActive,
  };
}

export async function createProduct(companyId: string, input: ProductInput, userId?: string) {
  await assertRelations(companyId, input);

  if (input.barcode) {
    const duplicate = await prisma.product.findFirst({
      where: { companyId, barcode: input.barcode },
      select: { id: true, name: true },
    });
    if (duplicate) {
      throw new ConflictError(`Ce code-barres est déjà utilisé par l'article "${duplicate.name}".`);
    }
  }

  // Le stock initial n'a de sens que pour un article suivi, et il faut savoir
  // dans quel point de vente il se trouve.
  const initialStock = input.kind === 'GOOD' ? (input.initialStock ?? 0n) : 0n;
  const stockLocationId =
    initialStock > 0n
      ? input.initialStockLocationId || (await defaultLocationId(companyId))
      : null;

  if (initialStock > 0n && !stockLocationId) {
    throw new ValidationError(
      'Aucun point de vente actif : impossible de saisir un stock initial.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const sku = input.sku
      ? input.sku.toUpperCase()
      : await nextSku(tx, companyId, input.name);

    if (input.sku) {
      const taken = await tx.product.findFirst({
        where: { companyId, sku },
        select: { id: true },
      });
      if (taken) throw new ConflictError(`La référence "${sku}" est déjà utilisée.`);
    }

    const product = await tx.product.create({
      data: { ...toProductData(input), companyId, sku },
    });

    // Le stock passe par le journal des mouvements comme n'importe quelle
    // entree : la quantite reste explicable, et l'inventaire reste opposable.
    if (initialStock > 0n && stockLocationId) {
      await applyMovement(tx, {
        companyId,
        productId: product.id,
        locationId: stockLocationId,
        kind: 'IN',
        delta: initialStock,
        unitCost: input.costPrice,
        reason: 'Stock initial a la creation de l article',
        userId,
      });
    }

    return product;
  });
}

/** Point de vente par defaut d'une entreprise, pour un stock initial. */
async function defaultLocationId(companyId: string): Promise<string | null> {
  const location = await prisma.location.findFirst({
    where: { companyId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return location?.id ?? null;
}

export async function updateProduct(companyId: string, productId: string, input: ProductInput) {
  await getProduct(companyId, productId);
  await assertRelations(companyId, input);

  if (input.barcode) {
    const duplicate = await prisma.product.findFirst({
      where: { companyId, barcode: input.barcode, id: { not: productId } },
      select: { id: true, name: true },
    });
    if (duplicate) {
      throw new ConflictError(`Ce code-barres est déjà utilisé par l'article "${duplicate.name}".`);
    }
  }

  if (input.sku) {
    const sku = input.sku.toUpperCase();
    const taken = await prisma.product.findFirst({
      where: { companyId, sku, id: { not: productId } },
      select: { id: true },
    });
    if (taken) throw new ConflictError(`La référence "${sku}" est déjà utilisée.`);
    return prisma.product.update({
      where: { id: productId },
      data: { ...toProductData(input), sku },
    });
  }

  return prisma.product.update({ where: { id: productId }, data: toProductData(input) });
}

export async function deleteProduct(companyId: string, productId: string) {
  await getProduct(companyId, productId);
  // A partir de la phase 3, un article apparait dans des mouvements de stock et
  // des lignes de vente : la desactivation preserve cet historique.
  return prisma.product.update({ where: { id: productId }, data: { isActive: false } });
}

export async function countProducts(companyId: string) {
  const [goods, services, inactive] = await Promise.all([
    prisma.product.count({ where: { companyId, kind: 'GOOD', isActive: true } }),
    prisma.product.count({ where: { companyId, kind: 'SERVICE', isActive: true } }),
    prisma.product.count({ where: { companyId, isActive: false } }),
  ]);
  return { goods, services, inactive, total: goods + services };
}
