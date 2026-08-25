'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
} from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';

export interface CategoryRow {
  id: string;
  name: string;
  parentId: string;
  parentName: string;
  productCount: number;
}

export interface UnitRow {
  id: string;
  name: string;
  symbol: string;
  isSystem: boolean;
  productCount: number;
}

export function OrganisationManager({
  categories,
  units,
  canWrite,
  canDelete,
}: {
  categories: CategoryRow[];
  units: UnitRow[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [category, setCategory] = useState<CategoryRow | 'new' | null>(null);
  const [unit, setUnit] = useState<UnitRow | 'new' | null>(null);

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category) return;

    const form = new FormData(event.currentTarget);
    const isNew = category === 'new';
    const result = await api.send(
      isNew ? '/api/categories' : `/api/categories/${category.id}`,
      {
        method: isNew ? 'POST' : 'PUT',
        body: {
          name: String(form.get('name') ?? ''),
          parentId: String(form.get('parentId') ?? ''),
        },
        successMessage: isNew ? 'Catégorie créée.' : 'Catégorie modifiée.',
      },
    );
    if (result) {
      setCategory(null);
      router.refresh();
    }
  }

  async function submitUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unit) return;

    const form = new FormData(event.currentTarget);
    const isNew = unit === 'new';
    const result = await api.send(isNew ? '/api/units' : `/api/units/${unit.id}`, {
      method: isNew ? 'POST' : 'PUT',
      body: {
        name: String(form.get('name') ?? ''),
        symbol: String(form.get('symbol') ?? ''),
      },
      successMessage: isNew ? 'Unité créée.' : 'Unité modifiée.',
    });
    if (result) {
      setUnit(null);
      router.refresh();
    }
  }

  async function remove(kind: 'categories' | 'units', id: string, label: string) {
    if (!window.confirm(`Supprimer "${label}" ?`)) return;
    const result = await api.send(`/api/${kind}/${id}`, {
      method: 'DELETE',
      successMessage: 'Suppression effectuée.',
    });
    if (result) router.refresh();
  }

  return (
    <div className="space-y-5">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      <Card
        title="Catégories"
        description="Classez vos articles pour les retrouver plus vite et analyser vos ventes par famille."
        action={
          canWrite &&
          !category && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-9 text-xs"
              onClick={() => {
                api.reset();
                setCategory('new');
              }}
            >
              Ajouter
            </Button>
          )
        }
      >
        {category && (
          <form onSubmit={submitCategory} className="mb-5 space-y-4 rounded-lg bg-ink-50 p-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="category-name" required error={api.fieldErrors.name}>
                <Input
                  id="category-name"
                  name="name"
                  defaultValue={category === 'new' ? '' : category.name}
                  required
                  placeholder="Boissons"
                />
              </Field>
              <Field
                label="Catégorie parente"
                htmlFor="category-parent"
                error={api.fieldErrors.parentId}
                hint="Laissez vide pour une catégorie de premier niveau."
              >
                <Select
                  id="category-parent"
                  name="parentId"
                  defaultValue={category === 'new' ? '' : category.parentId}
                >
                  <option value="">Aucune</option>
                  {categories
                    .filter((option) => category === 'new' || option.id !== category.id)
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.parentName ? `${option.parentName} › ${option.name}` : option.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setCategory(null); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        )}

        {categories.length === 0 ? (
          <EmptyState
            title="Aucune catégorie"
            description="Les catégories sont facultatives, mais elles rendent le catalogue et les rapports beaucoup plus lisibles."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {categories.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">
                    {row.parentName && <span className="text-ink-400">{row.parentName} › </span>}
                    {row.name}
                  </p>
                  <p className="text-xs text-ink-500">{row.productCount} article(s)</p>
                </div>
                {canWrite && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-9 px-2 text-xs"
                    onClick={() => { api.reset(); setCategory(row); }}
                  >
                    Modifier
                  </Button>
                )}
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-9 px-2 text-xs text-red-600"
                    onClick={() => remove('categories', row.id, row.name)}
                    disabled={api.pending}
                  >
                    Supprimer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Unités de mesure"
        description="GestiOne fournit les unités courantes. Ajoutez les vôtres : régime, casier, botte, bidon de 20 L..."
        action={
          canWrite &&
          !unit && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-9 text-xs"
              onClick={() => {
                api.reset();
                setUnit('new');
              }}
            >
              Ajouter
            </Button>
          )
        }
      >
        {unit && (
          <form onSubmit={submitUnit} className="mb-5 space-y-4 rounded-lg bg-ink-50 p-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="unit-name" required error={api.fieldErrors.name}>
                <Input
                  id="unit-name"
                  name="name"
                  defaultValue={unit === 'new' ? '' : unit.name}
                  required
                  placeholder="Régime de bananes"
                />
              </Field>
              <Field label="Symbole" htmlFor="unit-symbol" required error={api.fieldErrors.symbol}>
                <Input
                  id="unit-symbol"
                  name="symbol"
                  defaultValue={unit === 'new' ? '' : unit.symbol}
                  required
                  placeholder="reg"
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setUnit(null); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        )}

        <ul className="grid gap-2 sm:grid-cols-2">
          {units.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">
                  {row.name} <span className="font-mono text-xs text-ink-500">({row.symbol})</span>
                </p>
                <p className="text-xs text-ink-500">{row.productCount} article(s)</p>
              </div>
              {row.isSystem ? (
                <Badge tone="info">Fournie</Badge>
              ) : (
                <>
                  {canWrite && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-9 px-2 text-xs"
                      onClick={() => { api.reset(); setUnit(row); }}
                    >
                      Modifier
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-9 px-2 text-xs text-red-600"
                      onClick={() => remove('units', row.id, row.name)}
                      disabled={api.pending}
                    >
                      Supprimer
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
