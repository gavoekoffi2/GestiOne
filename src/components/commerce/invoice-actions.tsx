'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { useApi } from '@/components/ui/use-api';

export interface InvoiceActionMethod {
  id: string;
  label: string;
  isCredit: boolean;
  requiresReference: boolean;
}

/**
 * Actions disponibles sur une facture : encaisser, emettre, annuler.
 *
 * Chaque bouton correspond a une operation reellement possible dans l'etat
 * courant du document. Une action indisponible n'est pas affichee grisee : elle
 * n'est pas affichee du tout.
 */
export function InvoiceActions({
  invoiceId,
  status,
  balanceDueText,
  balanceDueLabel,
  methods,
  currency,
  canPay,
  canIssue,
  canCancel,
  canDeletePayment,
  payments,
}: {
  invoiceId: string;
  status: string;
  balanceDueText: string;
  balanceDueLabel: string;
  methods: InvoiceActionMethod[];
  currency: { symbol: string; decimals: number };
  canPay: boolean;
  canIssue: boolean;
  canCancel: boolean;
  canDeletePayment: boolean;
  payments: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const api = useApi();
  const [panel, setPanel] = useState<'none' | 'pay' | 'cancel'>('none');
  const [methodId, setMethodId] = useState(methods.find((m) => !m.isCredit)?.id ?? '');

  const method = methods.find((entry) => entry.id === methodId);
  const isDraft = status === 'DRAFT';
  const isCancelled = status === 'CANCELLED';
  const isSettled = status === 'PAID';

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send('/api/payments', {
      method: 'POST',
      body: {
        direction: 'IN',
        invoiceId,
        amount: String(form.get('amount') ?? ''),
        methodId: String(form.get('methodId') ?? ''),
        reference: String(form.get('reference') ?? ''),
        notes: String(form.get('notes') ?? ''),
      },
      successMessage: 'Paiement enregistre.',
    });
    if (result) {
      setPanel('none');
      router.refresh();
    }
  }

  async function issue() {
    const result = await api.send(`/api/invoices/${invoiceId}/emettre`, {
      method: 'POST',
      successMessage: 'Facture emise. Le stock a ete mis a jour.',
    });
    if (result) router.refresh();
  }

  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send(`/api/invoices/${invoiceId}/annuler`, {
      method: 'POST',
      body: { reason: String(form.get('reason') ?? '') },
      successMessage: 'Facture annulee. Le stock a ete restitue.',
    });
    if (result) {
      setPanel('none');
      router.refresh();
    }
  }

  async function removePayment(paymentId: string, label: string) {
    const reason = window.prompt(
      `Annuler le paiement ${label} ?\n\nIndiquez le motif (cheque sans provision, erreur de saisie...) :`,
    );
    if (!reason?.trim()) return;

    const result = await api.send(`/api/payments/${paymentId}`, {
      method: 'DELETE',
      body: { reason },
      successMessage: 'Paiement annule. Le solde a ete recalcule.',
    });
    if (result) router.refresh();
  }

  return (
    <div className="space-y-3 no-print">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {panel === 'none' && (
        <div className="flex flex-wrap gap-2">
          {canIssue && isDraft && (
            <Button type="button" onClick={issue} disabled={api.pending}>
              Emettre la facture
            </Button>
          )}
          {canPay && !isDraft && !isCancelled && !isSettled && (
            <Button type="button" onClick={() => { api.reset(); setPanel('pay'); }}>
              Enregistrer un paiement
            </Button>
          )}
          {canCancel && !isCancelled && (
            <Button
              type="button"
              variant="ghost"
              className="text-red-600"
              onClick={() => { api.reset(); setPanel('cancel'); }}
            >
              Annuler la facture
            </Button>
          )}
        </div>
      )}

      {panel === 'pay' && (
        <Card title="Enregistrer un paiement" description={`Reste du : ${balanceDueLabel}`}>
          <form onSubmit={pay} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Montant" htmlFor="amount" required error={api.fieldErrors.amount}>
                <MoneyInput
                  id="amount"
                  name="amount"
                  defaultValue={balanceDueText}
                  decimals={currency.decimals}
                  symbol={currency.symbol}
                  required
                />
              </Field>
              <Field label="Mode de reglement" htmlFor="methodId" required error={api.fieldErrors.methodId}>
                <Select
                  id="methodId"
                  name="methodId"
                  value={methodId}
                  onChange={(event) => setMethodId(event.target.value)}
                  required
                >
                  {methods
                    .filter((entry) => !entry.isCredit)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field
                label="Reference"
                htmlFor="reference"
                required={method?.requiresReference}
                error={api.fieldErrors.reference}
                hint="Numero de transaction Mobile Money, de cheque ou de bordereau."
              >
                <Input id="reference" name="reference" required={method?.requiresReference} />
              </Field>
              <Field label="Notes" htmlFor="notes" error={api.fieldErrors.notes}>
                <Input id="notes" name="notes" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer le paiement'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPanel('none'); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      {panel === 'cancel' && (
        <Card title="Annuler la facture">
          <form onSubmit={cancel} className="space-y-4" noValidate>
            <Alert tone="warning">
              Le stock sorti sera restitue. Les paiements deja recus sont conserves : leur
              remboursement est une decision commerciale, a enregistrer separement.
            </Alert>
            <Field label="Motif" htmlFor="reason" required error={api.fieldErrors.reason}>
              <Textarea id="reason" name="reason" required placeholder="Client s'est retracte" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={api.pending}>
                {api.pending ? 'Annulation...' : "Confirmer l'annulation"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPanel('none'); api.reset(); }}>
                Revenir
              </Button>
            </div>
          </form>
        </Card>
      )}

      {canDeletePayment && payments.length > 0 && panel === 'none' && (
        <details className="rounded-lg border border-ink-200 px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-ink-700">
            Corriger un paiement
          </summary>
          <ul className="mt-2 space-y-1">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 py-1">
                <span className="text-ink-600">{payment.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 px-2 text-xs text-red-600"
                  onClick={() => removePayment(payment.id, payment.label)}
                  disabled={api.pending}
                >
                  Annuler ce paiement
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
