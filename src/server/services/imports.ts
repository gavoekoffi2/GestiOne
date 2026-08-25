import { prisma } from '@/server/db';
import { ValidationError } from '@/server/errors';
import { MoneyError, parseAmount, type CurrencyFormat } from '@/lib/money';
import { QuantityError, parseQuantity } from '@/lib/quantity';
import { cell, mapColumns, parseCsv, type ColumnDefinition } from '@/lib/csv';
import { createPartner } from '@/server/services/partners';
import { createProduct } from '@/server/services/catalog';

/**
 * Import de clients et de produits depuis un fichier CSV.
 *
 * Le flux est en deux temps, et c'est essentiel : **analyser puis importer**.
 * L'utilisateur voit d'abord ce qui sera cree, ce qui sera ignore et pourquoi,
 * avant que quoi que ce soit ne touche la base. Un import qui ecrit d'abord et
 * signale les erreurs ensuite laisse une base a moitie remplie que personne ne
 * sait nettoyer.
 *
 * Les doublons sont **detectes et ignores**, jamais ecrases : un fichier
 * reimporte par erreur ne doit pas remplacer des donnees corrigees a la main.
 */

export type RowStatus = 'ready' | 'duplicate' | 'error';

export interface PreviewRow {
  line: number;
  status: RowStatus;
  message?: string;
  values: Record<string, string>;
}

export interface ImportPreview {
  columns: string[];
  detectedDelimiter: string;
  missingColumns: string[];
  rows: PreviewRow[];
  readyCount: number;
  duplicateCount: number;
  errorCount: number;
}

const CUSTOMER_COLUMNS: ColumnDefinition[] = [
  { key: 'name', label: 'Nom', aliases: ['Client', 'Nom du client'], required: true },
  { key: 'companyName', label: 'Entreprise', aliases: ['Société', 'Raison sociale'] },
  { key: 'phone', label: 'Téléphone', aliases: ['Tel', 'Numéro', 'Contact'] },
  { key: 'secondPhone', label: 'Second téléphone', aliases: ['Tel 2'] },
  { key: 'email', label: 'Email', aliases: ['Courriel', 'Adresse email'] },
  { key: 'addressLine', label: 'Adresse' },
  { key: 'city', label: 'Ville' },
  { key: 'countryCode', label: 'Pays', aliases: ['Code pays'] },
  { key: 'taxNumber', label: 'Identifiant fiscal', aliases: ['NIF', 'RCCM'] },
  { key: 'creditLimit', label: "Plafond d'encours", aliases: ['Plafond', 'Crédit'] },
  { key: 'notes', label: 'Notes', aliases: ['Remarques'] },
];

const PRODUCT_COLUMNS: ColumnDefinition[] = [
  { key: 'name', label: 'Nom', aliases: ['Article', 'Désignation', 'Produit'], required: true },
  { key: 'sku', label: 'Référence', aliases: ['SKU', 'Code'] },
  { key: 'barcode', label: 'Code-barres', aliases: ['EAN', 'Code barre'] },
  { key: 'category', label: 'Catégorie', aliases: ['Famille'] },
  { key: 'unit', label: 'Unité', aliases: ['Unité de mesure'] },
  { key: 'costPrice', label: "Prix d'achat", aliases: ['Coût', 'Achat', 'Prix achat'], required: true },
  { key: 'salePrice', label: 'Prix de vente', aliases: ['Prix', 'Vente', 'Prix vente'], required: true },
  { key: 'wholesalePrice', label: 'Prix grossiste', aliases: ['Prix gros'] },
  { key: 'minStock', label: 'Stock minimum', aliases: ['Seuil', 'Stock mini'] },
  { key: 'description', label: 'Description' },
];

export const IMPORT_TARGETS = {
  clients: { label: 'Clients', columns: CUSTOMER_COLUMNS, permission: 'customers.write' },
  produits: { label: 'Produits', columns: PRODUCT_COLUMNS, permission: 'products.write' },
} as const;

export type ImportTarget = keyof typeof IMPORT_TARGETS;

export function isImportTarget(value: string): value is ImportTarget {
  return value in IMPORT_TARGETS;
}

/** Modele de fichier propose au telechargement, pour eviter les colonnes devinees. */
export function templateFor(target: ImportTarget): string {
  const columns = IMPORT_TARGETS[target].columns;
  const header = columns.map((column) => column.label).join(',');
  const example =
    target === 'clients'
      ? 'Ama Diallo,Boutique Ama,+225 07 11 22 33 44,,ama@exemple.ci,Rue 12,Abidjan,CI,,250000,'
      : 'Sac de riz 25 kg,RIZ25,6001234567890,Alimentaire,sac,12000,15000,14000,5,';
  return `﻿${header}\r\n${example}\r\n`;
}

function optional(value: string): string | undefined {
  return value === '' ? undefined : value;
}

/**
 * Analyse le fichier et rend un apercu ligne a ligne. **Aucune ecriture.**
 */
export async function previewImport(
  companyId: string,
  target: ImportTarget,
  content: string,
  currency: CurrencyFormat,
): Promise<ImportPreview> {
  const parsed = parseCsv(content);
  const definition = IMPORT_TARGETS[target];
  const { mapping, missing } = mapColumns(parsed.headers, definition.columns);

  if (missing.length > 0) {
    return {
      columns: parsed.headers,
      detectedDelimiter: parsed.delimiter,
      missingColumns: missing,
      rows: [],
      readyCount: 0,
      duplicateCount: 0,
      errorCount: 0,
    };
  }

  // On charge une seule fois les valeurs existantes : interroger la base ligne
  // par ligne rendrait un import de mille articles interminable.
  const existing =
    target === 'clients'
      ? new Set(
          (
            await prisma.partner.findMany({
              where: { companyId, kind: 'CUSTOMER' },
              select: { name: true },
            })
          ).map((partner) => partner.name.trim().toLowerCase()),
        )
      : new Set(
          (
            await prisma.product.findMany({ where: { companyId }, select: { name: true } })
          ).map((product) => product.name.trim().toLowerCase()),
        );

  // Les doublons a l'interieur du fichier lui-meme comptent aussi.
  const seen = new Set<string>();
  const rows: PreviewRow[] = [];

  parsed.rows.forEach((row, index) => {
    const line = index + 2; // +1 pour l'en-tete, +1 pour compter a partir de 1
    const values: Record<string, string> = {};
    for (const column of definition.columns) {
      values[column.key] = cell(row, mapping, column.key);
    }

    const name = values.name ?? '';
    if (!name) {
      rows.push({ line, status: 'error', message: 'Le nom est vide.', values });
      return;
    }

    const key = name.trim().toLowerCase();
    if (existing.has(key)) {
      rows.push({ line, status: 'duplicate', message: 'Existe déjà — sera ignore.', values });
      return;
    }
    if (seen.has(key)) {
      rows.push({ line, status: 'duplicate', message: 'En double dans le fichier.', values });
      return;
    }

    const error = validateRow(target, values, currency);
    if (error) {
      rows.push({ line, status: 'error', message: error, values });
      return;
    }

    seen.add(key);
    rows.push({ line, status: 'ready', values });
  });

  return {
    columns: parsed.headers,
    detectedDelimiter: parsed.delimiter,
    missingColumns: [],
    rows,
    readyCount: rows.filter((row) => row.status === 'ready').length,
    duplicateCount: rows.filter((row) => row.status === 'duplicate').length,
    errorCount: rows.filter((row) => row.status === 'error').length,
  };
}

function validateRow(
  target: ImportTarget,
  values: Record<string, string>,
  currency: CurrencyFormat,
): string | null {
  const money = (raw: string, label: string): string | null => {
    if (!raw) return null;
    try {
      const parsed = parseAmount(raw, currency.decimals);
      if (parsed < 0n) return `${label} ne peut pas être négatif.`;
      return null;
    } catch (error) {
      return error instanceof MoneyError ? `${label} : montant invalide ("${raw}").` : `${label} invalide.`;
    }
  };

  if (target === 'clients') {
    return money(values.creditLimit ?? '', "Le plafond d'encours");
  }

  const cost = money(values.costPrice ?? '', "Le prix d'achat");
  if (cost) return cost;
  const sale = money(values.salePrice ?? '', 'Le prix de vente');
  if (sale) return sale;
  const wholesale = money(values.wholesalePrice ?? '', 'Le prix grossiste');
  if (wholesale) return wholesale;

  if (values.minStock) {
    try {
      const quantity = parseQuantity(values.minStock);
      if (quantity < 0n) return 'Le stock minimum ne peut pas être négatif.';
    } catch (error) {
      return error instanceof QuantityError
        ? `Stock minimum invalide ("${values.minStock}").`
        : 'Stock minimum invalide.';
    }
  }

  return null;
}

export interface ImportResult {
  created: number;
  skipped: number;
  failed: Array<{ line: number; message: string }>;
}

/**
 * Importe les lignes exploitables de l'apercu.
 *
 * Chaque ligne est creee independamment : une ligne fautive n'annule pas les
 * autres. C'est le bon compromis pour un import de reference — echouer sur la
 * ligne 847 d'un fichier de mille articles et tout perdre serait pire que d'en
 * importer 999 et de signaler la derniere.
 */
export async function runImport(
  companyId: string,
  target: ImportTarget,
  content: string,
  currency: CurrencyFormat,
): Promise<ImportResult> {
  const preview = await previewImport(companyId, target, content, currency);

  if (preview.missingColumns.length > 0) {
    throw new ValidationError(
      `Colonnes obligatoires absentes du fichier : ${preview.missingColumns.join(', ')}.`,
    );
  }

  const failed: ImportResult['failed'] = [];
  let created = 0;

  // Le catalogue a besoin des categories et unites existantes pour rattacher
  // les articles ; les categories manquantes sont creees au fil de l'import.
  const categories = new Map<string, string>();
  const units = new Map<string, string>();

  if (target === 'produits') {
    for (const category of await prisma.category.findMany({ where: { companyId } })) {
      categories.set(category.name.trim().toLowerCase(), category.id);
    }
    for (const unit of await prisma.unit.findMany({ where: { companyId } })) {
      units.set(unit.symbol.trim().toLowerCase(), unit.id);
      units.set(unit.name.trim().toLowerCase(), unit.id);
    }
  }

  for (const row of preview.rows) {
    if (row.status !== 'ready') continue;

    try {
      if (target === 'clients') {
        await createPartner(companyId, 'CUSTOMER', {
          name: row.values.name as string,
          companyName: optional(row.values.companyName ?? ''),
          phone: optional(row.values.phone ?? ''),
          secondPhone: optional(row.values.secondPhone ?? ''),
          email: optional(row.values.email ?? ''),
          addressLine: optional(row.values.addressLine ?? ''),
          city: optional(row.values.city ?? ''),
          countryCode: optional((row.values.countryCode ?? '').toUpperCase()),
          taxNumber: optional(row.values.taxNumber ?? ''),
          creditLimit: row.values.creditLimit
            ? parseAmount(row.values.creditLimit, currency.decimals)
            : 0n,
          notes: optional(row.values.notes ?? ''),
          isActive: true,
        });
      } else {
        const categoryName = (row.values.category ?? '').trim();
        let categoryId: string | undefined;
        if (categoryName) {
          const key = categoryName.toLowerCase();
          if (!categories.has(key)) {
            const category = await prisma.category.create({
              data: { companyId, name: categoryName },
            });
            categories.set(key, category.id);
          }
          categoryId = categories.get(key);
        }

        const unitKey = (row.values.unit ?? '').trim().toLowerCase();

        await createProduct(companyId, {
          kind: 'GOOD',
          name: row.values.name as string,
          sku: optional(row.values.sku ?? ''),
          barcode: optional(row.values.barcode ?? ''),
          description: optional(row.values.description ?? ''),
          categoryId,
          // Une unite inconnue n'est pas creee a l'aveugle : l'article est
          // importe sans unite, et l'utilisateur la renseignera.
          unitId: unitKey ? units.get(unitKey) : undefined,
          supplierId: undefined,
          costPrice: parseAmount(row.values.costPrice || '0', currency.decimals),
          salePrice: parseAmount(row.values.salePrice || '0', currency.decimals),
          wholesalePrice: row.values.wholesalePrice
            ? parseAmount(row.values.wholesalePrice, currency.decimals)
            : undefined,
          wholesaleFrom: 0n,
          specialPrice: undefined,
          minStock: row.values.minStock ? parseQuantity(row.values.minStock) : 0n,
          isActive: true,
        });
      }

      created += 1;
    } catch (error) {
      failed.push({
        line: row.line,
        message: error instanceof Error ? error.message : 'Erreur inconnue.',
      });
    }
  }

  return { created, skipped: preview.duplicateCount + preview.errorCount, failed };
}
