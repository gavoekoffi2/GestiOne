import { cx } from '@/components/ui/primitives';

/**
 * Photo d'un article.
 *
 * Derriere un comptoir, on reconnait un article a son emballage bien avant de
 * lire son nom : la vignette est donc le repere principal de l'ecran de vente,
 * et non une decoration. Quand aucune photo n'a ete prise, on affiche les
 * initiales sur un fond stable (derive du nom) plutot qu'un cadre vide : deux
 * articles differents restent ainsi visuellement distincts.
 *
 * L'image est une balise `img` ordinaire et non `next/image` : les photos sont
 * stockees en `data:` directement dans la fiche article, sans hote distant a
 * declarer, et l'optimiseur n'aurait rien a optimiser.
 */

const TINTS = [
  'bg-brand-100 text-brand-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.slice(0, 2).map((word) => word[0] ?? '');
  return letters.join('').toUpperCase();
}

/** Teinte deterministe : le meme article garde la meme couleur d'un ecran a l'autre. */
function tintFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100_000;
  }
  return TINTS[hash % TINTS.length] as string;
}

export function ProductPhoto({
  src,
  name,
  className,
  rounded = 'rounded-lg',
}: {
  src?: string | null;
  name: string;
  /** Dimensions de la vignette (ex. "size-12" ou "aspect-square w-full"). */
  className?: string;
  rounded?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        className={cx('bg-ink-100 object-cover', rounded, className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid place-items-center font-semibold uppercase',
        tintFor(name),
        rounded,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
