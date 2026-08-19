import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { NotFoundError, ValidationError } from '@/server/errors';
import { recordAuditTx } from '@/server/audit';
import { formatQuantity } from '@/lib/quantity';

/**
 * Stock.
 *
 * Deux objets travaillent ensemble :
 *
 *  * `StockMovement` est le journal, en **ajout seul**. Aucune fonction de ce
 *    module ne modifie ni ne supprime un mouvement : corriger une erreur
 *    consiste a enregistrer un mouvement inverse, qui reste visible. Un stock
 *    dont on peut reecrire l'historique ne prouve rien en cas de litige ou de
 *    controle.
 *  * `StockLevel` est le solde, maintenu dans la **meme transaction** que le
 *    mouvement. Il existe uniquement pour eviter de reagreger tout le journal a
 *    chaque affichage ; il doit toujours valoir la somme des mouvements, ce que
 *    la suite de tests verifie explicitement.
 */

export type MovementKind =
  | 'IN'
  | 'OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT'
  | 'INVENTORY';

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  IN: 'Entree',
  OUT: 'Sortie',
  TRANSFER_IN: 'Transfert (reception)',
  TRANSFER_OUT: 'Transfert (expedition)',
  ADJUSTMENT: 'Ajustement',
  INVENTORY: 'Inventaire',
};

export interface MovementContext {
  companyId: string;
  userId: string;
}

async function loadTrackedProduct(companyId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, companyId },
    select: { id: true, name: true, sku: true, trackStock: true, unit: { select: { symbol: true } } },
  });
  if (!product) throw new NotFoundError('Article introuvable.');
  if (!product.trackStock) {
    throw new ValidationError(
      `"${product.name}" est un service : il ne fait pas l'objet d'un suivi de stock.`,
    );
  }
  return product;
}

async function assertLocation(companyId: string, locationId: string) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, companyId, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) throw new NotFoundError('Point de vente introuvable ou inactif.');
  return location;
}

/**
 * Applique une variation de stock **a l'interieur d'une transaction existante**.
 *
 * `SELECT ... FOR UPDATE` verrouille la ligne de solde : deux ventes simultanees
 * du dernier article en stock ne peuvent pas lire toutes les deux "1 disponible"
 * et sortir chacune une unite. La seconde attend, relit le solde a jour, et se
 * voit refuser la sortie.
 */
export async function applyMovement(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    productId: string;
    locationId: string;
    kind: MovementKind;
    /// Variation signee, en milliemes d'unite.
    delta: bigint;
    unitCost?: bigint | null;
    reason?: string | null;
    reference?: string | null;
    transferId?: string | null;
    userId?: string | null;
    allowNegative?: boolean;
  },
) {
  const existing = await tx.$queryRaw<Array<{ id: string; quantity: bigint }>>`
    SELECT "id", "quantity" FROM "stock_levels"
    WHERE "productId" = ${input.productId} AND "locationId" = ${input.locationId}
    FOR UPDATE
  `;

  const current = existing[0]?.quantity ?? 0n;
  const next = current + input.delta;

  // Un stock negatif signifie qu'on a vendu ce qu'on ne possedait pas : c'est
  // toujours une erreur de saisie ou un vol, jamais un etat normal. Seuls les
  // ajustements et inventaires peuvent l'assumer explicitement.
  if (next < 0n && !input.allowNegative) {
    throw new ValidationError(
      `Stock insuffisant : ${formatQuantity(current)} disponible(s), ${formatQuantity(-input.delta)} demande(s).`,
    );
  }

  if (existing[0]) {
    await tx.stockLevel.update({ where: { id: existing[0].id }, data: { quantity: next } });
  } else {
    await tx.stockLevel.create({
      data: {
        companyId: input.companyId,
        productId: input.productId,
        locationId: input.locationId,
        quantity: next,
      },
    });
  }

  return tx.stockMovement.create({
    data: {
      companyId: input.companyId,
      productId: input.productId,
      locationId: input.locationId,
      kind: input.kind,
      quantity: input.delta,
      quantityAfter: next,
      unitCost: input.unitCost ?? null,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      transferId: input.transferId ?? null,
      userId: input.userId ?? null,
    },
  });
}

export interface EntryInput {
  productId: string;
  locationId: string;
  quantity: bigint;
  unitCost?: bigint;
  reason?: string;
  reference?: string;
}

/** Entree de stock : reception, retour client, production. */
export async function recordEntry(context: MovementContext, input: EntryInput) {
  if (input.quantity <= 0n) throw new ValidationError('La quantite doit etre superieure a zero.');

  const product = await loadTrackedProduct(context.companyId, input.productId);
  const location = await assertLocation(context.companyId, input.locationId);

  return prisma.$transaction(async (tx) => {
    const movement = await applyMovement(tx, {
      companyId: context.companyId,
      productId: input.productId,
      locationId: input.locationId,
      kind: 'IN',
      delta: input.quantity,
      unitCost: input.unitCost ?? null,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      userId: context.userId,
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'STOCK_MOVE',
      entityType: 'StockMovement',
      entityId: movement.id,
      summary: `Entree de ${formatQuantity(input.quantity)} ${product.unit?.symbol ?? ''} — ${product.name} (${location.name})`.trim(),
    });

    return movement;
  });
}

export interface ExitInput extends EntryInput {}

/** Sortie de stock : casse, perte, consommation interne, don. */
export async function recordExit(context: MovementContext, input: ExitInput) {
  if (input.quantity <= 0n) throw new ValidationError('La quantite doit etre superieure a zero.');

  const product = await loadTrackedProduct(context.companyId, input.productId);
  const location = await assertLocation(context.companyId, input.locationId);

  return prisma.$transaction(async (tx) => {
    const movement = await applyMovement(tx, {
      companyId: context.companyId,
      productId: input.productId,
      locationId: input.locationId,
      kind: 'OUT',
      delta: -input.quantity,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      userId: context.userId,
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'STOCK_MOVE',
      entityType: 'StockMovement',
      entityId: movement.id,
      summary: `Sortie de ${formatQuantity(input.quantity)} ${product.unit?.symbol ?? ''} — ${product.name} (${location.name})`.trim(),
    });

    return movement;
  });
}

export interface TransferInput {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: bigint;
  reason?: string;
  reference?: string;
}

/**
 * Transfert entre deux points de vente.
 *
 * Les deux ecritures partagent un `transferId` et sont creees dans une seule
 * transaction : il est impossible qu'une marchandise sorte d'un depot sans
 * entrer dans l'autre.
 */
export async function recordTransfer(context: MovementContext, input: TransferInput) {
  if (input.quantity <= 0n) throw new ValidationError('La quantite doit etre superieure a zero.');
  if (input.fromLocationId === input.toLocationId) {
    throw new ValidationError('Le point de vente de depart et celui d arrivee doivent differer.');
  }

  const product = await loadTrackedProduct(context.companyId, input.productId);
  const from = await assertLocation(context.companyId, input.fromLocationId);
  const to = await assertLocation(context.companyId, input.toLocationId);

  return prisma.$transaction(async (tx) => {
    const transferId = crypto.randomUUID();
    const reason = input.reason ?? `Transfert ${from.name} → ${to.name}`;

    const out = await applyMovement(tx, {
      companyId: context.companyId,
      productId: input.productId,
      locationId: input.fromLocationId,
      kind: 'TRANSFER_OUT',
      delta: -input.quantity,
      reason,
      reference: input.reference ?? null,
      transferId,
      userId: context.userId,
    });

    const into = await applyMovement(tx, {
      companyId: context.companyId,
      productId: input.productId,
      locationId: input.toLocationId,
      kind: 'TRANSFER_IN',
      delta: input.quantity,
      reason,
      reference: input.reference ?? null,
      transferId,
      userId: context.userId,
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'STOCK_MOVE',
      entityType: 'StockTransfer',
      entityId: transferId,
      summary: `Transfert de ${formatQuantity(input.quantity)} — ${product.name} : ${from.name} vers ${to.name}`,
    });

    return { transferId, out, into };
  });
}

export interface AdjustmentInput {
  productId: string;
  locationId: string;
  /// Quantite reellement comptee, en milliemes d'unite.
  countedQuantity: bigint;
  reason: string;
}

/**
 * Inventaire : on saisit la quantite **comptee**, pas un ecart.
 *
 * GestiOne calcule lui-meme la difference et l'enregistre comme un mouvement.
 * Demander l'ecart obligerait l'utilisateur a faire la soustraction de tete
 * devant son rayon, avec le risque d'erreur de signe que cela implique.
 */
export async function recordInventory(context: MovementContext, input: AdjustmentInput) {
  if (input.countedQuantity < 0n) {
    throw new ValidationError('La quantite comptee ne peut pas etre negative.');
  }
  if (!input.reason.trim()) {
    throw new ValidationError("Indiquez le motif de l'inventaire.");
  }

  const product = await loadTrackedProduct(context.companyId, input.productId);
  const location = await assertLocation(context.companyId, input.locationId);

  return prisma.$transaction(async (tx) => {
    const level = await tx.stockLevel.findUnique({
      where: { productId_locationId: { productId: input.productId, locationId: input.locationId } },
      select: { quantity: true },
    });
    const current = level?.quantity ?? 0n;
    const delta = input.countedQuantity - current;

    if (delta === 0n) {
      throw new ValidationError(
        `Le stock compte correspond deja au stock enregistre (${formatQuantity(current)}). Aucun mouvement n'est necessaire.`,
      );
    }

    const movement = await applyMovement(tx, {
      companyId: context.companyId,
      productId: input.productId,
      locationId: input.locationId,
      kind: 'INVENTORY',
      delta,
      reason: input.reason,
      userId: context.userId,
      // Un inventaire constate ce qui est reellement present : il doit pouvoir
      // corriger un solde devenu incoherent, y compris vers le bas.
      allowNegative: true,
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'STOCK_MOVE',
      entityType: 'StockMovement',
      entityId: movement.id,
      summary: `Inventaire — ${product.name} (${location.name}) : ${formatQuantity(current)} → ${formatQuantity(input.countedQuantity)}`,
      metadata: {
        before: current.toString(),
        counted: input.countedQuantity.toString(),
        delta: delta.toString(),
      },
    });

    return movement;
  });
}
