'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { DOCUMENT_FORMATS, type DocumentFormat } from '@/lib/validation/company';

/**
 * Choix du format et impression.
 *
 * Le format se change ici, devant le document, et non dans les parametres :
 * une meme boutique imprime la facture d'un gros client sur une feuille A4 et
 * remet un ticket au client suivant. Obliger a traverser l'administration entre
 * les deux, c'est garantir que personne ne le fera.
 *
 * L'apercu est le document lui-meme : l'attribut pose sur la racine change les
 * dimensions en direct, si bien que ce qui est a l'ecran est exactement ce qui
 * sortira de l'imprimante.
 */

const PAGE_RULES: Record<DocumentFormat, string> = {
  A4: '@page { size: A4; margin: 12mm; }',
  A5: '@page { size: A5; margin: 8mm; }',
  // Rouleau thermique : largeur fixe, hauteur libre — un ticket n'a pas de
  // longueur de page, il s'arrete ou le contenu s'arrete.
  RECEIPT: '@page { size: 80mm auto; margin: 3mm; }',
};

export function PrintControls({ defaultFormat }: { defaultFormat: string }) {
  const searchParams = useSearchParams();
  const initial = (
    DOCUMENT_FORMATS.some((entry) => entry.value === defaultFormat) ? defaultFormat : 'A4'
  ) as DocumentFormat;

  const [format, setFormat] = useState<DocumentFormat>(initial);

  // Le format vit sur la racine du document : la feuille de style s'y accroche
  // pour redimensionner l'apercu comme l'impression.
  useEffect(() => {
    document.documentElement.dataset.printFormat = format;
    return () => {
      delete document.documentElement.dataset.printFormat;
    };
  }, [format]);

  // Arrivee depuis la vente : le vendeur a demande l'impression, on la lui
  // ouvre sans qu'il ait a chercher le bouton.
  const autoPrint = searchParams.get('impression') === '1';
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [autoPrint]);

  return (
    <div className="no-print flex flex-wrap items-end gap-2">
      {/* Regle de page injectee : `@page` ne peut pas etre conditionne par une
          classe, il faut donc remplacer la regle elle-meme. */}
      <style>{PAGE_RULES[format]}</style>

      <label className="text-xs font-medium text-ink-600">
        Format
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value as DocumentFormat)}
          className="mt-0.5 block min-h-11 rounded-lg border-0 bg-white px-3 text-sm text-ink-900 ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
        >
          {DOCUMENT_FORMATS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <Button type="button" onClick={() => window.print()}>
        <Icon name="printer" className="size-4" />
        Imprimer
      </Button>
    </div>
  );
}
