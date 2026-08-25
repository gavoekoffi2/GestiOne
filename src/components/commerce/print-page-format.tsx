'use client';

import { useEffect } from 'react';

/**
 * Impose un format de page a l'impression (window.print / export PDF du
 * navigateur). La regle @page est globale au document : ce composant n'est
 * rendu que par les pages concernees, ici le devis au format A5.
 *
 * `rootFontSize` remet le document a l'echelle : toutes les tailles du layout
 * sont en rem, la feuille se reduit donc proportionnellement (marges et
 * espacements des colonnes compris) au lieu d'etre tronquee.
 *
 * La regle est posee depuis un effet plutot que par une balise <style> rendue
 * dans l'arbre : React 19 traite les balises <style> comme des ressources
 * hoistables et supprimait celle-ci a l'hydratation. La regle disparaissait
 * donc juste avant le seul moment ou elle sert — l'impression. L'effet la
 * retire aussi quand on quitte la page, pour qu'elle ne deborde jamais sur
 * l'impression d'un autre document.
 */
export function PrintPageFormat({
  size = 'A5 portrait',
  margin = '10mm',
  rootFontSize = '10px',
}: {
  size?: string;
  margin?: string;
  rootFontSize?: string;
}) {
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-print-page-format', '');
    style.textContent =
      `@page { size: ${size}; margin: ${margin}; }` +
      `@media print { html { font-size: ${rootFontSize}; } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [size, margin, rootFontSize]);

  return null;
}
