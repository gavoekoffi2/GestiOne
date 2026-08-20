import { formatMoney, type CurrencyFormat } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';

/**
 * La facture telle qu'elle sort de l'imprimante.
 *
 * Un seul balisage sert les trois formats — A4, A5 et ticket 80 mm. Les
 * differences sont portees par la feuille de style, a partir de l'attribut
 * `data-print-format` pose sur la racine du document : dupliquer le balisage
 * garantirait qu'un correctif applique a la facture A4 manque au ticket, et
 * qu'un commercant decouvre le probleme devant son client.
 *
 * Ce composant reste un composant serveur : il n'a aucun etat, et la facture
 * doit s'afficher avant que le moindre script ne soit arrive.
 */

export interface DocumentCompany {
  name: string;
  legalName: string | null;
  logoUrl: string | null;
  addressLine: string | null;
  city: string | null;
  countryCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxNumber: string | null;
  primaryColor: string;
  documentFooter: string | null;
  paymentTerms: string | null;
}

export interface DocumentCustomer {
  name: string;
  companyName: string | null;
  addressLine: string | null;
  city: string | null;
  phone: string | null;
  taxNumber: string | null;
}

export interface DocumentLine {
  id: string;
  description: string;
  sku: string | null;
  unitSymbol: string | null;
  quantity: bigint;
  unitPrice: bigint;
  discountRate: number;
  /** `null` quand le document ne detaille pas la taxe ligne par ligne (devis). */
  taxAmount: bigint | null;
  lineTotal: bigint;
}

export interface DocumentPayment {
  id: string;
  label: string;
  amount: bigint;
}

export interface InvoiceDocumentProps {
  kind: 'Facture' | 'Devis' | 'Recu';
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  locationName: string | null;
  company: DocumentCompany;
  customer: DocumentCustomer | null;
  lines: DocumentLine[];
  subtotal: bigint;
  discountAmount: bigint;
  taxTotal: bigint;
  total: bigint;
  paidAmount: bigint;
  balanceDue: bigint;
  payments: DocumentPayment[];
  notes: string | null;
  terms: string | null;
  cancelledLabel: string | null;
  currency: CurrencyFormat;
  locale: string;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR');
}

export function InvoiceDocument(props: InvoiceDocumentProps) {
  const { company, customer, currency, locale } = props;
  const money = (amount: bigint) => formatMoney(amount, currency, locale);

  const hasDiscountColumn = props.lines.some((line) => line.discountRate > 0);
  // Un devis ne stocke pas la taxe ligne par ligne : afficher une colonne de
  // tirets vaudrait moins que pas de colonne du tout.
  const hasTaxColumn = props.taxTotal > 0n && props.lines.some((line) => line.taxAmount !== null);

  const contactLines = [
    company.addressLine,
    [company.city, company.countryCode].filter(Boolean).join(', ') || null,
    company.phone,
    company.email,
    company.website,
    company.taxNumber ? `Identifiant fiscal : ${company.taxNumber}` : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <article className="doc-sheet">
      <header className="doc-head">
        <div className="doc-issuer">
          {company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- image `data:` stockee avec l'entreprise
            <img src={company.logoUrl} alt="" className="doc-logo" />
          )}
          <div>
            <p className="doc-issuer-name" style={{ color: company.primaryColor }}>
              {company.legalName || company.name}
            </p>
            {contactLines.length > 0 && (
              <div className="doc-issuer-contact">
                {contactLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="doc-meta">
          <p className="doc-kind" style={{ color: company.primaryColor }}>
            {props.kind}
          </p>
          <p className="doc-number">{props.number}</p>
          <dl className="doc-dates">
            <div>
              <dt>Date</dt>
              <dd>{formatDate(props.issueDate)}</dd>
            </div>
            {props.dueDate && (
              <div>
                <dt>Echeance</dt>
                <dd>{formatDate(props.dueDate)}</dd>
              </div>
            )}
            {props.locationName && (
              <div>
                <dt>Point de vente</dt>
                <dd>{props.locationName}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      {customer && (
        <section className="doc-customer">
          <p className="doc-label">Client</p>
          <p className="doc-customer-name">{customer.name}</p>
          <div className="doc-customer-contact">
            {customer.companyName && <p>{customer.companyName}</p>}
            {customer.addressLine && <p>{customer.addressLine}</p>}
            {customer.city && <p>{customer.city}</p>}
            {customer.phone && <p>{customer.phone}</p>}
            {customer.taxNumber && <p>Identifiant fiscal : {customer.taxNumber}</p>}
          </div>
        </section>
      )}

      <div className="doc-lines">
        <table>
          <thead>
            <tr>
              <th>Designation</th>
              <th className="doc-num">Qte</th>
              <th className="doc-num">P.U.</th>
              {hasDiscountColumn && <th className="doc-num">Remise</th>}
              {hasTaxColumn && <th className="doc-num">Taxe</th>}
              <th className="doc-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {props.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <span className="doc-line-name">{line.description}</span>
                  {line.sku && <span className="doc-line-sku">{line.sku}</span>}
                </td>
                <td className="doc-num">
                  {formatQuantity(line.quantity, locale)}
                  {line.unitSymbol && <span className="doc-unit"> {line.unitSymbol}</span>}
                </td>
                <td className="doc-num">{money(line.unitPrice)}</td>
                {hasDiscountColumn && (
                  <td className="doc-num">
                    {line.discountRate > 0
                      ? `${(line.discountRate / 100).toString().replace('.', ',')} %`
                      : '—'}
                  </td>
                )}
                {hasTaxColumn && (
                  <td className="doc-num">
                    {line.taxAmount !== null && line.taxAmount > 0n ? money(line.taxAmount) : '—'}
                  </td>
                )}
                <td className="doc-num doc-line-total">{money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="doc-totals">
        <dl>
          <div>
            <dt>Sous-total</dt>
            <dd>{money(props.subtotal)}</dd>
          </div>
          {props.discountAmount > 0n && (
            <div>
              <dt>Remise</dt>
              <dd>- {money(props.discountAmount)}</dd>
            </div>
          )}
          {props.taxTotal > 0n && (
            <div>
              <dt>Taxes</dt>
              <dd>{money(props.taxTotal)}</dd>
            </div>
          )}
          <div className="doc-total-line">
            <dt>Total</dt>
            <dd>{money(props.total)}</dd>
          </div>
          {props.paidAmount > 0n && (
            <div>
              <dt>Deja paye</dt>
              <dd>{money(props.paidAmount)}</dd>
            </div>
          )}
          {props.balanceDue > 0n && (
            <div className="doc-total-line">
              <dt>Reste a payer</dt>
              <dd>{money(props.balanceDue)}</dd>
            </div>
          )}
        </dl>
      </div>

      {props.payments.length > 0 && (
        <section className="doc-payments">
          <p className="doc-label">Reglements</p>
          <ul>
            {props.payments.map((payment) => (
              <li key={payment.id}>
                <span>{payment.label}</span>
                <span className="doc-num">{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.cancelledLabel && <p className="doc-cancelled">{props.cancelledLabel}</p>}

      {(props.notes || props.terms || company.paymentTerms || company.documentFooter) && (
        <footer className="doc-foot">
          {props.notes && <p>{props.notes}</p>}
          {(props.terms || company.paymentTerms) && (
            <p className="doc-terms">{props.terms || company.paymentTerms}</p>
          )}
          {company.documentFooter && <p className="doc-footer-note">{company.documentFooter}</p>}
        </footer>
      )}
    </article>
  );
}
