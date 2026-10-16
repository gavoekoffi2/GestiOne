import { prisma } from '@/server/db';
import { NotFoundError, ValidationError } from '@/server/errors';
import {
  cancelInvoice,
  createInvoice,
  previewInvoiceTotal,
  type ServiceContext,
} from '@/server/services/invoices';
import { recordPayment } from '@/server/services/payments';
import { partnerBalance } from '@/server/services/payments';
import { changeDue as computeChangeDue } from '@/lib/totals';

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
    throw new ValidationError('Ajoutez au moins un article a la vente.');
  }

  const location = await prisma.location.findFirst({
    where: { id: input.locationId, companyId: context.companyId, isActive: true },
    select: { id: true },
  });
  if (!location) throw new NotFoundError('Point de vente introuvable ou inactif.');

  let method: {
    id: string;
    name: string;
    isCredit: boolean;
    affectsCash: boolean;
    requiresReference: boolean;
  } | null = null;
  if (input.payment) {
    const found = await prisma.paymentMethod.findFirst({
      where: { id: input.payment.methodId, companyId: context.companyId, isActive: true },
      select: { id: true, name: true, isCredit: true, affectsCash: true, requiresReference: true },
    });
    if (!found) throw new NotFoundError('Mode de reglement introuvable ou desactive.');
    method = found;
  }

  // Tout ce qui peut refuser l'encaissement est verifie AVANT de creer la
  // facture. Auparavant, une reference Mobile Money manquante ou un montant nul
  // etaient detectes apres coup : la facture restait emise, le stock sorti, et
  // la vente apparaissait comme un credit accorde a personne.
  const total = await previewInvoiceTotal(context.companyId, input);
  const paying = method !== null && !method.isCredit;

  let tendered = 0n;
  if (paying) {
    tendered = input.payment?.amount ?? total;
    if (tendered <= 0n) {
      throw new ValidationError('Le montant recu doit etre superieur a zero.');
    }
    if (method!.requiresReference && !input.payment?.reference?.trim()) {
      throw new ValidationError(
        `Le mode "${method!.name}" exige une reference (numero de transaction, de cheque ou de bordereau).`,
      );
    }
  }

  // Ce qui n'est pas regle aujourd'hui est un credit, que la vente soit
  // entierement a credit ou seulement partiellement payee. Un reste du sans
  // client identifie ne pourrait etre reclame a personne.
  const credited = paying ? (tendered >= total ? 0n : total - tendered) : total;
  if (credited > 0n) {
    if (!input.customerId) {
      throw new ValidationError(
        paying
          ? "Le montant recu ne couvre pas la vente : le reste est un credit, qui doit etre rattache a un client."
          : "Une vente a credit doit etre rattachee a un client : sans cela, personne ne pourra etre relance.",
      );
    }
    // Le plafond porte sur l'encours APRES la vente : verifier seulement
    // l'encours deja constate laissait vendre a credit n'importe quel montant
    // a un client encore sous son plafond.
    await assertCreditAllowed(context.companyId, input.customerId, credited);
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
  let changeDue = 0n;

  if (paying) {
    // Le client peut tendre un billet superieur au total : on encaisse le du et
    // on annonce la monnaie a rendre. Enregistrer le montant tendu creerait un
    // trop-percu fictif.
    const applied = tendered > invoice.total ? invoice.total : tendered;
    changeDue = computeChangeDue(invoice.total, tendered);

    try {
      const payment = await recordPayment(context, {
        direction: 'IN',
        amount: applied,
        invoiceId: invoice.id,
        partnerId: input.customerId,
        methodId: method!.id,
        locationId: input.locationId,
        reference: input.payment?.reference,
      });
      paymentId = payment.id;
    } catch (error) {
      // Filet de securite : si l'encaissement echoue malgre les controles, la
      // vente n'a pas eu lieu. La facture est annulee et le stock rendu.
      await cancelInvoice(context, invoice.id, "Encaissement refuse lors de la vente").catch(
        () => undefined,
      );
      throw error;
    }
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
async function assertCreditAllowed(
  companyId: string,
  customerId: string,
  amount: bigint,
): Promise<void> {
  const customer = await prisma.partner.findFirst({
    where: { id: customerId, companyId, kind: 'CUSTOMER' },
    select: { id: true, name: true, creditLimit: true },
  });
  if (!customer) throw new NotFoundError('Client introuvable.');

  if (customer.creditLimit <= 0n) {
    throw new ValidationError(
      `Aucun plafond d'encours n'est accorde a ${customer.name}. Definissez-en un sur sa fiche pour autoriser la vente a credit.`,
    );
  }

  const balance = await partnerBalance(companyId, customerId);
  if (balance.netOutstanding + amount > customer.creditLimit) {
    throw new ValidationError(
      `Cette vente porterait l'encours de ${customer.name} au-dela de son plafond. Encaissez un reglement, reduisez le credit accorde ou relevez le plafond.`,
    );
  }
}
