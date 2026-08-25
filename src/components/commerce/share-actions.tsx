'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';

/**
 * Impression et partage d'un document.
 *
 * L'impression utilise la boite de dialogue du navigateur : elle couvre aussi
 * bien une imprimante bureautique qu'une imprimante thermique installee sur le
 * poste, sans pilote specifique a embarquer.
 *
 * Le partage passe par l'API Web Share quand l'appareil la propose — c'est elle
 * qui ouvre WhatsApp, le courriel ou tout autre canal installe. GestiOne
 * n'impose donc aucun canal, et WhatsApp n'est jamais une dependance du
 * fonctionnement. Sur un poste sans partage natif, on retombe sur un lien
 * WhatsApp explicite lorsqu'un numero international est connu, sinon sur la
 * copie du recapitulatif dans le presse-papier.
 */
export function ShareActions({
  summary,
  phone,
  title,
}: {
  summary: string;
  phone: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const searchParams = useSearchParams();

  /*
   * Au comptoir, le reflexe apres un encaissement est d'imprimer le ticket.
   * L'ecran de fin de vente amene donc directement ici avec `?imprimer=1`, et
   * la boite d'impression s'ouvre seule : un clic de moins, et surtout plus
   * d'hesitation sur l'endroit ou trouver le bouton.
   */
  const autoPrint = searchParams.get('imprimer') === '1';
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [autoPrint]);

  const canWhatsApp = phone.trim().startsWith('+');
  const whatsappHref = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(summary)}`;

  async function share() {
    const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;

    if (nav?.share) {
      try {
        await nav.share({ title, text: summary });
      } catch {
        // L'utilisateur a ferme la fenetre de partage : rien d'autre a faire.
      }
      return;
    }

    try {
      await nav?.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 no-print">
      <Button type="button" variant="secondary" onClick={() => window.print()}>
        <Icon name="printer" className="size-4" />
        Imprimer
      </Button>

      <Button type="button" variant="secondary" onClick={share}>
        <Icon name="switch" className="size-4" />
        {copied ? 'Copie dans le presse-papier' : 'Partager'}
      </Button>

      {canWhatsApp && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          Envoyer sur WhatsApp
        </a>
      )}
    </div>
  );
}
