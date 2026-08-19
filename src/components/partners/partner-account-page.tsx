import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, ButtonLink, Card, EmptyState } from '@/components/ui/primitives';
import { ShareActions } from '@/components/commerce/share-actions';
import { StatTile } from '@/components/charts/stat-tile';
import { formatDate, formatRelative } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { NotFoundError } from '@/server/errors';
import { getCurrencyFormat } from '@/server/currency';
import { getCompanyProfile } from '@/server/services/companies';
import { getPartnerAccount, type PartnerAccountDocument } from '@/server/services/partner-account';
import { INVOICE_STATUS_LABELS } from '@/server/services/invoices';
import { PURCHASE_STATUS_LABELS } from '@/server/services/purchases';
import { can, requireTenantWith } from '@/server/tenant';
import type { PermissionKey } from '@/server/permissions';
import type { PartnerKind } from '@/lib/validation/catalog';

/**
 * Fiche d'un client ou d'un fournisseur.
 *
 * Les deux cotes posent la meme question dans un sens puis dans l'autre —
 * « combien me doit-il », « combien lui dois-je » — et se lisent sur les memes
 * documents. Une seule page les rend donc, en changeant les libelles : deux
 * ecrans jumeaux auraient diverge des la premiere correction faite d'un seul
 * cote.
 */

const CUSTOMER_TONES: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  PAID: 'success',
  PARTIALLY_PAID: 'warning',
  ISSUED: 'info',
  CANCELLED: 'neutral',
  DRAFT: 'neutral',
};

const SUPPLIER_TONES: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  RECEIVED: 'success',
  PARTIALLY_RECEIVED: 'warning',
  ORDERED: 'info',
  CANCELLED: 'neutral',
  DRAFT: 'neutral',
};

export async function renderPartnerAccountPage({
  kind,
  partnerId,
  readPermission,
}: {
  kind: PartnerKind;
  partnerId: string;
  readPermission: PermissionKey;
}) {
  const context = await requireTenantWith(readPermission);

  // Un identifiant appartenant a une autre entreprise doit rendre la page
  // « introuvable », exactement comme un identifiant qui n'existe pas : rien
  // dans la reponse ne doit permettre de deviner qu'il designe quelque chose
  // ailleurs.
  let account;
  try {
    account = await getPartnerAccount(context.companyId, kind, partnerId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [company, currency] = await Promise.all([
    getCompanyProfile(context.companyId),
    getCurrencyFormat(context.currencyCode),
  ]);

  const isCustomer = kind === 'CUSTOMER';
  const { partner } = account;
  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);

  const labels = isCustomer
    ? {
        backHref: '/clients',
        backLabel: 'Retour aux clients',
        documentsTitle: 'Factures',
        documentsEmpty: "Ce client n'a encore aucune facture.",
        paymentsTitle: 'Encaissements',
        paymentsEmpty: "Aucun reglement recu de ce client.",
        billedLabel: 'Total facture',
        outstandingLabel: 'Reste a encaisser',
        unallocatedLabel: 'Acomptes non affectes',
        statementTitle: 'Releve de compte client',
        owesLabel: 'Ce client vous doit',
        settledLabel: 'Ce client est a jour',
        statuses: INVOICE_STATUS_LABELS as Record<string, string>,
        tones: CUSTOMER_TONES,
        documentHref: (document: PartnerAccountDocument) => `/factures/${document.id}`,
      }
    : {
        backHref: '/fournisseurs',
        backLabel: 'Retour aux fournisseurs',
        documentsTitle: 'Commandes',
        documentsEmpty: "Aucune commande passee aupres de ce fournisseur.",
        paymentsTitle: 'Reglements',
        paymentsEmpty: "Aucun reglement verse a ce fournisseur.",
        billedLabel: 'Total commande',
        outstandingLabel: 'Reste a payer',
        unallocatedLabel: 'Avances non affectees',
        statementTitle: 'Releve de compte fournisseur',
        owesLabel: 'Vous devez a ce fournisseur',
        settledLabel: 'Vous etes a jour avec ce fournisseur',
        statuses: PURCHASE_STATUS_LABELS as Record<string, string>,
        tones: SUPPLIER_TONES,
        documentHref: (document: PartnerAccountDocument) => `/achats/${document.id}`,
      };

  // Recapitulatif texte pour le partage : un client qui demande « je vous dois
  // combien ? » recoit une reponse lisible telle quelle sur WhatsApp, sans
  // piece jointe a ouvrir.
  const summary = [
    company.name,
    `${labels.statementTitle} — ${partner.name}`,
    `Au ${formatDate(new Date())}`,
    '',
    `${labels.billedLabel} : ${money(account.billed)}`,
    `Regle : ${money(account.settled)}`,
    account.unallocated > 0n ? `${labels.unallocatedLabel} : ${money(account.unallocated)}` : null,
    `${labels.outstandingLabel} : ${money(account.netOutstanding)}`,
    account.overdueCount > 0
      ? `Dont en retard : ${money(account.overdueAmount)} sur ${account.overdueCount} document(s)`
      : null,
    company.phone ? '' : null,
    company.phone ? `${company.name} — ${company.phone}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const creditExceeded =
    partner.creditLimit > 0n && account.netOutstanding > partner.creditLimit;

  return (
    <div className="space-y-5">
      <div className="no-print">
        <Link href={labels.backHref} className="text-sm font-medium text-brand-700 hover:underline">
          ← {labels.backLabel}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink-900">{partner.name}</h1>
            {!partner.isActive && <Badge tone="neutral">Inactif</Badge>}
            {account.overdueCount > 0 && <Badge tone="danger">Retard de paiement</Badge>}
          </div>
          <p className="mt-1 font-mono text-sm text-ink-500">{partner.code}</p>
          {partner.companyName && <p className="text-ink-600">{partner.companyName}</p>}
        </div>

        <div className="no-print">
          <ShareActions
            title={`${labels.statementTitle} — ${partner.name}`}
            summary={summary}
            phone={partner.phone ?? ''}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon="wallet"
          label={labels.outstandingLabel}
          value={money(account.netOutstanding)}
          hint={
            account.netOutstanding > 0n
              ? `${labels.owesLabel.toLowerCase()} cette somme`
              : labels.settledLabel
          }
          tone={account.netOutstanding > 0n ? (account.overdueCount > 0 ? 'danger' : 'warning') : 'success'}
        />
        <StatTile
          icon="receipt"
          label={labels.billedLabel}
          value={money(account.billed)}
          hint={`${account.documentCount} document(s)`}
        />
        <StatTile icon="cash" label="Deja regle" value={money(account.settled)} />
        <StatTile
          icon="history"
          label="En retard"
          value={money(account.overdueAmount)}
          hint={
            account.overdueCount > 0
              ? `${account.overdueCount} document(s) au-dela de l'echeance`
              : 'Aucune echeance depassee'
          }
          tone={account.overdueCount > 0 ? 'danger' : undefined}
        />
      </div>

      {creditExceeded && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <p className="font-semibold">Plafond d&apos;encours depasse</p>
          <p className="mt-0.5">
            L&apos;encours atteint {money(account.netOutstanding)} pour un plafond de{' '}
            {money(partner.creditLimit)}. Toute nouvelle vente a credit sera refusee tant que ce
            solde n&apos;est pas ramene sous le plafond.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Coordonnees" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <Detail label="Telephone">
              {partner.phone ? (
                <a href={`tel:${partner.phone.replace(/\s/g, '')}`} className="text-brand-700 hover:underline">
                  {partner.phone}
                </a>
              ) : null}
            </Detail>
            <Detail label="Autre numero">{partner.secondPhone}</Detail>
            <Detail label="Email">
              {partner.email ? (
                <a href={`mailto:${partner.email}`} className="text-brand-700 hover:underline">
                  {partner.email}
                </a>
              ) : null}
            </Detail>
            <Detail label="Adresse">{partner.addressLine}</Detail>
            <Detail label="Ville">
              {[partner.city, partner.countryCode].filter(Boolean).join(', ') || null}
            </Detail>
            <Detail label="Identifiant fiscal">{partner.taxNumber}</Detail>
            {isCustomer && (
              <Detail label="Plafond d'encours">
                {partner.creditLimit > 0n
                  ? `${money(partner.creditLimit)}${
                      account.creditUsagePercent !== null
                        ? ` · ${account.creditUsagePercent} % utilise`
                        : ''
                    }`
                  : 'Aucune vente a credit autorisee'}
              </Detail>
            )}
            {account.unallocated > 0n && (
              <Detail label={labels.unallocatedLabel}>{money(account.unallocated)}</Detail>
            )}
            <Detail label="Premiere operation">
              {account.firstDocumentAt ? formatDate(account.firstDocumentAt) : null}
            </Detail>
            <Detail label="Derniere operation">
              {account.lastDocumentAt ? formatRelative(account.lastDocumentAt) : null}
            </Detail>
            <Detail label="Notes">{partner.notes}</Detail>
          </dl>

          {isCustomer && can(context, 'invoices.write') && (
            <div className="mt-4 no-print">
              <ButtonLink href={`/factures/nouvelle?client=${partner.id}`} variant="secondary">
                Nouvelle facture
              </ButtonLink>
            </div>
          )}
          {!isCustomer && can(context, 'purchases.write') && (
            <div className="mt-4 no-print">
              <ButtonLink href={`/achats/nouvelle?fournisseur=${partner.id}`} variant="secondary">
                Nouvelle commande
              </ButtonLink>
            </div>
          )}
        </Card>

        <Card
          title={labels.documentsTitle}
          description={
            account.documentsTruncated
              ? `Les ${account.documents.length} plus recents sur ${account.documentCount}.`
              : undefined
          }
          className="lg:col-span-2"
        >
          {account.documents.length === 0 ? (
            <EmptyState title={labels.documentsEmpty} />
          ) : (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Numero</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Etat</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium sm:px-5">Reste</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {account.documents.map((document) => {
                    const overdue =
                      document.balanceDue > 0n &&
                      document.dueDate !== null &&
                      document.dueDate.getTime() < Date.now();

                    return (
                      <tr key={document.id}>
                        <td className="px-4 py-3 sm:px-5">
                          <Link
                            href={labels.documentHref(document)}
                            className="font-mono text-xs font-medium text-brand-700 hover:underline"
                          >
                            {document.number}
                          </Link>
                          {document.origin === 'POS' && (
                            <span className="ml-2 text-xs text-ink-400">comptoir</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-600">
                          <span className="tabular">{formatDate(document.date)}</span>
                          {document.dueDate && (
                            <p className={`text-xs ${overdue ? 'text-red-600' : 'text-ink-400'}`}>
                              echeance {formatDate(document.dueDate)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={overdue ? 'danger' : (labels.tones[document.status] ?? 'neutral')}>
                            {overdue
                              ? 'En retard'
                              : (labels.statuses[document.status] ?? document.status)}
                          </Badge>
                        </td>
                        <td className="tabular px-4 py-3 text-right text-ink-700">
                          {money(document.total)}
                        </td>
                        <td className="tabular px-4 py-3 text-right font-medium sm:px-5">
                          {document.balanceDue > 0n ? (
                            <span className={overdue ? 'text-red-700' : 'text-ink-900'}>
                              {money(document.balanceDue)}
                            </span>
                          ) : (
                            <span className="text-ink-400">solde</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card
        title={labels.paymentsTitle}
        description={
          account.paymentsTruncated
            ? `Les ${account.payments.length} plus recents.`
            : undefined
        }
      >
        {account.payments.length === 0 ? (
          <EmptyState title={labels.paymentsEmpty} />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Numero</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Mode</th>
                  <th className="px-4 py-2 font-medium">Rattache a</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {account.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600 sm:px-5">
                      {payment.number}
                    </td>
                    <td className="tabular px-4 py-3 text-ink-600">{formatDate(payment.paidAt)}</td>
                    <td className="px-4 py-3 text-ink-600">
                      {payment.methodName ?? 'Non precise'}
                      {payment.reference && (
                        <p className="text-xs text-ink-400">{payment.reference}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600">
                      {payment.documentNumber ?? (
                        <span className="font-sans text-ink-400">{labels.unallocatedLabel}</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium text-ink-900 sm:px-5">
                      {money(payment.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Ligne de coordonnees : masquee lorsque la donnee est absente. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="text-ink-800">{children}</dd>
    </div>
  );
}
