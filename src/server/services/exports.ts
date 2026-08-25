import { prisma } from '@/server/db';
import { formatMoney, toDecimalString, type CurrencyFormat } from '@/lib/money';
import { toQuantityString } from '@/lib/quantity';
import { listStock } from '@/server/services/stock-query';
import type { Period } from '@/server/services/reports';

/**
 * Exports CSV.
 *
 * Deux precautions qui font la difference entre un fichier exploitable et un
 * fichier qui casse le tableur du client :
 *
 *  1. **Le point decimal, jamais la virgule.** Un montant "1250,75" exporte
 *     dans un CSV separe par des virgules deplace toutes les colonnes. Les
 *     montants sortent donc en notation neutre ("1250.75"), que le tableur
 *     reconnait comme un nombre.
 *  2. **Neutralisation des formules.** Une cellule commencant par `=`, `+`, `-`
 *     ou `@` est interpretee comme une formule par Excel et LibreOffice. Un nom
 *     de client saisi comme `=cmd|...` devient une execution de commande a
 *     l'ouverture du fichier. Ces cellules sont prefixees d'une apostrophe.
 */

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function escapeCsvCell(value: string): string {
  let cell = value;

  // Injection de formule : le fichier est ouvert par un humain dans un tableur,
  // c'est donc bien une surface d'attaque.
  if (cell.length > 0 && FORMULA_PREFIXES.some((prefix) => cell.startsWith(prefix))) {
    cell = `'${cell}`;
  }

  if (/[",\n\r;]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(','));
  // BOM UTF-8 : sans lui, Excel sous Windows affiche "Ã©" a la place de "é".
  return `﻿${lines.join('\r\n')}\r\n`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface ExportContext {
  companyId: string;
  currency: CurrencyFormat;
  locale: string;
}

export async function exportCustomers(context: ExportContext): Promise<string> {
  const partners = await prisma.partner.findMany({
    where: { companyId: context.companyId, kind: 'CUSTOMER' },
    orderBy: { code: 'asc' },
  });

  return toCsv(
    [
      'Code', 'Nom', 'Entreprise', 'Téléphone', 'Second téléphone', 'Email',
      'Adresse', 'Ville', 'Pays', 'Identifiant fiscal', "Plafond d'encours", 'Actif', 'Notes',
    ],
    partners.map((partner) => [
      partner.code,
      partner.name,
      partner.companyName ?? '',
      partner.phone ?? '',
      partner.secondPhone ?? '',
      partner.email ?? '',
      partner.addressLine ?? '',
      partner.city ?? '',
      partner.countryCode ?? '',
      partner.taxNumber ?? '',
      toDecimalString(partner.creditLimit, context.currency.decimals),
      partner.isActive ? 'oui' : 'non',
      partner.notes ?? '',
    ]),
  );
}

export async function exportSuppliers(context: ExportContext): Promise<string> {
  const partners = await prisma.partner.findMany({
    where: { companyId: context.companyId, kind: 'SUPPLIER' },
    orderBy: { code: 'asc' },
  });

  return toCsv(
    ['Code', 'Nom', 'Entreprise', 'Téléphone', 'Email', 'Adresse', 'Ville', 'Pays', 'Identifiant fiscal', 'Actif'],
    partners.map((partner) => [
      partner.code,
      partner.name,
      partner.companyName ?? '',
      partner.phone ?? '',
      partner.email ?? '',
      partner.addressLine ?? '',
      partner.city ?? '',
      partner.countryCode ?? '',
      partner.taxNumber ?? '',
      partner.isActive ? 'oui' : 'non',
    ]),
  );
}

export async function exportProducts(context: ExportContext): Promise<string> {
  const products = await prisma.product.findMany({
    where: { companyId: context.companyId },
    include: {
      category: { select: { name: true } },
      unit: { select: { symbol: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  const decimals = context.currency.decimals;

  return toCsv(
    [
      'Référence', 'Nom', 'Type', 'Catégorie', 'Unité', 'Code-barres',
      "Prix d'achat", 'Prix de vente', 'Prix grossiste', 'À partir de',
      'Prix spécial', 'Stock minimum', 'Fournisseur', 'Actif',
    ],
    products.map((product) => [
      product.sku,
      product.name,
      product.kind === 'SERVICE' ? 'Service' : 'Produit',
      product.category?.name ?? '',
      product.unit?.symbol ?? '',
      product.barcode ?? '',
      toDecimalString(product.costPrice, decimals),
      toDecimalString(product.salePrice, decimals),
      product.wholesalePrice === null ? '' : toDecimalString(product.wholesalePrice, decimals),
      product.wholesaleFrom === null ? '' : toQuantityString(product.wholesaleFrom),
      product.specialPrice === null ? '' : toDecimalString(product.specialPrice, decimals),
      toQuantityString(product.minStock),
      product.supplier?.name ?? '',
      product.isActive ? 'oui' : 'non',
    ]),
  );
}

export async function exportInvoices(context: ExportContext, period: Period): Promise<string> {
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: context.companyId,
      issueDate: { gte: period.from, lte: period.to },
    },
    include: { customer: { select: { code: true, name: true } }, location: { select: { name: true } } },
    orderBy: { issueDate: 'asc' },
  });

  const decimals = context.currency.decimals;

  return toCsv(
    [
      'Numéro', 'Date', 'Échéance', 'Client', 'Code client', 'Point de vente',
      'Origine', 'Statut', 'Sous-total', 'Remise', 'Taxes', 'Total', 'Payé', 'Reste dû',
    ],
    invoices.map((invoice) => [
      invoice.number,
      formatDate(invoice.issueDate),
      invoice.dueDate ? formatDate(invoice.dueDate) : '',
      invoice.customer?.name ?? '',
      invoice.customer?.code ?? '',
      invoice.location?.name ?? '',
      invoice.origin === 'POS' ? 'Vente au comptoir' : 'Facture',
      invoice.status,
      toDecimalString(invoice.subtotal, decimals),
      toDecimalString(invoice.discountAmount, decimals),
      toDecimalString(invoice.taxTotal, decimals),
      toDecimalString(invoice.total, decimals),
      toDecimalString(invoice.paidAmount, decimals),
      toDecimalString(invoice.balanceDue, decimals),
    ]),
  );
}

/** Detail ligne a ligne des ventes : la base d'une analyse dans un tableur. */
export async function exportSaleLines(context: ExportContext, period: Period): Promise<string> {
  const lines = await prisma.invoiceLine.findMany({
    where: {
      invoice: {
        companyId: context.companyId,
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        issueDate: { gte: period.from, lte: period.to },
      },
    },
    include: {
      invoice: {
        select: { number: true, issueDate: true, customer: { select: { name: true } } },
      },
      product: { select: { sku: true, unit: { select: { symbol: true } } } },
    },
    orderBy: { invoice: { issueDate: 'asc' } },
  });

  const decimals = context.currency.decimals;

  return toCsv(
    [
      'Facture', 'Date', 'Client', 'Référence', 'Désignation', 'Quantité', 'Unité',
      'Prix unitaire', 'Remise %', 'Base taxable', 'Taxe', 'Total ligne', "Coût d'achat unitaire",
    ],
    lines.map((line) => [
      line.invoice.number,
      formatDate(line.invoice.issueDate),
      line.invoice.customer?.name ?? '',
      line.product?.sku ?? '',
      line.description,
      toQuantityString(line.quantity),
      line.product?.unit?.symbol ?? '',
      toDecimalString(line.unitPrice, decimals),
      (line.discountRate / 100).toFixed(2),
      toDecimalString(line.taxable, decimals),
      toDecimalString(line.taxAmount, decimals),
      toDecimalString(line.lineTotal, decimals),
      toDecimalString(line.unitCost, decimals),
    ]),
  );
}

export async function exportPayments(context: ExportContext, period: Period): Promise<string> {
  const payments = await prisma.payment.findMany({
    where: { companyId: context.companyId, paidAt: { gte: period.from, lte: period.to } },
    include: {
      partner: { select: { name: true } },
      invoice: { select: { number: true } },
      order: { select: { number: true } },
      method: { select: { name: true } },
    },
    orderBy: { paidAt: 'asc' },
  });

  return toCsv(
    ['Numéro', 'Date', 'Sens', 'Tiers', 'Facture', 'Commande', 'Mode', 'Référence', 'Montant'],
    payments.map((payment) => [
      payment.number,
      formatDate(payment.paidAt),
      payment.direction === 'IN' ? 'Encaissement' : 'Decaissement',
      payment.partner?.name ?? '',
      payment.invoice?.number ?? '',
      payment.order?.number ?? '',
      payment.method?.name ?? '',
      payment.reference ?? '',
      toDecimalString(payment.amount, context.currency.decimals),
    ]),
  );
}

export async function exportExpenses(context: ExportContext, period: Period): Promise<string> {
  const expenses = await prisma.expense.findMany({
    where: { companyId: context.companyId, spentAt: { gte: period.from, lte: period.to } },
    include: {
      category: { select: { name: true } },
      location: { select: { name: true } },
      supplier: { select: { name: true } },
      method: { select: { name: true } },
    },
    orderBy: { spentAt: 'asc' },
  });

  return toCsv(
    ['Numéro', 'Date', 'Catégorie', 'Description', 'Fournisseur', 'Mode', 'Point de vente', 'Référence', 'Montant'],
    expenses.map((expense) => [
      expense.number,
      formatDate(expense.spentAt),
      expense.category?.name ?? '',
      expense.description,
      expense.supplier?.name ?? '',
      expense.method?.name ?? '',
      expense.location?.name ?? '',
      expense.reference ?? '',
      toDecimalString(expense.amount, context.currency.decimals),
    ]),
  );
}

export async function exportStock(context: ExportContext, locationId?: string): Promise<string> {
  const stock = await listStock(context.companyId, { page: 1, pageSize: 10_000, locationId });

  return toCsv(
    ['Référence', 'Article', 'Catégorie', 'Unité', 'Quantité', 'Stock minimum', "Prix d'achat", 'Valeur', 'État'],
    stock.items.map((row) => [
      row.sku,
      row.name,
      row.categoryName,
      row.unitSymbol,
      toQuantityString(row.quantity),
      toQuantityString(row.minStock),
      toDecimalString(row.costPrice, context.currency.decimals),
      toDecimalString(row.value, context.currency.decimals),
      row.isOut ? 'Rupture' : row.isLow ? 'Stock faible' : 'Disponible',
    ]),
  );
}

export async function exportStockMovements(
  context: ExportContext,
  period: Period,
): Promise<string> {
  const movements = await prisma.stockMovement.findMany({
    where: { companyId: context.companyId, createdAt: { gte: period.from, lte: period.to } },
    include: {
      product: { select: { sku: true, name: true } },
      location: { select: { name: true } },
      user: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return toCsv(
    ['Date', 'Référence article', 'Article', 'Point de vente', 'Type', 'Variation', 'Stock après', 'Motif', 'Référence', 'Utilisateur'],
    movements.map((movement) => [
      movement.createdAt.toISOString(),
      movement.product.sku,
      movement.product.name,
      movement.location.name,
      movement.kind,
      toQuantityString(movement.quantity),
      toQuantityString(movement.quantityAfter),
      movement.reason ?? '',
      movement.reference ?? '',
      movement.user?.fullName ?? '',
    ]),
  );
}

/** Creances clients : la liste a utiliser pour relancer. */
export async function exportReceivables(context: ExportContext): Promise<string> {
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: context.companyId,
      status: { notIn: ['CANCELLED', 'DRAFT'] },
      balanceDue: { gt: 0n },
    },
    include: { customer: { select: { code: true, name: true, phone: true } } },
    orderBy: { dueDate: 'asc' },
  });

  const now = Date.now();

  return toCsv(
    ['Facture', 'Date', 'Échéance', 'Jours de retard', 'Code client', 'Client', 'Téléphone', 'Total', 'Payé', 'Reste dû'],
    invoices.map((invoice) => {
      const overdueDays =
        invoice.dueDate && invoice.dueDate.getTime() < now
          ? Math.floor((now - invoice.dueDate.getTime()) / 86_400_000)
          : 0;

      return [
        invoice.number,
        formatDate(invoice.issueDate),
        invoice.dueDate ? formatDate(invoice.dueDate) : '',
        String(overdueDays),
        invoice.customer?.code ?? '',
        invoice.customer?.name ?? '',
        invoice.customer?.phone ?? '',
        toDecimalString(invoice.total, context.currency.decimals),
        toDecimalString(invoice.paidAmount, context.currency.decimals),
        toDecimalString(invoice.balanceDue, context.currency.decimals),
      ];
    }),
  );
}

export async function exportPayables(context: ExportContext): Promise<string> {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      companyId: context.companyId,
      status: { notIn: ['CANCELLED', 'DRAFT'] },
      balanceDue: { gt: 0n },
    },
    include: { supplier: { select: { code: true, name: true, phone: true } } },
    orderBy: { dueDate: 'asc' },
  });

  return toCsv(
    ['Commande', 'Date', 'Échéance', 'Code fournisseur', 'Fournisseur', 'Téléphone', 'Total', 'Réglé', 'Reste dû'],
    orders.map((order) => [
      order.number,
      formatDate(order.orderDate),
      order.dueDate ? formatDate(order.dueDate) : '',
      order.supplier?.code ?? '',
      order.supplier?.name ?? '',
      order.supplier?.phone ?? '',
      toDecimalString(order.total, context.currency.decimals),
      toDecimalString(order.paidAmount, context.currency.decimals),
      toDecimalString(order.balanceDue, context.currency.decimals),
    ]),
  );
}

export const EXPORTS = {
  clients: { label: 'Clients', permission: 'customers.read', needsPeriod: false },
  fournisseurs: { label: 'Fournisseurs', permission: 'suppliers.read', needsPeriod: false },
  produits: { label: 'Produits et services', permission: 'products.read', needsPeriod: false },
  factures: { label: 'Factures', permission: 'invoices.read', needsPeriod: true },
  'lignes-de-vente': { label: 'Détail des ventes', permission: 'invoices.read', needsPeriod: true },
  paiements: { label: 'Paiements', permission: 'payments.read', needsPeriod: true },
  depenses: { label: 'Dépenses', permission: 'expenses.read', needsPeriod: true },
  stock: { label: 'État du stock', permission: 'stock.read', needsPeriod: false },
  'mouvements-de-stock': { label: 'Mouvements de stock', permission: 'stock.read', needsPeriod: true },
  creances: { label: 'Créances clients', permission: 'invoices.read', needsPeriod: false },
  dettes: { label: 'Dettes fournisseur', permission: 'purchases.read', needsPeriod: false },
} as const;

export type ExportKey = keyof typeof EXPORTS;

export function isExportKey(value: string): value is ExportKey {
  return value in EXPORTS;
}

export async function runExport(
  key: ExportKey,
  context: ExportContext,
  period: Period,
  locationId?: string,
): Promise<string> {
  switch (key) {
    case 'clients':
      return exportCustomers(context);
    case 'fournisseurs':
      return exportSuppliers(context);
    case 'produits':
      return exportProducts(context);
    case 'factures':
      return exportInvoices(context, period);
    case 'lignes-de-vente':
      return exportSaleLines(context, period);
    case 'paiements':
      return exportPayments(context, period);
    case 'depenses':
      return exportExpenses(context, period);
    case 'stock':
      return exportStock(context, locationId);
    case 'mouvements-de-stock':
      return exportStockMovements(context, period);
    case 'creances':
      return exportReceivables(context);
    case 'dettes':
      return exportPayables(context);
  }
}

export { formatMoney };
