import { prisma } from '@/server/db';
import { NotFoundError, ValidationError } from '@/server/errors';
import { createInvoice, type ServiceContext } from '@/server/services/invoices';
import { recordPayment } from '@/server/services/payments';
import { partnerBalance } from '@/server/services/payments';

/**
 * Vente au comptoir.
 *
 * C'est le chemin rapide : choisir des articles, encaisser, imprimer. Il ne
 * cree pas un objet "vente" distinct — il produit une **facture** d'origine POS,
 * plus le paiement correspondant. Ainsi, ce que doivent les clients se lit
 * toujours au meme endroit, que la vente vienne du comptoir ou d'une facture
 * emise a l'avance.
 *
 * Une vente reglee en "credit" est simplement une facture emise sans paiement :
 * la creance apparait immediatement dans l'encours du client.
 */

export interface SaleLineInput {
  productId?: string;
  description?: string;
  quantity: bigint;
  unitPrice?: bigint;
  discountRate?: number;
  taxRateId?: string;
}

export interface SaleInput {
  customerId?: string;
  locationId: string;
  lines: SaleLineInput[];
  discountAmount?: bigint;
  discountRate?: number;
  notes?: string;
  /** Reglement immediat. Absent = vente a credit. */
  payment?: {
    methodId: string;
    /** Montant recu. Absent = solde integral de la vente. */
    amount?: bigint;
    reference?: string;
  };
}

export interface SaleContext extends ServiceContext {
  paymentPrefix: string;
}

export interface SaleResult {
  invoiceId: string;
  number: string;
  total: bigint;
  paid: bigint;
  balanceDue: bigint;
  /** Monnaie a rendre lorsque le client donne plus que le montant du. */
  changeDue: bigint;
  paymentId: string | null;
}

export async function recordSale(context: SaleContext, input: SaleInput): Promise<SaleResult> {
  if (input.lines.length === 0) {
    throw new ValidationError('Ajoutez au moins un article à la vente.');
  }

  const location = await prisma.location.findFirst({
    where: { id: input.locationId, companyId: context.companyId, isActive: true },
    select: { id: true },
  });
  if (!location) throw new NotFoundError('Point de vente introuvable ou inactif.');

  // Une vente non reglee est une vente a credit : elle exige un client
  // identifie, faute de quoi la creance ne serait rattachee a personne et
  // deviendrait irrecouvrable dans les faits.
  const isCredit = !input.payment;
  if (isCredit && !input.customerId) {
    throw new ValidationError(
      "Une vente à crédit doit être rattachée à un client : sans cela, personne ne pourra être relance.",
    );
  }

  let method: { id: string; name: string; isCredit: boolean; affectsCash: boolean } | null = null;
  if (input.payment) {
    const found = await prisma.paymentMethod.findFirst({
      where: { id: input.payment.methodId, companyId: context.companyId, isActive: true },
      select: { id: true, name: true, isCredit: true, affectsCash: true },
    });
    if (!found) throw new NotFoundError('Mode de règlement introuvable ou désactivé.');

    // Choisir "Credit" comme mode de reglement revient a ne pas payer : on
    // enregistre la vente sans paiement plutot que de creer un encaissement
    // fictif qui ferait croire la facture soldee.
    if (found.isCredit && !input.customerId) {
      throw new ValidationError(
        "Une vente à crédit doit être rattachée à un client : sans cela, personne ne pourra être relance.",
      );
    }
    method = found;
  }

  // Controle du plafond d'encours, avant d'engager quoi que ce soit.
  if (input.customerId && (isCredit || method?.isCredit)) {
    await assertCreditAllowed(context.companyId, input.customerId);
  }

  const invoice = await createInvoice(context, {
    customerId: input.customerId,
    locationId: input.locationId,
    origin: 'POS',
    issue: true,
    discountAmount: input.discountAmount,
    discountRate: input.discountRate,
    notes: input.notes,
    lines: input.lines,
  });

  let paymentId: string | null = null;
  let paid = 0n;
  let changeDue = 0n;

  if (method && !method.isCredit) {
    const tendered = input.payment?.amount ?? invoice.total;
    if (tendered <= 0n) {
      throw new ValidationError('Le montant reçu doit être supérieur à zéro.');
    }

    // Le client peut tendre un billet superieur au total : on encaisse le du et
    // on annonce la monnaie a rendre. Enregistrer le montant tendu creerait un
    // trop-percu fictif.
    const applied = tendered > invoice.total ? invoice.total : tendered;
    changeDue = tendered > invoice.total ? tendered - invoice.total : 0n;

    const payment = await recordPayment(context, {
      direction: 'IN',
      amount: applied,
      invoiceId: invoice.id,
      partnerId: input.customerId,
      methodId: method.id,
      locationId: input.locationId,
      reference: input.payment?.reference,
    });

    paymentId = payment.id;
    paid = applied;
  }

  const refreshed = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    select: { number: true, total: true, paidAmount: true, balanceDue: true },
  });

  return {
    invoiceId: invoice.id,
    number: refreshed.number,
    total: refreshed.total,
    paid: refreshed.paidAmount,
    balanceDue: refreshed.balanceDue,
    changeDue,
    paymentId,
  };
}

/**
 * Verifie le plafond d'encours d'un client.
 *
 * Un plafond a zero signifie "pas de vente a credit" — c'est la valeur par
 * defaut, donc le comportement prudent. Le controle porte sur l'encours deja
 * constate ; il previent la derive plutot que de la constater apres coup.
 */
async function assertCreditAllowed(companyId: string, customerId: string): Promise<void> {
  const customer = await prisma.partner.findFirst({
    where: { id: customerId, companyId, kind: 'CUSTOMER' },
    select: { id: true, name: true, creditLimit: true },
  });
  if (!customer) throw new NotFoundError('Client introuvable.');

  if (customer.creditLimit <= 0n) {
    throw new ValidationError(
      `Aucun plafond d'encours n'est accordé a ${customer.name}. Définissez-en un sur sa fiche pour autoriser la vente à crédit.`,
    );
  }

  const balance = await partnerBalance(companyId, customerId);
  if (balance.netOutstanding >= customer.creditLimit) {
    throw new ValidationError(
      `${customer.name} a atteint son plafond d'encours. Encaissez un règlement ou relevez le plafond avant d'accorder un nouveau crédit.`,
    );
  }
}
