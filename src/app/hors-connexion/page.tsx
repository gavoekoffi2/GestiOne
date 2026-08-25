import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Hors connexion' };

/**
 * Page servie par le service worker quand le reseau manque.
 *
 * Elle dit franchement ce qui est possible et ce qui ne l'est pas. Laisser
 * croire qu'une vente peut etre saisie hors ligne serait bien pire que de
 * l'interdire : le commercant remettrait la marchandise en pensant la vente
 * enregistree.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-100 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-ink-200 sm:p-8">
        <span className="mx-auto grid size-12 place-items-center rounded-lg bg-brand-700 text-xl font-bold text-white">
          G
        </span>

        <h1 className="mt-4 text-xl font-semibold text-ink-900">Vous êtes hors connexion</h1>
        <p className="mt-2 text-ink-600">
          GestiOne a besoin d&apos;Internet pour enregistrer une vente, un paiement ou un mouvement
          de stock.
        </p>

        <div className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-semibold">Pourquoi la saisie est-elle impossible ?</p>
          <p className="mt-1">
            Mettre les ventes en attente reviendrait à vous laisser croire qu&apos;elles sont
            enregistrées alors qu&apos;elles pourraient être refusées à la reconnexion — stock
            épuisé entre-temps, numéro de facture déjà pris. Vous auriez déjà remis la marchandise.
          </p>
        </div>

        <p className="mt-4 text-sm text-ink-500">
          Dès que la connexion revient, tout redevient disponible. Rien de ce que vous aviez
          enregistré n&apos;est perdu.
        </p>

        <a
          href="/tableau-de-bord"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          Reessayer
        </a>
      </div>
    </div>
  );
}
