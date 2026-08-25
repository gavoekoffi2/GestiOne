'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';
import { LOCATION_KINDS } from '@/lib/validation/company';

export interface LocationRow {
  id: string;
  name: string;
  code: string;
  kind: string;
  addressLine: string;
  city: string;
  phone: string;
  isDefault: boolean;
  isActive: boolean;
}

const EMPTY: Omit<LocationRow, 'id'> = {
  name: '',
  code: '',
  kind: 'SHOP',
  addressLine: '',
  city: '',
  phone: '',
  isDefault: false,
  isActive: true,
};

function kindLabel(kind: string): string {
  return LOCATION_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

export function LocationsManager({ locations }: { locations: LocationRow[] }) {
  const router = useRouter();
  const api = useApi();
  const [editing, setEditing] = useState<LocationRow | 'new' | null>(null);

  const values = editing === 'new' ? { ...EMPTY, id: '' } : editing;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values) return;

    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get('name') ?? ''),
      code: String(form.get('code') ?? ''),
      kind: String(form.get('kind') ?? 'SHOP'),
      addressLine: String(form.get('addressLine') ?? ''),
      city: String(form.get('city') ?? ''),
      phone: String(form.get('phone') ?? ''),
      isDefault: form.get('isDefault') === 'on',
      isActive: form.get('isActive') === 'on',
    };

    const isNew = editing === 'new';
    const result = await api.send(isNew ? '/api/locations' : `/api/locations/${values.id}`, {
      method: isNew ? 'POST' : 'PUT',
      body,
      successMessage: isNew ? 'Point de vente créé.' : 'Point de vente modifié.',
    });

    if (result) {
      setEditing(null);
      router.refresh();
    }
  }

  async function onDelete(location: LocationRow) {
    const confirmed = window.confirm(
      `Supprimer le point de vente "${location.name}" ?\n\nS'il est déjà utilisé, il sera désactivé plutôt que supprimé afin de préserver l'historique.`,
    );
    if (!confirmed) return;

    const result = await api.send(`/api/locations/${location.id}`, {
      method: 'DELETE',
      successMessage: 'Point de vente supprimé.',
    });
    if (result) router.refresh();
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {values ? (
        <Card title={editing === 'new' ? 'Nouveau point de vente' : `Modifier ${values.name}`}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="name" required error={api.fieldErrors.name}>
                <Input id="name" name="name" defaultValue={values.name} required placeholder="Boutique Adjame" />
              </Field>
              <Field
                label="Code"
                htmlFor="code"
                required
                error={api.fieldErrors.code}
                hint="Identifiant court et unique, utilisé dans les références de documents."
              >
                <Input id="code" name="code" defaultValue={values.code} required placeholder="ADJ" />
              </Field>
              <Field label="Type" htmlFor="kind" required error={api.fieldErrors.kind}>
                <Select id="kind" name="kind" defaultValue={values.kind}>
                  {LOCATION_KINDS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Téléphone" htmlFor="phone" error={api.fieldErrors.phone}>
                <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={values.phone} />
              </Field>
              <Field label="Adresse" htmlFor="addressLine" error={api.fieldErrors.addressLine}>
                <Input id="addressLine" name="addressLine" defaultValue={values.addressLine} />
              </Field>
              <Field label="Ville" htmlFor="city" error={api.fieldErrors.city}>
                <Input id="city" name="city" defaultValue={values.city} />
              </Field>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="isDefault"
                  defaultChecked={values.isDefault}
                  className="size-4 rounded border-ink-300"
                />
                Point de vente par défaut
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={values.isActive}
                  className="size-4 rounded border-ink-300"
                />
                Actif
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  api.reset();
                }}
              >
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button type="button" onClick={() => setEditing('new')}>
          Ajouter un point de vente
        </Button>
      )}

      <Card title={`${locations.length} point(s) de vente`}>
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2 font-medium sm:px-5">Nom</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Ville</th>
                <th className="px-4 py-2 font-medium">Statut</th>
                <th className="px-4 py-2 font-medium sm:px-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {locations.map((location) => (
                <tr key={location.id}>
                  <td className="px-4 py-3 font-medium text-ink-900 sm:px-5">{location.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-600">{location.code}</td>
                  <td className="px-4 py-3 text-ink-600">{kindLabel(location.kind)}</td>
                  <td className="px-4 py-3 text-ink-600">{location.city || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {location.isDefault && <Badge tone="info">Par défaut</Badge>}
                      <Badge tone={location.isActive ? 'success' : 'neutral'}>
                        {location.isActive ? 'Actif' : 'Inactif'}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right sm:px-5">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-9 px-2 text-xs"
                        onClick={() => {
                          api.reset();
                          setEditing(location);
                        }}
                      >
                        Modifier
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-9 px-2 text-xs text-red-600"
                        onClick={() => onDelete(location)}
                        disabled={api.pending}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
