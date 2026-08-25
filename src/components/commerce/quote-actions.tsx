'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Field, Select } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';

/**
 * Actions sur un devis. Seules les transitions reellement autorisees par le
 * serveur sont proposees : la liste est calculee cote serveur et transmise ici.
 */
export function QuoteActions({
  quoteId,
  allowedStatuses,
  canConvert,
  canWrite,
  locations,
  defaultLocationId,
  statusLabels,
}: {
  quoteId: string;
  allowedStatuses: string[];
  canConvert: boolean;
  canWrite: boolean;
  locations: Array<{ id: string; label: string }>;
  defaultLocationId: string;
  statusLabels: Record<string, string>;
}) {
  const router = useRouter();
  const api = useApi();
  const [converting, setConverting] = useState(false);
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [issueNow, setIssueNow] = useState(true);

  async function setStatus(status: string) {
    const result = await api.send(`/api/quotes/${quoteId}/statut`, {
      method: 'POST',
      body: { status },
      successMessage: `Devis marque comme "${statusLabels[status] ?? status}".`,
    });
    if (result) router.refresh();
  }

  async function convert() {
    const result = await api.send<{ invoiceId: string }>(`/api/quotes/${quoteId}/convertir`, {
      method: 'POST',
      body: { issue: issueNow, locationId: locationId || undefined },
    });
    if (result) router.push(`/factures/${result.invoiceId}`);
  }

  return (
    <div className="space-y-3 no-print">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {converting ? (
        <Card title="Convertir en facture">
          <div className="space-y-4">
            {locations.length > 0 && (
              <Field
                label="Point de vente"
                htmlFor="convert-location"
                hint="Le stock des articles suivis sortira de ce point de vente."
              >
                <Select
                  id="convert-location"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <label className="flex items-start gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={issueNow}
                onChange={(event) => setIssueNow(event.target.checked)}
                className="mt-0.5 size-4 rounded border-ink-300"
              />
              <span>
                Émettre la facture immédiatement
                <span className="block text-xs text-ink-500">
                  Elle devient exigible et le stock sort. Sinon elle reste en brouillon.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={convert} disabled={api.pending}>
                {api.pending ? 'Conversion...' : 'Convertir en facture'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setConverting(false); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canWrite &&
            allowedStatuses.map((status) => (
              <Button
                key={status}
                type="button"
                variant="secondary"
                onClick={() => setStatus(status)}
                disabled={api.pending}
              >
                Marquer {statusLabels[status]?.toLowerCase() ?? status}
              </Button>
            ))}
          {canConvert && (
            <Button type="button" onClick={() => { api.reset(); setConverting(true); }}>
              Convertir en facture
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
