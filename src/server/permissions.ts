/**
 * Catalogue de permissions granulaires.
 *
 * Une permission est une chaine "<domaine>.<action>". Les roles en portent une
 * liste ; la verification est faite cote serveur, dans `requirePermission`.
 * L'interface se contente de masquer ce qui est de toute facon refuse.
 */

export const PERMISSION_GROUPS = [
  {
    key: 'dashboard',
    label: 'Tableau de bord',
    permissions: [{ key: 'dashboard.view', label: 'Consulter le tableau de bord' }],
  },
  {
    key: 'customers',
    label: 'Clients',
    permissions: [
      { key: 'customers.read', label: 'Consulter les clients' },
      { key: 'customers.write', label: 'Créer et modifier les clients' },
      { key: 'customers.delete', label: 'Supprimer les clients' },
    ],
  },
  {
    key: 'suppliers',
    label: 'Fournisseurs',
    permissions: [
      { key: 'suppliers.read', label: 'Consulter les fournisseurs' },
      { key: 'suppliers.write', label: 'Créer et modifier les fournisseurs' },
      { key: 'suppliers.delete', label: 'Supprimer les fournisseurs' },
    ],
  },
  {
    key: 'products',
    label: 'Produits et services',
    permissions: [
      { key: 'products.read', label: 'Consulter le catalogue' },
      { key: 'products.write', label: 'Créer et modifier les articles' },
      { key: 'products.delete', label: 'Supprimer les articles' },
      { key: 'products.cost.read', label: "Voir les prix d'achat" },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    permissions: [
      { key: 'stock.read', label: 'Consulter le stock' },
      { key: 'stock.move', label: 'Enregistrer entrées, sorties et transferts' },
      { key: 'stock.adjust', label: 'Ajuster le stock et faire un inventaire' },
    ],
  },
  {
    key: 'sales',
    label: 'Ventes',
    permissions: [
      { key: 'sales.read', label: 'Consulter les ventes' },
      { key: 'sales.create', label: 'Enregistrer une vente' },
      { key: 'sales.cancel', label: 'Annuler une vente' },
      { key: 'sales.discount', label: 'Appliquer une remise' },
    ],
  },
  {
    key: 'quotes',
    label: 'Devis',
    permissions: [
      { key: 'quotes.read', label: 'Consulter les devis' },
      { key: 'quotes.write', label: 'Créer et modifier les devis' },
      { key: 'quotes.convert', label: 'Convertir un devis en facture' },
    ],
  },
  {
    key: 'invoices',
    label: 'Factures',
    permissions: [
      { key: 'invoices.read', label: 'Consulter les factures' },
      { key: 'invoices.write', label: 'Créer et modifier les factures' },
      { key: 'invoices.cancel', label: 'Annuler une facture' },
    ],
  },
  {
    key: 'payments',
    label: 'Paiements',
    permissions: [
      { key: 'payments.read', label: 'Consulter les paiements' },
      { key: 'payments.create', label: 'Enregistrer un paiement' },
      { key: 'payments.delete', label: 'Annuler un paiement' },
    ],
  },
  {
    key: 'purchases',
    label: 'Achats',
    permissions: [
      { key: 'purchases.read', label: 'Consulter les achats' },
      { key: 'purchases.write', label: 'Créer et modifier les commandes fournisseur' },
      { key: 'purchases.receive', label: 'Réceptionner une commande' },
    ],
  },
  {
    key: 'expenses',
    label: 'Dépenses',
    permissions: [
      { key: 'expenses.read', label: 'Consulter les dépenses' },
      { key: 'expenses.write', label: 'Enregistrer une dépense' },
      { key: 'expenses.delete', label: 'Supprimer une dépense' },
    ],
  },
  {
    key: 'cash',
    label: 'Caisse',
    permissions: [
      { key: 'cash.read', label: 'Consulter la caisse' },
      { key: 'cash.operate', label: 'Ouvrir, fermer et mouvementer la caisse' },
    ],
  },
  {
    key: 'reports',
    label: 'Rapports',
    permissions: [
      { key: 'reports.view', label: 'Consulter les rapports' },
      { key: 'reports.export', label: 'Exporter les rapports' },
    ],
  },
  {
    key: 'settings',
    label: 'Administration',
    permissions: [
      { key: 'settings.company', label: "Modifier les paramètres de l'entreprise" },
      { key: 'settings.locations', label: 'Gérer les points de vente' },
      { key: 'settings.users', label: 'Gérer les utilisateurs' },
      { key: 'settings.roles', label: 'Gérer les rôles et permissions' },
      { key: 'settings.audit', label: "Consulter le journal d'audit" },
      { key: 'settings.import', label: 'Importer et exporter des données' },
    ],
  },
] as const;

export type PermissionKey =
  (typeof PERMISSION_GROUPS)[number]['permissions'][number]['key'];

export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.key),
);

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_SET.has(value);
}

/**
 * `*` accorde tout : c'est le marqueur de l'administrateur. Il est resolu ici
 * plutot que duplique dans chaque appelant.
 */
export const WILDCARD = '*';

export function hasPermission(granted: readonly string[], required: PermissionKey): boolean {
  if (granted.includes(WILDCARD)) return true;
  return granted.includes(required);
}

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

/**
 * Roles fournis a la creation d'une entreprise. Ils sont copies dans la table
 * `roles` (avec `companyId`), ce qui permet a chaque entreprise de les ajuster
 * ensuite sans impacter les autres.
 */
export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: 'ADMIN',
    name: 'Administrateur',
    description: "Accès complet à toutes les fonctionnalités de l'entreprise.",
    permissions: [WILDCARD],
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Gestion opérationnelle complète et accès aux rapports.',
    permissions: ALL_PERMISSIONS.filter(
      (permission) =>
        !['settings.users', 'settings.roles', 'settings.company'].includes(permission),
    ),
  },
  {
    key: 'SALES',
    name: 'Commercial',
    description: 'Clients, ventes, devis et factures.',
    permissions: [
      'dashboard.view',
      'customers.read',
      'customers.write',
      'products.read',
      'stock.read',
      'sales.read',
      'sales.create',
      'sales.discount',
      'quotes.read',
      'quotes.write',
      'quotes.convert',
      'invoices.read',
      'invoices.write',
      'payments.read',
      'payments.create',
      'reports.view',
    ],
  },
  {
    key: 'STOCK',
    name: 'Gestionnaire de stock',
    description: 'Catalogue produits, stock et réceptions fournisseur.',
    permissions: [
      'dashboard.view',
      'products.read',
      'products.write',
      'products.cost.read',
      'suppliers.read',
      'stock.read',
      'stock.move',
      'stock.adjust',
      'purchases.read',
      'purchases.write',
      'purchases.receive',
      'reports.view',
    ],
  },
  {
    key: 'CASHIER',
    name: 'Caissier',
    description: 'Ventes au comptoir, encaissements et caisse.',
    permissions: [
      'dashboard.view',
      'customers.read',
      'customers.write',
      'products.read',
      'stock.read',
      'sales.read',
      'sales.create',
      'invoices.read',
      'payments.read',
      'payments.create',
      'cash.read',
      'cash.operate',
      'expenses.read',
      'expenses.write',
    ],
  },
];
