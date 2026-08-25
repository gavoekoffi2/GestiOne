'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';

export interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  roleId: string;
  roleName: string;
  defaultLocationId: string;
  defaultLocationName: string;
  isOwner: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
}

export function MembersManager({
  members,
  roles,
  locations,
  currentMembershipId,
}: {
  members: MemberRow[];
  roles: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  currentMembershipId: string;
}) {
  const router = useRouter();
  const api = useApi();
  const [mode, setMode] = useState<'none' | 'create' | { member: MemberRow }>('none');

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send('/api/members', {
      method: 'POST',
      body: {
        fullName: String(form.get('fullName') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? ''),
        password: String(form.get('password') ?? ''),
        roleId: String(form.get('roleId') ?? ''),
        defaultLocationId: String(form.get('defaultLocationId') ?? ''),
      },
      successMessage: "Collaborateur ajouté. Communiquez-lui son mot de passe provisoire.",
    });
    if (result) {
      setMode('none');
      router.refresh();
    }
  }

  async function onUpdate(event: FormEvent<HTMLFormElement>, member: MemberRow) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send(`/api/members/${member.id}`, {
      method: 'PUT',
      body: {
        roleId: String(form.get('roleId') ?? ''),
        defaultLocationId: String(form.get('defaultLocationId') ?? ''),
        isActive: form.get('isActive') === 'on',
      },
      successMessage: 'Utilisateur mis à jour.',
    });
    if (result) {
      setMode('none');
      router.refresh();
    }
  }

  async function onRemove(member: MemberRow) {
    const confirmed = window.confirm(
      `Retirer ${member.fullName} de l'équipe ?\n\nSes sessions seront immédiatement fermées. L'historique de ses opérations est conserve.`,
    );
    if (!confirmed) return;

    const result = await api.send(`/api/members/${member.id}`, {
      method: 'DELETE',
      successMessage: "Utilisateur retiré de l'équipe.",
    });
    if (result) router.refresh();
  }

  return (
    <div className="space-y-4">
      {api.error && <Alert tone="error">{api.error}</Alert>}
      {api.success && <Alert tone="success">{api.success}</Alert>}

      {mode === 'create' ? (
        <Card title="Ajouter un collaborateur">
          <form onSubmit={onCreate} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom complet" htmlFor="fullName" required error={api.fieldErrors.fullName}>
                <Input id="fullName" name="fullName" required placeholder="Ama Diallo" />
              </Field>
              <Field
                label="Adresse email"
                htmlFor="email"
                required
                error={api.fieldErrors.email}
                hint="Elle servira d'identifiant de connexion."
              >
                <Input id="email" name="email" type="email" inputMode="email" required />
              </Field>
              <Field label="Téléphone" htmlFor="phone" error={api.fieldErrors.phone}>
                <Input id="phone" name="phone" type="tel" inputMode="tel" />
              </Field>
              <Field
                label="Mot de passe provisoire"
                htmlFor="password"
                required
                error={api.fieldErrors.password}
                hint="8 caractères minimum, dont une lettre et un chiffre."
              >
                <Input id="password" name="password" type="text" autoComplete="off" required />
              </Field>
              <Field label="Rôle" htmlFor="roleId" required error={api.fieldErrors.roleId}>
                <Select id="roleId" name="roleId" required defaultValue="">
                  <option value="" disabled>
                    Choisir un rôle
                  </option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Point de vente"
                htmlFor="defaultLocationId"
                error={api.fieldErrors.defaultLocationId}
              >
                <Select id="defaultLocationId" name="defaultLocationId" defaultValue="">
                  <option value="">Aucun en particulier</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Ajout...' : 'Ajouter le collaborateur'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setMode('none'); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        mode === 'none' && (
          <Button type="button" onClick={() => setMode('create')}>
            Ajouter un collaborateur
          </Button>
        )
      )}

      {typeof mode === 'object' && (
        <Card title={`Modifier ${mode.member.fullName}`}>
          <form onSubmit={(event) => onUpdate(event, mode.member)} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rôle" htmlFor="edit-roleId" required error={api.fieldErrors.roleId}>
                <Select id="edit-roleId" name="roleId" defaultValue={mode.member.roleId} required>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Point de vente" htmlFor="edit-locationId">
                <Select
                  id="edit-locationId"
                  name="defaultLocationId"
                  defaultValue={mode.member.defaultLocationId}
                >
                  <option value="">Aucun en particulier</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={mode.member.isActive}
                className="size-4 rounded border-ink-300"
              />
              Compte actif (décocher suspend immédiatement l&apos;accès)
            </label>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={api.pending}>
                {api.pending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setMode('none'); api.reset(); }}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={`${members.length} utilisateur(s)`}>
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2 font-medium sm:px-5">Collaborateur</th>
                <th className="px-4 py-2 font-medium">Rôle</th>
                <th className="px-4 py-2 font-medium">Point de vente</th>
                <th className="px-4 py-2 font-medium">Dernière connexion</th>
                <th className="px-4 py-2 font-medium">Statut</th>
                <th className="px-4 py-2 font-medium sm:px-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-3 sm:px-5">
                    <p className="font-medium text-ink-900">{member.fullName}</p>
                    <p className="text-xs text-ink-500">{member.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-600">{member.roleName}</td>
                  <td className="px-4 py-3 text-ink-600">{member.defaultLocationName || '—'}</td>
                  <td className="px-4 py-3 text-ink-600">
                    {member.lastLoginAt
                      ? new Date(member.lastLoginAt).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })
                      : 'Jamais'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {member.isOwner && <Badge tone="info">Propriétaire</Badge>}
                      <Badge tone={member.isActive ? 'success' : 'danger'}>
                        {member.isActive ? 'Actif' : 'Suspendu'}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right sm:px-5">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-9 px-2 text-xs"
                        onClick={() => { api.reset(); setMode({ member }); }}
                      >
                        Modifier
                      </Button>
                      {!member.isOwner && member.id !== currentMembershipId && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-9 px-2 text-xs text-red-600"
                          onClick={() => onRemove(member)}
                          disabled={api.pending}
                        >
                          Retirer
                        </Button>
                      )}
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
