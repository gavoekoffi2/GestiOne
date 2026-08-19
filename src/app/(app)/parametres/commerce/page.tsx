import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@/components/ui/primitives';
import { CommerceSettings } from '@/components/admin/commerce-settings';
import { listPaymentMethods, listTaxRates } from '@/server/services/commerce-setup';
import { CHANNELS } from '@/server/services/notifications';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Reglements et taxes' };
export const dynamic = 'force-dynamic';

export default async function CommerceSettingsPage() {
  const context = await requireTenantWith('settings.company');

  const [methods, taxRates] = await Promise.all([
    listPaymentMethods(context.companyId, true),
    listTaxRates(context.companyId, true),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/parametres" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour aux parametres
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">Reglements et taxes</h1>
        <p className="mt-1 text-ink-600">
          Comment vous encaissez, et quelles taxes s&apos;appliquent a vos documents.
        </p>
      </div>

      <CommerceSettings
        canWrite={can(context, 'settings.company')}
        methods={methods.map((method) => ({
          id: method.id,
          name: method.name,
          kind: method.kind,
          isSystem: method.isSystem,
          isActive: method.isActive,
          affectsCash: method.affectsCash,
          requiresReference: method.requiresReference,
          isCredit: method.isCredit,
        }))}
        taxRates={taxRates.map((tax) => ({
          id: tax.id,
          name: tax.name,
          rate: tax.rate,
          isDefault: tax.isDefault,
          isActive: tax.isActive,
        }))}
      />

      <Card
        title="Alertes"
        description="GestiOne vous signale ce qui demande une action : ruptures de stock, factures en retard, devis proches de l'expiration, dettes echues."
      >
        <p className="text-sm text-ink-600">
          Les alertes sont calculees en direct et apparaissent sur votre tableau de bord. Il
          n&apos;y a rien a marquer comme lu : une alerte disparait quand le probleme est resolu.
        </p>

        <ul className="mt-4 space-y-2">
          {CHANNELS.map((channel) => (
            <li key={channel.key} className="flex items-center justify-between gap-3 text-sm">
              <span className={channel.available ? 'text-ink-800' : 'text-ink-500'}>
                {channel.label}
              </span>
              {channel.available ? (
                <span className="text-xs font-medium text-emerald-700">Actif</span>
              ) : (
                <span className="text-xs text-ink-400">Pas encore disponible</span>
              )}
            </li>
          ))}
        </ul>

        {/*
          Annoncer un canal comme actif alors qu'il n'envoie rien serait pire
          que de ne pas le proposer : l'utilisateur compterait sur une relance
          qui n'arriverait jamais.
        */}
        <p className="mt-4 text-xs text-ink-500">
          L&apos;envoi par courriel, SMS, WhatsApp ou notification push demande un fournisseur
          externe, propre a chaque pays. Ces canaux sont prevus par l&apos;architecture mais ne sont
          pas encore branches : GestiOne ne pretend pas envoyer ce qu&apos;il n&apos;envoie pas.
        </p>
      </Card>
    </div>
  );
}
