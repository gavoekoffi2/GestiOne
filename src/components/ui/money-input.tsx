'use client';

import { Input } from '@/components/ui/primitives';
import type { ComponentProps } from 'react';

/**
 * Champ monetaire.
 *
 * Le pas et le clavier s'adaptent a la devise : en franc CFA (0 decimale) le
 * clavier numerique du telephone ne doit pas proposer de virgule, alors qu'en
 * euro elle est indispensable. Le suffixe rappelle en permanence la devise pour
 * eviter toute ambiguite a la saisie.
 */
export function MoneyInput({
  decimals,
  symbol,
  className,
  ...props
}: ComponentProps<'input'> & { decimals: number; symbol: string }) {
  return (
    <div className="relative">
      <Input
        {...props}
        type="text"
        inputMode={decimals === 0 ? 'numeric' : 'decimal'}
        className={`pr-16 text-right tabular ${className ?? ''}`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-500">
        {symbol}
      </span>
    </div>
  );
}
