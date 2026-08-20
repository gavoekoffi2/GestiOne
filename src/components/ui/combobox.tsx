'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/layout/icons';

/**
 * Champ de saisie assistee : on tape, on choisit, ou on cree.
 *
 * Une liste deroulante classique impose de creer la fiche du client **avant**
 * de pouvoir vendre. Derriere un comptoir, cela veut dire quitter la vente,
 * remplir un formulaire, revenir, retrouver le panier. Personne ne le fait :
 * on finit par tout vendre au « client de passage », et les creances
 * deviennent introuvables.
 *
 * Ici, le vendeur ecrit simplement le nom. S'il correspond a une fiche
 * existante, elle est proposee et reutilisee — c'est ce qui evite les doublons.
 * Sinon, la fiche est creee a l'enregistrement du document, avec le seul nom :
 * le reste se complete plus tard, si un jour c'est utile.
 */

export interface ComboboxOption {
  id: string;
  label: string;
  /** Deuxieme ligne : telephone, reference, ce qui permet de distinguer deux homonymes. */
  hint?: string;
}

export interface ComboboxValue {
  /** Fiche existante choisie. Vide si le nom saisi n'en designe aucune. */
  id: string;
  /** Texte affiche dans le champ. */
  name: string;
}

export const EMPTY_COMBOBOX: ComboboxValue = { id: '', name: '' };

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder,
  /** Libelle de l'option de creation. Absent = creation interdite, choix dans la liste seulement. */
  createLabel,
  disabled,
  autoFocus,
}: {
  id?: string;
  options: ComboboxOption[];
  value: ComboboxValue;
  onChange: (value: ComboboxValue) => void;
  placeholder?: string;
  createLabel?: (typed: string) => string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listId = `${fieldId}-liste`;

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const typed = value.name.trim();

  const matches = useMemo(() => {
    const needle = normalise(value.name);
    if (!needle) return options.slice(0, 8);
    return options.filter((option) => normalise(option.label).includes(needle)).slice(0, 8);
  }, [options, value.name]);

  // La creation n'est proposee que si le nom saisi ne designe pas deja une
  // fiche : sans cela, deux « Koffi Yao » finiraient par coexister.
  const exactMatch = useMemo(
    () => options.find((option) => normalise(option.label) === normalise(value.name)),
    [options, value.name],
  );

  const canCreate = Boolean(createLabel) && typed.length > 0 && !exactMatch && !value.id;
  const entries: Array<ComboboxOption | 'create'> = canCreate ? [...matches, 'create'] : matches;

  function choose(entry: ComboboxOption | 'create') {
    if (entry === 'create') {
      onChange({ id: '', name: typed });
    } else {
      onChange({ id: entry.id, name: entry.label });
    }
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlight(0);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => {
        const next = current + delta;
        if (next < 0) return entries.length - 1;
        if (next >= entries.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === 'Enter' && open && entries[highlight] !== undefined) {
      // Empeche l'envoi du formulaire : la frappe « Entree » sert d'abord a
      // valider le choix en cours dans la liste.
      event.preventDefault();
      choose(entries[highlight]);
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        id={fieldId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
        value={value.name}
        placeholder={placeholder}
        onChange={(event) => {
          // Modifier le texte detache la fiche choisie : le nom affiche et la
          // fiche enregistree ne doivent jamais diverger.
          onChange({ id: '', name: event.target.value });
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Le clic sur une option provoque d'abord un `blur` : fermer la liste
          // immediatement empecherait la selection.
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
        className="min-h-11 w-full rounded-lg border-0 bg-white px-3 text-base text-ink-900 ring-1 ring-inset ring-ink-300 transition placeholder:text-ink-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-ink-100 disabled:text-ink-500"
      />

      {value.name && !disabled && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange(EMPTY_COMBOBOX);
            setOpen(false);
          }}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-400 hover:text-ink-700"
          aria-label="Effacer"
        >
          <Icon name="close" className="size-4" />
        </button>
      )}

      {open && entries.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-ink-200"
        >
          {entries.map((entry, index) => {
            const isCreate = entry === 'create';
            const key = isCreate ? '__create__' : entry.id;
            const active = index === highlight;

            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(event) => {
                    // Sans cela, le `blur` du champ annulerait le clic.
                    event.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(entry)}
                  className={`flex min-h-11 w-full flex-col justify-center px-3 py-1.5 text-left ${
                    active ? 'bg-brand-50' : ''
                  }`}
                >
                  {isCreate ? (
                    <span className="flex items-center gap-2 text-sm font-medium text-brand-700">
                      <Icon name="user-plus" className="size-4" />
                      {createLabel?.(typed)}
                    </span>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-ink-900">{entry.label}</span>
                      {entry.hint && <span className="text-xs text-ink-500">{entry.hint}</span>}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
