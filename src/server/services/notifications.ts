import { prisma } from '@/server/db';
import type { PermissionKey } from '@/server/permissions';

/**
 * Alertes.
 *
 * **Elles sont calculees a la demande, jamais stockees.** Une alerte comme
 * "stock faible" ou "facture en retard" decrit un *etat*, pas un evenement :
 * la stocker, c'est accepter qu'elle mente des que l'etat change. Un
 * reapprovisionnement effectue laisserait une alerte de rupture affichee
 * jusqu'a ce qu'une tache de nettoyage passe — et si cette tache ne tourne pas,
 * l'alerte reste indefiniment.
 *
 * Calculees, elles disparaissent d'elles-memes quand le probleme est resolu.
 * Il n'y a rien a "marquer comme lu" : on les efface en agissant.
 *
 * Les *evenements* (une vente enregistree, un paiement recu) ne sont pas des
 * alertes : ils sont deja dans le journal d'audit et sur le tableau de bord.
 * En faire des notifications noierait les alertes reellement actionnables.
 *
 * ## Canaux de diffusion
 *
 * Seul le canal « dans l'application » est implemente. L'envoi par courriel,
 * SMS, WhatsApp ou notification push demande un fournisseur externe, propre a
 * chaque pays : l'interface `NotificationChannel` est prete a en accueillir,
 * mais GestiOne ne pretend pas envoyer ce qu'il n'envoie pas.
 */

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  /** Identifiant stable, pour que l'interface puisse poser une cle de rendu. */
  key: string;
  kind: 'STOCK_OUT' | 'STOCK_LOW' | 'INVOICE_OVERDUE' | 'QUOTE_EXPIRING' | 'PAYABLE_DUE' | 'CASH_OPEN';
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string;
  /** Permission necessaire pour voir — et donc pour traiter — l'alerte. */
  permission: PermissionKey;
  count: number;
}

const DAY = 86_400_000;

/** Nombre de jours avant expiration a partir duquel on previent pour un devis. */
const QUOTE_WARNING_DAYS = 3;

/** Duree au-dela de laquelle une caisse restee ouverte devient suspecte. */
const CASH_SESSION_WARNING_HOURS = 24;

export async function collectAlerts(
  companyId: string,
  permissions: readonly string[],
): Promise<Alert[]> {
  const now = new Date();
  const alerts: Alert[] = [];

  const allowed = (permission: PermissionKey) =>
    permissions.includes('*') || permissions.includes(permission);

  // --- Stock ------------------------------------------------------------
  if (allowed('stock.read')) {
    const products = await prisma.product.findMany({
      where: { companyId, isActive: true, trackStock: true },
      select: { id: true, name: true, minStock: true, stockLevels: { select: { quantity: true } } },
    });

    let out = 0;
    let low = 0;
    let firstOut = '';
    let firstLow = '';

    for (const product of products) {
      const quantity = product.stockLevels.reduce((total, level) => total + level.quantity, 0n);
      if (quantity <= 0n) {
        out += 1;
        if (!firstOut) firstOut = product.name;
      } else if (product.minStock > 0n && quantity <= product.minStock) {
        low += 1;
        if (!firstLow) firstLow = product.name;
      }
    }

    if (out > 0) {
      alerts.push({
        key: 'stock-out',
        kind: 'STOCK_OUT',
        severity: 'critical',
        title: `${out} article(s) en rupture`,
        detail:
          out === 1 ? `${firstOut} n'est plus disponible.` : `${firstOut} et ${out - 1} autre(s).`,
        href: '/stock?lowOnly=true',
        permission: 'stock.read',
        count: out,
      });
    }

    if (low > 0) {
      alerts.push({
        key: 'stock-low',
        kind: 'STOCK_LOW',
        severity: 'warning',
        title: `${low} article(s) sous leur seuil`,
        detail:
          low === 1 ? `${firstLow} approche de la rupture.` : `${firstLow} et ${low - 1} autre(s).`,
        href: '/stock?lowOnly=true',
        permission: 'stock.read',
        count: low,
      });
    }
  }

  // --- Factures en retard ----------------------------------------------
  if (allowed('invoices.read')) {
    const overdue = await prisma.invoice.aggregate({
      where: {
        companyId,
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        balanceDue: { gt: 0n },
        dueDate: { lt: now },
      },
      _sum: { balanceDue: true },
      _count: { _all: true },
    });

    if (overdue._count._all > 0) {
      alerts.push({
        key: 'invoices-overdue',
        kind: 'INVOICE_OVERDUE',
        severity: 'critical',
        title: `${overdue._count._all} facture(s) en retard`,
        detail: 'Leur échéance est dépassée et elles ne sont pas soldées.',
        href: '/factures?filter=overdue',
        permission: 'invoices.read',
        count: overdue._count._all,
      });
    }
  }

  // --- Devis proches de l'expiration ------------------------------------
  if (allowed('quotes.read')) {
    const expiring = await prisma.quote.count({
      where: {
        companyId,
        status: { in: ['DRAFT', 'SENT'] },
        validUntil: { gte: now, lte: new Date(now.getTime() + QUOTE_WARNING_DAYS * DAY) },
      },
    });

    if (expiring > 0) {
      alerts.push({
        key: 'quotes-expiring',
        kind: 'QUOTE_EXPIRING',
        severity: 'warning',
        title: `${expiring} devis expire(nt) bientôt`,
        detail: `Leur validité s'achève dans moins de ${QUOTE_WARNING_DAYS} jours.`,
        href: '/devis?status=SENT',
        permission: 'quotes.read',
        count: expiring,
      });
    }
  }

  // --- Dettes fournisseur echues ----------------------------------------
  if (allowed('purchases.read')) {
    const due = await prisma.purchaseOrder.aggregate({
      where: {
        companyId,
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        balanceDue: { gt: 0n },
        dueDate: { lt: now },
      },
      _sum: { balanceDue: true },
      _count: { _all: true },
    });

    if (due._count._all > 0) {
      alerts.push({
        key: 'payables-due',
        kind: 'PAYABLE_DUE',
        severity: 'warning',
        title: `${due._count._all} commande(s) fournisseur à régler`,
        detail: 'Leur échéance de paiement est dépassée.',
        href: '/achats?filter=unpaid',
        permission: 'purchases.read',
        count: due._count._all,
      });
    }
  }

  // --- Caisse restee ouverte --------------------------------------------
  if (allowed('cash.read')) {
    const stale = await prisma.cashSession.count({
      where: {
        companyId,
        status: 'OPEN',
        openedAt: { lt: new Date(now.getTime() - CASH_SESSION_WARNING_HOURS * 3_600_000) },
      },
    });

    if (stale > 0) {
      alerts.push({
        key: 'cash-open',
        kind: 'CASH_OPEN',
        severity: 'info',
        title: `${stale} caisse(s) ouverte(s) depuis plus de 24 h`,
        detail: 'Fermez la caisse pour rapprocher les espèces comptées.',
        href: '/caisse',
        permission: 'cash.read',
        count: stale,
      });
    }
  }

  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Canal de diffusion d'une alerte.
 *
 * Le seul canal implemente est l'affichage dans l'application. Les autres
 * (courriel, SMS, WhatsApp, push) supposent un fournisseur externe, choisi
 * selon le pays et l'operateur : ils s'ajouteront ici sans toucher au calcul
 * des alertes.
 */
export interface NotificationChannel {
  key: string;
  label: string;
  /** Un canal non disponible est annonce comme tel, jamais simule. */
  available: boolean;
  deliver?(companyId: string, alerts: readonly Alert[]): Promise<void>;
}

export const CHANNELS: NotificationChannel[] = [
  {
    key: 'in-app',
    label: "Dans l'application",
    available: true,
    // Rien a livrer : les alertes sont calculees a l'affichage.
    async deliver() {},
  },
  { key: 'email', label: 'Courriel', available: false },
  { key: 'sms', label: 'SMS', available: false },
  { key: 'whatsapp', label: 'WhatsApp', available: false },
  { key: 'push', label: 'Notification push', available: false },
];
