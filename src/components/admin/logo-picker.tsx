'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';

/**
 * Choix du logo affiche en tete des documents.
 *
 * L'image est reduite dans le navigateur avant d'etre envoyee. Une photo prise
 * au telephone pese couramment quatre megaoctets ; telle quelle, elle serait
 * rejetee, et surtout elle voyagerait a chaque affichage de facture sur une
 * connexion mobile deja lente. Reduite a 320 pixels de large — la taille reelle
 * d'un logo sur une facture imprimee — elle tombe sous les cinquante kilooctets.
 *
 * Le resultat est une chaine `data:` transmise avec le reste du formulaire :
 * aucun televersement separe, donc aucun fichier orphelin si l'enregistrement
 * echoue.
 */

const MAX_WIDTH = 320;
const MAX_BYTES = 300_000;

async function shrinkToDataUrl(file: File): Promise<string> {
  // Un SVG est deja une description vectorielle : le passer dans un canevas le
  // transformerait en image matricielle, donc floue a l'impression.
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Impossible de traiter cette image.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // PNG conserve la transparence, indispensable a un logo pose sur du blanc.
  return canvas.toDataURL('image/png');
}

export function LogoPicker({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [logo, setLogo] = useState(defaultValue);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError('');

    try {
      const dataUrl = await shrinkToDataUrl(file);
      if (dataUrl.length > MAX_BYTES) {
        setError('Cette image reste trop lourde. Essayez un fichier PNG plus simple.');
        return;
      }
      setLogo(dataUrl);
    } catch {
      setError("Ce fichier n'a pas pu etre lu comme une image.");
    }
  }

  return (
    <div className="space-y-2">
      {/* La valeur reellement envoyee : le champ visible ne sert qu'a choisir. */}
      <input type="hidden" name={name} value={logo} />

      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-20 w-32 place-items-center overflow-hidden rounded-lg border border-dashed border-ink-300 bg-white">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- image `data:`, sans URL a optimiser
            <img src={logo} alt="Logo de l'entreprise" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-ink-400">
              <Icon name="image" className="size-5" />
              <span className="text-xs">Aucun logo</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
            {logo ? 'Changer le logo' : 'Choisir un logo'}
          </Button>
          {logo && (
            <Button type="button" variant="ghost" onClick={() => setLogo('')}>
              Retirer
            </Button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            // Permet de rechoisir le meme fichier apres l'avoir retire.
            event.target.value = '';
          }}
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <p className="text-xs text-ink-500">
          PNG, JPEG ou SVG. L&apos;image est reduite automatiquement a la taille utile pour une
          facture.
        </p>
      )}
    </div>
  );
}
