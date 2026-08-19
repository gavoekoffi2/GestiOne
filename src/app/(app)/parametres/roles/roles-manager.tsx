'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Textarea } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  memberCount: number;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: Array<{ key: string; label: string }>;
}

export function RolesManager({
  roles,
  groups,
}: {
  roles: RoleRow[];
  groups: PermissionGroup[];
}) {
  const router = useRouter();
  const api = useApi();
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allPermissions = groups.flatMap((group) => group.permissions.map((p) => p.key));

  function startEdit(role: RoleRow | 'new') {
    api.reset();
    setEditing(role);
    // Le role administrateur porte le marqueur "*" : on le presente comme
    // l'ensemble complet des permissions, ce qui est son sens exact.
    const permissions =
      role === 'new'
        ? []
        : role.permissions.includes('*')
          ? allPermissions
          : role.permissions;
    setSelected(new Set(permissions));
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(group: PermissionGroup) {
    const keys = group.permissions.map((permission) => permission.key);
    const allSelected = keys.every((key) => selected.has(key));
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;

    const form = new FormData(event.currentTarget);
    const isNew = editing === 'new';
    const isAdmin = editing !== 'new' && editing.key === 'ADMIN';

    const body = {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      // Le role administrateur reste stocke sous forme de "*" : il doit couvrir
      // automatiquement les permissions ajoutees par les prochaines versions.
      permissions: isAdmin ? ['*'] : [...selected],
    };

    const result = await api.send(isNew ? '/api/roles' : `/api/roles/${editing.id}`, {
      method: isNew ? 'POST' : 'PUT',
      body,
      successMessage: isNew ? 'Role cree.' : 'Role mis a jour.',
    });

    if (result) {
      setEditing(null);
      router.refresh();
    }
  }

  async function onDelete(role: RoleRow) {
    const confirmed = window.confirm(`Supprimer le role "${role.name}" ?`);
    if (!confirmed) return;

    const result = await api.send(`/api/roles/${role.id}`, {
      method: 'DELETE',
      successMessage: 'Role supprime.',
    });
    if (result) router.refresh();
  }

  const isAdminRole = editing !== null && editing !== 'new' && editing.key === 'ADMIN';

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {editing ? (
        <Card title={editing === 'new' ? 'Nouveau role' : `Modifier le role ${editing.name}`}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom du role" htmlFor="name" required error={api.fieldErrors.name}>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editing === 'new' ? '' : editing.name}
                  required
                  placeholder="Livreur"
                />
              </Field>
              <Field label="Description" htmlFor="description" error={api.fieldErrors.description}>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={editing === 'new' ? '' : editing.description}
                  className="min-h-11"
                />
              </Field>
            </div>

            {isAdminRole ? (
              <Alert tone="info" title="Acces complet">
                Le role Administrateur couvre en permanence toutes les permissions, y compris celles
                qui seront ajoutees par les futures versions de GestiOne. Son perimetre ne peut pas
                etre reduit : creez un role personnalise pour un acces restreint.
              </Alert>
            ) : (
              <div className="space-y-4">
                {api.fieldErrors.permissions && (
                  <Alert tone="error">{api.fieldErrors.permissions}</Alert>
                )}
                {groups.map((group) => {
                  const keys = group.permissions.map((permission) => permission.key);
                  const allSelected = keys.every((key) => selected.has(key));
                  return (
                    <fieldset key={group.key} className="rounded-lg border border-ink-200 p-3">
                      <legend className="flex items-center gap-3 px-1">
                        <span className="text-sm font-semibold text-ink-800">{group.label}</span>
                        <button
                          type="button"
                          onClick={() => toggleGroup(group)}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          {allSelected ? 'Tout decocher' : 'Tout cocher'}
                        </button>
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {group.permissions.map((permission) => (
                          <label
                            key={permission.key}
                            className="flex items-start gap-2 rounded-md p-1.5 text-sm text-ink-700 hover:bg-ink-50"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(permission.key)}
                              onChange={() => toggle(permission.key)}
                              className="mt-0.5 size-4 rounded border-ink-300"
                            />
                            <span>{permission.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
                <p className="text-sm text-ink-500">
                  {selected.size} permission(s) selectionnee(s).
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setEditing(null); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button type="button" onClick={() => startEdit('new')}>
          Creer un role personnalise
        </Button>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {roles.map((role) => (
          <Card
            key={role.id}
            title={role.name}
            description={role.description || undefined}
            action={
              role.isSystem ? <Badge tone="info">Fourni</Badge> : <Badge>Personnalise</Badge>
            }
          >
            <p className="text-sm text-ink-600">
              {role.permissions.includes('*')
                ? 'Acces complet a toutes les fonctionnalites.'
                : `${role.permissions.length} permission(s).`}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {role.memberCount} utilisateur(s) avec ce role.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className="min-h-9 text-xs"
                onClick={() => startEdit(role)}
              >
                Modifier les permissions
              </Button>
              {!role.isSystem && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 text-xs text-red-600"
                  onClick={() => onDelete(role)}
                  disabled={api.pending}
                >
                  Supprimer
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
