'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/money-input';
import { useApi } from '@/components/ui/use-api';

export interface StockOption {
  id: string;
  label: string;
}

type Operation = 'entree' | 'sortie' | 'transfert' | 'inventaire';

const OPERATIONS: Array<{
  key: Operation;
  label: string;
  endpoint: string;
  description: string;
  permission: 'move' | 'adjust';
}> = [
  {
    key: 'entree',
    label: 'Entree',
    endpoint: '/api/stock/entrees',
    description: 'Reception de marchandise, retour client, production.',
    permission: 'move',
  },
  {
    key: 'sortie',
    label: 'Sortie',
    endpoint: '/api/stock/sorties',
    description: 'Casse, perte, vol, consommation interne, don.',
    permission: 'move',
  },
  {
    key: 'transfert',
    label: 'Transfert',
    endpoint: '/api/stock/transferts',
    description: 'Deplacement entre deux de vos points de vente.',
    permission: 'move',
  },
  {
    key: 'inventaire',
    label: 'Inventaire',
    endpoint: '/api/stock/inventaire',
    description: 'Saisissez la quantite reellement comptee ; l ecart est calcule.',
    permission: 'adjust',
  },
];

export function StockActions({
  products,
  locations,
  defaultLocationId,
  currency,
  canMove,
  canAdjust,
}: {
  products: StockOption[];
  locations: StockOption[];
  defaultLocationId: string;
  currency: { symbol: string; decimals: number };
  canMove: boolean;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [operation, setOperation] = useState<Operation | null>(null);

  const available = OPERATIONS.filter((entry) =>
    entry.permission === 'adjust' ? canAdjust : canMove,
  );

  if (available.length === 0) return null;

  const current = OPERATIONS.find((entry) => entry.key === operation);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;

    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = {
      productId: String(form.get('productId') ?? ''),
      reason: String(form.get('reason') ?? ''),
      reference: String(form.get('reference') ?? ''),
    };

    if (current.key === 'transfert') {
      body.fromLocationId = String(form.get('fromLocationId') ?? '');
      body.toLocationId = String(form.get('toLocationId') ?? '');
      body.quantity = String(form.get('quantity') ?? '');
    } else if (current.key === 'inventaire') {
      body.locationId = String(form.get('locationId') ?? '');
      body.countedQuantity = String(form.get('countedQuantity') ?? '');
    } else {
      body.locationId = String(form.get('locationId') ?? '');
      body.quantity = String(form.get('quantity') ?? '');
      if (current.key === 'entree') body.unitCost = String(form.get('unitCost') ?? '');
    }

    const result = await api.send(current.endpoint, {
      method: 'POST',
      body,
      successMessage: 'Mouvement enregistre.',
    });

    if (result) {
      setOperation(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {current ? (
        <Card title={current.label} description={current.description}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Article" htmlFor="productId" required error={api.fieldErrors.productId}>
              <Select id="productId" name="productId" required defaultValue="">
                <option value="" disabled>
                  Choisir un article
                </option>
                {products.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            {current.key === 'transfert' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Depuis"
                  htmlFor="fromLocationId"
                  required
                  error={api.fieldErrors.fromLocationId}
                >
                  <Select id="fromLocationId" name="fromLocationId" defaultValue={defaultLocationId}>
                    {locations.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Vers" htmlFor="toLocationId" required error={api.fieldErrors.toLocationId}>
                  <Select id="toLocationId" name="toLocationId" defaultValue="">
                    <option value="" disabled>
                      Choisir la destination
                    </option>
                    {locations.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : (
              <Field
                label="Point de vente"
                htmlFor="locationId"
                required
                error={api.fieldErrors.locationId}
              >
                <Select id="locationId" name="locationId" defaultValue={defaultLocationId}>
                  {locations.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {current.key === 'inventaire' ? (
                <Field
                  label="Quantite comptee"
                  htmlFor="countedQuantity"
                  required
                  error={api.fieldErrors.countedQuantity}
                  hint="Le stock reellement present. GestiOne calcule l ecart lui-meme."
                >
                  <Input
                    id="countedQuantity"
                    name="countedQuantity"
                    inputMode="decimal"
                    required
                    className="text-right tabular"
                  />
                </Field>
              ) : (
                <Field
                  label={current.key === 'entree' ? 'Quantite a ajouter au stock' : 'Quantite'}
                  htmlFor="quantity"
                  required
                  error={api.fieldErrors.quantity}
                  hint={
                    current.key === 'entree'
                      ? 'Cette quantite sera ajoutee au stock du point de vente selectionne.'
                      : undefined
                  }
                >
                  <Input
                    id="quantity"
                    name="quantity"
                    inputMode="decimal"
                    required
                    className="text-right tabular"
                  />
                </Field>
              )}

              {current.key === 'entree' && (
                <Field
                  label="Cout unitaire"
                  htmlFor="unitCost"
                  error={api.fieldErrors.unitCost}
                  hint="Facultatif : conserve le prix reellement paye pour ce lot."
                >
                  <MoneyInput
                    id="unitCost"
                    name="unitCost"
                    decimals={currency.decimals}
                    symbol={currency.symbol}
                  />
                </Field>
              )}

              <Field label="Reference" htmlFor="reference" error={api.fieldErrors.reference}>
                <Input id="reference" name="reference" placeholder="Bon de livraison n°..." />
              </Field>
            </div>

            <Field
              label="Motif"
              htmlFor="reason"
              required={current.key === 'inventaire'}
              error={api.fieldErrors.reason}
            >
              <Textarea
                id="reason"
                name="reason"
                className="min-h-16"
                required={current.key === 'inventaire'}
                placeholder={
                  current.key === 'sortie'
                    ? 'Casse a la manutention'
                    : current.key === 'inventaire'
                      ? 'Inventaire mensuel'
                      : undefined
                }
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer le mouvement'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setOperation(null);
                  api.reset();
                }}
              >
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {available.map((entry) => (
            <Button
              key={entry.key}
              type="button"
              variant={entry.key === 'entree' ? 'primary' : 'secondary'}
              onClick={() => {
                api.reset();
                setOperation(entry.key);
              }}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
