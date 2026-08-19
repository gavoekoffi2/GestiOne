import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/primitives';
import { ImportWizard } from '@/components/admin/import-wizard';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Import de donnees' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const context = await requireTenantWith('settings.import');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Import de donnees</h1>
        <p className="mt-1 text-ink-600">
          Reprenez vos clients et votre catalogue depuis un fichier Excel ou LibreOffice, sans
          ressaisie.
        </p>
      </div>

      <Alert tone="info" title="Rien n'est ecrit avant votre confirmation">
        GestiOne analyse d&apos;abord le fichier et vous montre, ligne par ligne, ce qui sera cree,
        ce qui existe deja et ce qui pose probleme. Vous decidez ensuite.
      </Alert>

      {can(context, 'customers.write') && (
        <ImportWizard target="clients" label="Clients" requiredColumns={['Nom']} />
      )}

      {can(context, 'products.write') && (
        <ImportWizard
          target="produits"
          label="Produits"
          requiredColumns={['Nom', "Prix d'achat", 'Prix de vente']}
        />
      )}

      <p className="text-sm text-ink-500">
        Pour exporter vos donnees, rendez-vous sur la page{' '}
        <Link href="/rapports" className="font-medium text-brand-700 hover:underline">
          Rapports
        </Link>
        .
      </p>
    </div>
  );
}
