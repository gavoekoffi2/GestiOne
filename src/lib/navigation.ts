import type { PermissionKey } from '@/server/permissions';

/**
 * Navigation principale. Chaque entree declare la permission qui la conditionne :
 * le menu est ainsi le reflet exact des droits, sans logique dupliquee.
 *
 * Masquer une entree n'est pas une mesure de securite — la route elle-meme
 * revalide la permission cote serveur.
 */
export interface NavItem {
  href: string;
  label: string;
  permission: PermissionKey;
  icon: string;
  /**
   * Phase du plan de developpement qui livre cet ecran. Une entree dont la
   * phase n'est pas encore livree est retiree du menu : GestiOne n'affiche
   * jamais un lien qui ne mene nulle part.
   */
  phase?: number;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    label: 'Pilotage',
    items: [
      { href: '/tableau-de-bord', label: 'Tableau de bord', permission: 'dashboard.view', icon: 'home' },
      { href: '/rapports', label: 'Rapports', permission: 'reports.view', icon: 'chart', phase: 6 },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { href: '/ventes', label: 'Ventes', permission: 'sales.read', icon: 'cart', phase: 4 },
      { href: '/devis', label: 'Devis', permission: 'quotes.read', icon: 'file', phase: 4 },
      { href: '/factures', label: 'Factures', permission: 'invoices.read', icon: 'receipt', phase: 4 },
      { href: '/paiements', label: 'Paiements', permission: 'payments.read', icon: 'wallet', phase: 4 },
      { href: '/clients', label: 'Clients', permission: 'customers.read', icon: 'users', phase: 2 },
    ],
  },
  {
    label: 'Approvisionnement',
    items: [
      { href: '/produits', label: 'Produits et services', permission: 'products.read', icon: 'box', phase: 2 },
      { href: '/stock', label: 'Stock', permission: 'stock.read', icon: 'layers', phase: 3 },
      { href: '/achats', label: 'Achats', permission: 'purchases.read', icon: 'truck', phase: 5 },
      { href: '/fournisseurs', label: 'Fournisseurs', permission: 'suppliers.read', icon: 'building', phase: 2 },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/caisse', label: 'Caisse', permission: 'cash.read', icon: 'cash', phase: 5 },
      { href: '/depenses', label: 'Depenses', permission: 'expenses.read', icon: 'minus', phase: 5 },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/parametres', label: "Parametres de l'entreprise", permission: 'settings.company', icon: 'settings' },
      { href: '/parametres/points-de-vente', label: 'Points de vente', permission: 'settings.locations', icon: 'pin' },
      { href: '/parametres/utilisateurs', label: 'Utilisateurs', permission: 'settings.users', icon: 'user-plus' },
      { href: '/parametres/roles', label: 'Roles et permissions', permission: 'settings.roles', icon: 'shield' },
      { href: '/parametres/audit', label: "Journal d'audit", permission: 'settings.audit', icon: 'list' },
    ],
  },
];

/** Derniere phase effectivement livree. Voir docs/ARCHITECTURE.md. */
export const SHIPPED_PHASE = 2;

/**
 * Menu reellement affiche : uniquement les ecrans livres, et uniquement ceux
 * que le role de l'utilisateur autorise.
 */
export function visibleNavigation(
  permissions: readonly string[],
  hasPermissionFn: (granted: readonly string[], required: PermissionKey) => boolean,
): NavSection[] {
  return NAVIGATION.map((section) => ({
    label: section.label,
    items: section.items.filter(
      (item) =>
        (item.phase ?? 0) <= SHIPPED_PHASE && hasPermissionFn(permissions, item.permission),
    ),
  })).filter((section) => section.items.length > 0);
}
