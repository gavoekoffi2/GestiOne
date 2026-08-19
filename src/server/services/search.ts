import { prisma } from '@/server/db';
import type { PermissionKey } from '@/server/permissions';

/**
 * Recherche globale.
 *
 * Un commercant qui a un client au telephone tape un nom, un numero ou une
 * reference de facture — il ne sait pas dans quel module chercher. La recherche
 * interroge donc tous les referentiels d'un coup.
 *
 * Chaque famille de resultats est conditionnee par la permission du module
 * correspondant : la recherche ne doit pas devenir un moyen de contourner les
 * droits en devinant des noms.
 */

export type SearchKind =
  | 'customer'
  | 'supplier'
  | 'product'
  | 'invoice'
  | 'quote'
  | 'purchase'
  | 'payment';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export const KIND_LABELS: Record<SearchKind, string> = {
  customer: 'Clients',
  supplier: 'Fournisseurs',
  product: 'Produits',
  invoice: 'Factures',
  quote: 'Devis',
  purchase: 'Achats',
  payment: 'Paiements',
};

/** Nombre de resultats par famille : assez pour reconnaitre, pas pour noyer. */
const PER_KIND = 5;

export async function globalSearch(
  companyId: string,
  permissions: readonly string[],
  rawQuery: string,
): Promise<SearchHit[]> {
  const query = rawQuery.trim();
  // Une lettre unique remonterait la moitie du catalogue sans rien apprendre.
  if (query.length < 2) return [];

  const allowed = (permission: PermissionKey) =>
    permissions.includes('*') || permissions.includes(permission);

  const contains = { contains: query, mode: 'insensitive' as const };
  const tasks: Array<Promise<SearchHit[]>> = [];

  if (allowed('customers.read')) {
    tasks.push(
      prisma.partner
        .findMany({
          where: {
            companyId,
            kind: 'CUSTOMER',
            OR: [{ name: contains }, { code: contains }, { phone: { contains: query } }, { companyName: contains }],
          },
          take: PER_KIND,
          orderBy: { name: 'asc' },
        })
        .then((rows) =>
          rows.map((row) => ({
            kind: 'customer' as const,
            id: row.id,
            title: row.name,
            subtitle: [row.code, row.phone].filter(Boolean).join(' · '),
            href: '/clients',
          })),
        ),
    );
  }

  if (allowed('suppliers.read')) {
    tasks.push(
      prisma.partner
        .findMany({
          where: {
            companyId,
            kind: 'SUPPLIER',
            OR: [{ name: contains }, { code: contains }, { phone: { contains: query } }],
          },
          take: PER_KIND,
          orderBy: { name: 'asc' },
        })
        .then((rows) =>
          rows.map((row) => ({
            kind: 'supplier' as const,
            id: row.id,
            title: row.name,
            subtitle: [row.code, row.phone].filter(Boolean).join(' · '),
            href: '/fournisseurs',
          })),
        ),
    );
  }

  if (allowed('products.read')) {
    tasks.push(
      prisma.product
        .findMany({
          where: {
            companyId,
            OR: [{ name: contains }, { sku: contains }, { barcode: { equals: query } }],
          },
          take: PER_KIND,
          orderBy: { name: 'asc' },
          include: { category: { select: { name: true } } },
        })
        .then((rows) =>
          rows.map((row) => ({
            kind: 'product' as const,
            id: row.id,
            title: row.name,
            subtitle: [row.sku, row.category?.name].filter(Boolean).join(' · '),
            href: '/produits',
          })),
        ),
    );
  }

  if (allowed('invoices.read')) {
    tasks.push(
      prisma.invoice
        .findMany({
          where: {
            companyId,
            OR: [{ number: contains }, { customer: { name: contains } }],
          },
          take: PER_KIND,
          orderBy: { issueDate: 'desc' },
          include: { customer: { select: { name: true } } },
        })
        .then((rows) =>
          rows.map((row) => ({
            kind: 'invoice' as const,
            id: row.id,
            title: row.number,
            subtitle: [
              row.customer?.name ?? 'Client de passage',
              row.issueDate.toLocaleDateString('fr-FR'),
            ].join(' · '),
            href: `/factures/${row.id}`,
          })),
        ),
    );
  }

  if (allowed('quotes.read')) {
    tasks.push(
      prisma.quote
        .findMany({
          where: { companyId, OR: [{ number: contains }, { customer: { name: contains } }] },
          take: PER_KIND,
          orderBy: { issueDate: 'desc' },
          include: { customer: { select: { name: true } } },
        })
        .then((rows) =>
          rows.map((row) => ({
            kind: 'quote' as const,
            id: row.id,
            title: row.number,
            subtitle: [row.customer?.name ?? '—', row.issueDate.toLocaleDateString('fr-FR')].join(' · '),
            href: `/devis/${row.id}`,
          })),
        ),
    );
  }

  if (allowed('purchases.read')) {
    tasks.push(
      prisma.purchaseOrder
        .findMany({
          where: {
            companyId,
            OR: [{ number: contains }, { reference: contains }, { supplier: { name: contains } }],
          },
          take: PER_KIND,
          orderBy: { orderDate: 'desc' },
          include: { supplier: { select: { name: true } } },
        })
        .then((rows) =>
          rows.map((row) => ({
            kind: 'purchase' as const,
            id: row.id,
            title: row.number,
            subtitle: [row.supplier?.name ?? '—', row.orderDate.toLocaleDateString('fr-FR')].join(' · '),
            href: `/achats/${row.id}`,
          })),
        ),
    );
  }

  if (allowed('payments.read')) {
    tasks.push(
      prisma.payment
        .findMany({
          where: {
            companyId,
            OR: [{ number: contains }, { reference: contains }, { partner: { name: contains } }],
          },
          take: PER_KIND,
          orderBy: { paidAt: 'desc' },
          include: { partner: { select: { name: true } } },
        })
        .then((rows) =>
          rows.map((row) => ({
            kind: 'payment' as const,
            id: row.id,
            title: row.number,
            subtitle: [row.partner?.name ?? '—', row.paidAt.toLocaleDateString('fr-FR')].join(' · '),
            href: '/paiements',
          })),
        ),
    );
  }

  const results = await Promise.all(tasks);
  return results.flat();
}
