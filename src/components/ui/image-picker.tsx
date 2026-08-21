'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { ProductPhoto } from '@/components/ui/product-photo';
import { IMAGE_MAX_LENGTH, IMAGE_MAX_SIDE, isSupportedImageSource } from '@/lib/image';

/**
 * Prise de photo d'un article.
 *
 * Le commercant photographie son produit avec le telephone qu'il a deja en
 * main : le fichier n'est jamais envoye tel quel. Il est redimensionne et
 * recompresse **sur l'appareil** avant l'enregistrement, sinon une photo de
 * 4 Mo partirait sur le reseau a chaque fiche article, et l'ecran de vente
 * mettrait une minute a s'afficher.
 *
 * La valeur retenue voyage dans un champ cache : le formulaire parent n'a rien
 * a savoir de la compression.
 */

/** Redimensionne et compresse jusqu'a tenir sous la limite de stockage. */
async function compress(file: File): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      resolve(element);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    element.src = url;
  });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Compression impossible sur cet appareil.');

  // Deux tentatives : la vignette normale, puis une version plus petite et plus
  // compressee si la premiere depasse encore la limite (photo tres detaillee).
  for (const [side, quality] of [
    [IMAGE_MAX_SIDE, 0.72],
    [320, 0.6],
  ] as const) {
    const ratio = Math.min(1, side / Math.max(image.width, image.height || 1));
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const encoded = canvas.toDataURL('image/jpeg', quality);
    if (encoded.length <= IMAGE_MAX_LENGTH) return encoded;
  }

  throw new Error('Photo trop lourde : reessayez avec une photo plus simple.');
}

export function ImagePicker({
  name,
  defaultValue = '',
  label,
  disabled,
}: {
  /** Nom du champ transmis avec le formulaire. */
  name: string;
  defaultValue?: string;
  /** Nom de l'element photographie, affiche a defaut de photo. */
  label: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Ce fichier n est pas une image.');
      }
      const encoded = await compress(file);
      if (!isSupportedImageSource(encoded)) {
        throw new Error('Format d image non pris en charge.');
      }
      setValue(encoded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Photo illisible.');
    } finally {
      setBusy(false);
      // Permet de re-selectionner le meme fichier apres une erreur.
      if (cameraRef.current) cameraRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex items-start gap-4">
      <input type="hidden" name={name} value={value} />
      <ProductPhoto src={value} name={label} className="size-24 shrink-0" />

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-9 px-3 text-xs"
            disabled={disabled || busy}
            onClick={() => cameraRef.current?.click()}
          >
            {busy ? 'Traitement...' : 'Prendre une photo'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-9 px-3 text-xs"
            disabled={disabled || busy}
            onClick={() => fileRef.current?.click()}
          >
            Choisir une image
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-xs text-red-600"
              disabled={disabled || busy}
              onClick={() => {
                setValue('');
                setError(null);
              }}
            >
              Retirer
            </Button>
          )}
        </div>

        <p className="text-xs text-ink-500">
          La photo est reduite automatiquement et s affiche sur l ecran de vente pour choisir
          l article d un coup d oeil.
        </p>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => void onPick(event.target.files?.[0])}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void onPick(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
