import { prisma } from '@/server/db';

/**
 * Etat reel de configuration d'une entreprise.
 *
 * Chaque element est calcule a partir de la base : le tableau de bord ne montre
 * jamais une etape "faite" qui ne l'est pas, ni un compteur invente.
 */

export interface SetupStep {
  key: string;
  label: string;
  description: string;
  done: boolean;
  href?: string;
  permission?: string;
}

export interface CompanyOverview {
  userCount: number;
  activeUserCount: number;
  locationCount: number;
  roleCount: number;
  auditCount: number;
  steps: SetupStep[];
  completedSteps: number;
}

export async function getCompanyOverview(companyId: string): Promise<CompanyOverview> {
  const [company, memberships, activeMemberships, locations, roles, auditCount] =
    await Promise.all([
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
    ]);

  const steps: SetupStep[] = [
    {
      key: 'company',
      label: 'Completer la fiche entreprise',
      description: 'Adresse, telephone et email apparaissent sur vos factures et vos devis.',
      done: Boolean(company.addressLine && company.phone),
      href: '/parametres',
      permission: 'settings.company',
    },
    {
      key: 'identity',
      label: 'Ajouter votre identifiant fiscal',
      description: 'NIF, RCCM ou numero de TVA selon votre pays.',
      done: Boolean(company.taxNumber),
      href: '/parametres',
      permission: 'settings.company',
    },
    {
      key: 'locations',
      label: 'Declarer vos points de vente',
      description: 'Boutiques, depots ou agences : chacun aura son stock et sa caisse.',
      done: locations > 1,
      href: '/parametres/points-de-vente',
      permission: 'settings.locations',
    },
    {
      key: 'team',
      label: 'Inviter votre equipe',
      description: 'Chaque collaborateur recoit un role et uniquement les droits necessaires.',
      done: memberships > 1,
      href: '/parametres/utilisateurs',
      permission: 'settings.users',
    },
  ];

  return {
    userCount: memberships,
    activeUserCount: activeMemberships,
    locationCount: locations,
    roleCount: roles,
    auditCount,
    steps,
    completedSteps: steps.filter((step) => step.done).length,
  };
}
