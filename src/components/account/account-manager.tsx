'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';

export interface AccountDevice {
  id: string;
  label: string;
  ipAddress: string;
  lastSeenLabel: string;
  createdLabel: string;
  isCurrent: boolean;
}

/**
 * Ecran « Mon compte ».
 *
 * Les trois formulaires sont independants et chacun porte son propre etat :
 * une erreur sur le mot de passe ne doit pas effacer le message de succes de
 * la modification du nom, ni l'inverse.
 */
export function AccountManager({
  fullName,
  phone,
  email,
  devices,
  passwordMinLength,
}: {
  fullName: string;
  phone: string;
  email: string;
  devices: AccountDevice[];
  passwordMinLength: number;
}) {
  return (
    <div className="space-y-5">
      <IdentityCard fullName={fullName} phone={phone} email={email} />
      <PasswordCard passwordMinLength={passwordMinLength} />
      <DevicesCard devices={devices} />
    </div>
  );
}

function IdentityCard({
  fullName,
  phone,
  email,
}: {
  fullName: string;
  phone: string;
  email: string;
}) {
  const router = useRouter();
  const api = useApi();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send('/api/account', {
      method: 'PUT',
      body: {
        fullName: String(form.get('fullName') ?? ''),
        phone: String(form.get('phone') ?? ''),
      },
      successMessage: 'Vos informations ont ete enregistrees.',
    });
    if (result) router.refresh();
  }

  return (
    <Card
      title="Mes informations"
      description="Ce nom apparait sur les documents que vous emettez et dans le journal d'audit."
    >
      <form onSubmit={save} className="space-y-4" noValidate>
        {api.error && <Alert tone="error">{api.error}</Alert>}
        {api.success && <Alert tone="success">{api.success}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom complet" htmlFor="fullName" required error={api.fieldErrors.fullName}>
            <Input id="fullName" name="fullName" defaultValue={fullName} required autoComplete="name" />
          </Field>
          <Field label="Telephone" htmlFor="phone" error={api.fieldErrors.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={phone} autoComplete="tel" />
          </Field>
        </div>

        <Field
          label="Adresse email"
          htmlFor="email"
          hint="Votre identifiant de connexion. Sa modification demande une verification par courriel, qui n'est pas encore branchee : demandez a un administrateur."
        >
          <Input id="email" value={email} readOnly disabled />
        </Field>

        <Button type="submit" disabled={api.pending}>
          {api.pending ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
      </form>
    </Card>
  );
}

function PasswordCard({ passwordMinLength }: { passwordMinLength: number }) {
  const router = useRouter();
  const api = useApi();
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get('newPassword') ?? '');

    // Verification de la saisie repetee : purement locale, elle n'a aucune
    // raison de faire un aller-retour au serveur.
    if (newPassword !== String(form.get('confirmPassword') ?? '')) {
      setConfirmError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setConfirmError(null);

    const result = await api.send<{ revokedSessions: number }>('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: String(form.get('currentPassword') ?? ''),
        newPassword,
      },
      successMessage:
        'Mot de passe modifie. Vos autres appareils, s\'il y en avait, ont ete deconnectes.',
    });

    if (result) {
      formElement.reset();
      router.refresh();
    }
  }

  return (
    <Card
      title="Mot de passe"
      description="Changer votre mot de passe deconnecte automatiquement vos autres appareils."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {api.error && <Alert tone="error">{api.error}</Alert>}
        {api.success && <Alert tone="success">{api.success}</Alert>}

        <Field
          label="Mot de passe actuel"
          htmlFor="currentPassword"
          required
          error={api.fieldErrors.currentPassword}
        >
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nouveau mot de passe"
            htmlFor="newPassword"
            required
            error={api.fieldErrors.newPassword}
            hint={`Au moins ${passwordMinLength} caracteres, dont une lettre et un chiffre.`}
          >
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={passwordMinLength}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label="Repetez le nouveau mot de passe"
            htmlFor="confirmPassword"
            required
            error={confirmError ?? undefined}
          >
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
            />
          </Field>
        </div>

        <Button type="submit" disabled={api.pending}>
          {api.pending ? 'Modification...' : 'Changer mon mot de passe'}
        </Button>
      </form>
    </Card>
  );
}

function DevicesCard({ devices }: { devices: AccountDevice[] }) {
  const router = useRouter();
  const api = useApi();

  const others = devices.filter((device) => !device.isCurrent);

  async function revoke(id: string) {
    const result = await api.send(`/api/account/sessions/${id}`, {
      method: 'DELETE',
      successMessage: 'Appareil deconnecte.',
    });
    if (result) router.refresh();
  }

  async function revokeAll() {
    if (!window.confirm('Deconnecter tous vos autres appareils ?')) return;
    const result = await api.send('/api/account/sessions', {
      method: 'DELETE',
      successMessage: 'Vos autres appareils ont ete deconnectes.',
    });
    if (result) router.refresh();
  }

  return (
    <Card
      title="Appareils connectes"
      description="Chaque connexion ouvre une session valable 30 jours. Fermez celles que vous ne reconnaissez pas."
      action={
        others.length > 0 ? (
          <Button type="button" variant="secondary" onClick={revokeAll} disabled={api.pending}>
            Deconnecter les autres
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {api.error && <Alert tone="error">{api.error}</Alert>}
        {api.success && <Alert tone="success">{api.success}</Alert>}

        <ul className="divide-y divide-ink-100">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
                  {device.label}
                  {device.isCurrent && <Badge tone="success">Cet appareil</Badge>}
                </p>
                <p className="text-sm text-ink-500">
                  {device.ipAddress} · vu {device.lastSeenLabel} · ouvert {device.createdLabel}
                </p>
              </div>
              {!device.isCurrent && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => revoke(device.id)}
                  disabled={api.pending}
                >
                  Deconnecter
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
