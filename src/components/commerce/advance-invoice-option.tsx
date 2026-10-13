'use client';

/**
 * Case "facture d'avance".
 *
 * Decochee par defaut : la facture sort le stock comme toujours. Cochee, la
 * facture s'encaisse sans toucher au stock — typiquement une avance versee
 * avant la livraison. Le stock sortira depuis la facture, a la livraison.
 */
export function AdvanceInvoiceOption({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 rounded border-ink-300"
      />
      <span>
        Ne pas deduire du stock (facture d&apos;avance)
        <span className="block text-xs text-ink-500">
          Pour encaisser une avance avant de livrer. Le stock ne bouge pas ; vous le sortirez
          depuis la facture, au moment de la livraison.
        </span>
      </span>
    </label>
  );
}
