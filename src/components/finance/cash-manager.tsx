'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { useApi } from '@/components/ui/use-api';

export interface CashLocation {
  id: string;
  label: string;
}

/**
 * Pilotage de la caisse d'un point de vente : ouverture, mouvements manuels,
 * fermeture avec comptage.
 *
 * La fermeture demande le montant **reellement compte** et affiche l'ecart. Ce
 * chiffre n'est pas corrige automatiquement : un manquant doit se voir.
 */
export function CashManager({
  locationId,
  locations,
  session,
  expectedLabel,
  expectedRaw,
  currency,
  canOperate,
}: {
  locationId: string;
  locations: CashLocation[];
  session: { id: string; openedAt: string; openedBy: string } | null;
  expectedLabel: string;
  expectedRaw: string;
  currency: { symbol: string; decimals: number };
  canOperate: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [panel, setPanel] = useState<'none' | 'open' | 'close' | 'move'>('none');

  function switchLocation(next: string) {
    const params = new URLSearchParams();
    if (next) params.set('locationId', next);
    router.replace(`/caisse?${params.toString()}`);
  }

  async function openSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send('/api/cash/sessions', {
      method: 'POST',
      body: {
        locationId,
        openingAmount: String(form.get('openingAmount') ?? '0'),
      },
      successMessage: 'Caisse ouverte.',
    });
    if (result) {
      setPanel('none');
      router.refresh();
    }
  }

  async function closeSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const form = new FormData(event.currentTarget);
    const result = await api.send(`/api/cash/sessions/${session.id}/fermer`, {
      method: 'POST',
      body: {
        countedAmount: String(form.get('countedAmount') ?? '0'),
        notes: String(form.get('notes') ?? ''),
      },
      successMessage: 'Caisse fermée.',
    });
    if (result) {
      setPanel('none');
      router.refresh();
    }
  }

  async function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send('/api/cash/movements', {
      method: 'POST',
      body: {
        locationId,
        kind: String(form.get('kind') ?? 'DEPOSIT'),
        amount: String(form.get('amount') ?? ''),
        reason: String(form.get('reason') ?? ''),
      },
      successMessage: 'Mouvement enregistré.',
    });
    if (result) {
      setPanel('none');
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {locations.length > 1 && (
        <Card>
          <Field label="Point de vente" htmlFor="cash-location">
            <Select
              id="cash-location"
              value={locationId}
              onChange={(event) => switchLocation(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.label}</option>
              ))}
            </Select>
          </Field>
        </Card>
      )}

      {panel === 'none' && canOperate && (
        <div className="flex flex-wrap gap-2">
          {session ? (
            <>
              <Button type="button" onClick={() => { api.reset(); setPanel('close'); }}>
                Fermer la caisse
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { api.reset(); setPanel('move'); }}
              >
                Apport ou retrait
              </Button>
            </>
          ) : (
            <>
              <Button type="button" onClick={() => { api.reset(); setPanel('open'); }}>
                Ouvrir la caisse
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { api.reset(); setPanel('move'); }}
              >
                Apport ou retrait
              </Button>
            </>
          )}
        </div>
      )}

      {panel === 'open' && (
        <Card title="Ouvrir la caisse">
          <form onSubmit={openSession} className="space-y-4" noValidate>
            <Field
              label="Fonds de caisse"
              htmlFor="openingAmount"
              required
              error={api.fieldErrors.openingAmount}
              hint="Espèces déjà présentes dans le tiroir à l'ouverture."
            >
              <MoneyInput
                id="openingAmount"
                name="openingAmount"
                defaultValue="0"
                decimals={currency.decimals}
                symbol={currency.symbol}
                required
                className="max-w-56"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Ouverture...' : 'Ouvrir la caisse'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPanel('none'); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      {panel === 'close' && session && (
        <Card title="Fermer la caisse" description={`Solde théorique : ${expectedLabel}`}>
          <form onSubmit={closeSession} className="space-y-4" noValidate>
            <Alert tone="info">
              Comptez les espèces réellement présentes dans le tiroir et saisissez le montant.
              GestiOne calcule l&apos;écart et le conserve tel quel : un manquant doit rester
              visible, pas être effacé.
            </Alert>
            <Field
              label="Montant compte"
              htmlFor="countedAmount"
              required
              error={api.fieldErrors.countedAmount}
            >
              <MoneyInput
                id="countedAmount"
                name="countedAmount"
                defaultValue={expectedRaw}
                decimals={currency.decimals}
                symbol={currency.symbol}
                required
                className="max-w-56"
              />
            </Field>
            <Field label="Observations" htmlFor="notes" error={api.fieldErrors.notes}>
              <Textarea id="notes" name="notes" className="min-h-16" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Fermeture...' : 'Fermer la caisse'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPanel('none'); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      {panel === 'move' && (
        <Card title="Apport ou retrait">
          <form onSubmit={move} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Type" htmlFor="kind" required error={api.fieldErrors.kind}>
                <Select id="kind" name="kind" defaultValue="DEPOSIT">
                  <option value="DEPOSIT">Apport (entrée)</option>
                  <option value="WITHDRAWAL">Retrait (sortie)</option>
                  <option value="ADJUSTMENT">Ajustement</option>
                </Select>
              </Field>
              <Field label="Montant" htmlFor="amount" required error={api.fieldErrors.amount}>
                <MoneyInput
                  id="amount"
                  name="amount"
                  decimals={currency.decimals}
                  symbol={currency.symbol}
                  required
                />
              </Field>
              <Field label="Motif" htmlFor="reason" required error={api.fieldErrors.reason}>
                <Input id="reason" name="reason" required placeholder="Dépôt en banque" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setPanel('none'); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      {session && panel === 'none' && (
        <p className="text-sm text-ink-500">
          Caisse ouverte depuis le {session.openedAt} par {session.openedBy}.{' '}
          <Badge tone="success">Ouverte</Badge>
        </p>
      )}
    </div>
  );
}
