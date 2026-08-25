'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { useApi } from '@/components/ui/use-api';

export interface ReceivableLine {
  id: string;
  description: string;
  orderedLabel: string;
  receivedLabel: string;
  remainingRaw: string;
  remaining: boolean;
}

/**
 * Actions sur une commande fournisseur : passer commande, receptionner, regler,
 * annuler. Comme ailleurs, seules les actions reellement possibles dans l'etat
 * courant sont affichees.
 */
export function PurchaseActions({
  orderId,
  status,
  balanceDueRaw,
  balanceDueLabel,
  lines,
  methods,
  currency,
  canWrite,
  canReceive,
  canPay,
}: {
  orderId: string;
  status: string;
  balanceDueRaw: string;
  balanceDueLabel: string;
  lines: ReceivableLine[];
  methods: Array<{ id: string; label: string; requiresReference: boolean; isCredit: boolean }>;
  currency: { symbol: string; decimals: number };
  canWrite: boolean;
  canReceive: boolean;
  canPay: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [panel, setPanel] = useState<'none' | 'receive' | 'pay' | 'cancel'>('none');
  const [methodId, setMethodId] = useState(methods.find((m) => !m.isCredit)?.id ?? '');

  const method = methods.find((entry) => entry.id === methodId);
  const isDraft = status === 'DRAFT';
  const isCancelled = status === 'CANCELLED';
  const isReceived = status === 'RECEIVED';
  const hasBalance = balanceDueRaw !== '0' && balanceDueRaw !== '0.00';

  async function place() {
    const result = await api.send(`/api/purchases/${orderId}/commander`, {
      method: 'POST',
      successMessage: 'Commande passée au fournisseur.',
    });
    if (result) router.refresh();
  }

  async function receive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = lines
      .map((line) => ({ lineId: line.id, quantity: String(form.get(`qty-${line.id}`) ?? '0') }))
      .filter((entry) => entry.quantity && entry.quantity !== '0');

    if (payload.length === 0) {
      window.alert('Indiquez au moins une quantité réceptionnée.');
      return;
    }

    const result = await api.send(`/api/purchases/${orderId}/reception`, {
      method: 'POST',
      body: { lines: payload },
      successMessage: 'Réception enregistrée. Le stock a été mis à jour.',
    });
    if (result) {
      setPanel('none');
      router.refresh();
    }
  }

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send('/api/payments', {
      method: 'POST',
      body: {
        direction: 'OUT',
        orderId,
        amount: String(form.get('amount') ?? ''),
        methodId: String(form.get('methodId') ?? ''),
        reference: String(form.get('reference') ?? ''),
      },
      successMessage: 'Règlement enregistré.',
    });
    if (result) {
      setPanel('none');
      router.refresh();
    }
  }

  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send(`/api/purchases/${orderId}/annuler`, {
      method: 'POST',
      body: { reason: String(form.get('reason') ?? '') },
      successMessage: 'Commande annulée. Le stock reçu a été ressorti.',
    });
    if (result) {
      setPanel('none');
      router.refresh();
    }
  }

  return (
    <div className="space-y-3 no-print">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {panel === 'none' && (
        <div className="flex flex-wrap gap-2">
          {canWrite && isDraft && (
            <Button type="button" onClick={place} disabled={api.pending}>
              Passer commande
            </Button>
          )}
          {canReceive && !isCancelled && !isReceived && lines.some((line) => line.remaining) && (
            <Button type="button" onClick={() => { api.reset(); setPanel('receive'); }}>
              Réceptionner
            </Button>
          )}
          {canPay && !isCancelled && !isDraft && hasBalance && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => { api.reset(); setPanel('pay'); }}
            >
              Régler le fournisseur
            </Button>
          )}
          {canWrite && !isCancelled && (
            <Button
              type="button"
              variant="ghost"
              className="text-red-600"
              onClick={() => { api.reset(); setPanel('cancel'); }}
            >
              Annuler la commande
            </Button>
          )}
        </div>
      )}

      {panel === 'receive' && (
        <Card
          title="Réceptionner"
          description="Saisissez les quantités réellement reçues. Une réception partielle est normale."
        >
          <form onSubmit={receive} className="space-y-4" noValidate>
            <ul className="divide-y divide-ink-100">
              {lines.map((line) => (
                <li key={line.id} className="flex flex-wrap items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-900">{line.description}</p>
                    <p className="text-xs text-ink-500">
                      Commande {line.orderedLabel} · déjà reçu {line.receivedLabel}
                    </p>
                  </div>
                  <label className="text-xs text-ink-500">
                    À réceptionner
                    <Input
                      name={`qty-${line.id}`}
                      defaultValue={line.remaining ? line.remainingRaw : '0'}
                      inputMode="decimal"
                      disabled={!line.remaining}
                      className="mt-0.5 w-32 text-right tabular"
                    />
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Reception...' : 'Enregistrer la réception'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPanel('none'); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      {panel === 'pay' && (
        <Card title="Régler le fournisseur" description={`Reste dû : ${balanceDueLabel}`}>
          <form onSubmit={pay} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Montant" htmlFor="amount" required error={api.fieldErrors.amount}>
                <MoneyInput
                  id="amount"
                  name="amount"
                  defaultValue={balanceDueRaw}
                  decimals={currency.decimals}
                  symbol={currency.symbol}
                  required
                />
              </Field>
              <Field label="Mode" htmlFor="methodId" required error={api.fieldErrors.methodId}>
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
                      <option key={entry.id} value={entry.id}>{entry.label}</option>
                    ))}
                </Select>
              </Field>
              <Field
                label="Référence"
                htmlFor="reference"
                required={method?.requiresReference}
                error={api.fieldErrors.reference}
              >
                <Input id="reference" name="reference" required={method?.requiresReference} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer le règlement'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPanel('none'); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      {panel === 'cancel' && (
        <Card title="Annuler la commande">
          <form onSubmit={cancel} className="space-y-4" noValidate>
            <Alert tone="warning">
              La marchandise déjà réceptionnée ressortira du stock. Si elle a été vendue entre-temps,
              le stock passera en négatif et l&apos;écart apparaîtra à votre prochain inventaire.
            </Alert>
            <Field label="Motif" htmlFor="reason" required error={api.fieldErrors.reason}>
              <Textarea id="reason" name="reason" required placeholder="Marchandise non conforme" />
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
    </div>
  );
}
