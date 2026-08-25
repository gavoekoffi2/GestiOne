import { prisma } from '@/server/db';

/**
 * Etat reel de configuration d'une entreprise.
 *
 * Chaque element est calcule a partir de la base : le tableau de bord ne montre
 * jamais une etape "faite" qui ne l'est pas, ni un compteur invente.
 *
 * Deux familles d'etapes cohabitent, et l'ordre compte :
 *
 *  * les **premiers pas** conduisent a la premiere vente. C'est le seul chemin
 *    qui interesse un commercant le jour ou il ouvre GestiOne ; tant qu'il
 *    n'est pas termine, l'application n'est qu'une suite d'ecrans a zero.
 *  * la **configuration** (fiche entreprise, identifiant fiscal, equipe) rend
 *    les documents conformes et le compte partageable. Elle peut attendre.
 */

export interface SetupStep {
  key: string;
  label: string;
  description: string;
  done: boolean;
  href?: string;
  permission?: string;
  /** Libelle du bouton qui mene a l'ecran concerne. */
  action?: string;
}

export interface CompanyOverview {
  userCount: number;
  activeUserCount: number;
  locationCount: number;
  roleCount: number;
  auditCount: number;
  /** Etapes menant a la premiere vente. */
  firstSteps: SetupStep[];
  /** Etapes de configuration, sans urgence operationnelle. */
  steps: SetupStep[];
  completedSteps: number;
  /** L'entreprise a-t-elle deja vendu ? Sert a masquer le guide ensuite. */
  hasActivity: boolean;
}

export async function getCompanyOverview(companyId: string): Promise<CompanyOverview> {
  const [
    company,
    memberships,
    activeMemberships,
    locations,
    roles,
    auditCount,
    productCount,
    stockedCount,
    customerCount,
    invoiceCount,
  ] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        logoUrl: true,
        phone: true,
        email: true,
        addressLine: true,
        taxNumber: true,
        currencyCode: true,
      },
    }),
    prisma.membership.count({ where: { companyId } }),
    prisma.membership.count({ where: { companyId, isActive: true } }),
    prisma.location.count({ where: { companyId, isActive: true } }),
    prisma.role.count({ where: { companyId } }),
    prisma.auditLog.count({ where: { companyId } }),
    prisma.product.count({ where: { companyId, isActive: true } }),
    prisma.stockLevel.count({ where: { companyId, quantity: { gt: 0n } } }),
    prisma.partner.count({ where: { companyId, kind: 'CUSTOMER' } }),
    prisma.invoice.count({ where: { companyId, status: { not: 'CANCELLED' } } }),
  ]);

  const firstSteps: SetupStep[] = [
    {
      key: 'products',
      label: 'Ajoutez vos articles',
      description: 'Ce que vous vendez, à quel prix. Sans catalogue, rien ne peut être vendu.',
      done: productCount > 0,
      href: '/produits',
      action: 'Ajouter un article',
      permission: 'products.write',
    },
    {
      key: 'stock',
      label: 'Entrez vos quantités en stock',
      description:
        'GestiOne refuse une vente sans stock : saisissez ce que vous avez en boutique.',
      done: stockedCount > 0,
      href: '/stock',
      action: 'Faire une entrée de stock',
      permission: 'stock.write',
    },
    {
      key: 'sale',
      label: 'Faites votre première vente',
      description: 'Le panier encaisse, met le stock à jour et édite le reçu en une fois.',
      done: invoiceCount > 0,
      href: '/ventes',
      action: 'Vendre',
      permission: 'sales.create',
    },
    {
      key: 'customers',
      label: 'Enregistrez vos clients réguliers',
      description: "Nécessaire pour facturer à crédit et suivre ce que l'on vous doit.",
      done: customerCount > 0,
      href: '/clients',
      action: 'Ajouter un client',
      permission: 'customers.write',
    },
  ];

  const steps: SetupStep[] = [
    {
      key: 'company',
      label: 'Compléter la fiche entreprise',
      description: 'Adresse, téléphone et email apparaissent sur vos factures et vos devis.',
      done: Boolean(company.addressLine && company.phone),
      href: '/parametres',
      action: 'Compléter',
      permission: 'settings.company',
    },
    {
      key: 'identity',
      label: 'Ajouter votre identifiant fiscal',
      description: 'NIF, RCCM ou numéro de TVA selon votre pays.',
      done: Boolean(company.taxNumber),
      href: '/parametres',
      action: 'Renseigner',
      permission: 'settings.company',
    },
    {
      key: 'locations',
      label: 'Déclarer vos points de vente',
      description: 'Boutiques, dépôts ou agences : chacun aura son stock et sa caisse.',
      done: locations > 1,
      href: '/parametres/points-de-vente',
      action: 'Ajouter un point de vente',
      permission: 'settings.locations',
    },
    {
      key: 'team',
      label: 'Inviter votre équipe',
      description: 'Chaque collaborateur reçoit un rôle et uniquement les droits nécessaires.',
      done: memberships > 1,
      href: '/parametres/utilisateurs',
      action: 'Inviter',
      permission: 'settings.users',
    },
  ];

  return {
    userCount: memberships,
    activeUserCount: activeMemberships,
    locationCount: locations,
    roleCount: roles,
    auditCount,
    firstSteps,
    steps,
    completedSteps: steps.filter((step) => step.done).length,
    hasActivity: invoiceCount > 0 && productCount > 0,
  };
}
