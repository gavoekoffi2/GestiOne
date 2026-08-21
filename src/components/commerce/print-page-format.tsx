/**
 * Impose un format de page a l'impression (window.print / export PDF du
 * navigateur). La regle @page est globale au document : ce composant n'est
 * rendu que par les pages concernees, ici le devis au format A5.
 *
 * `rootFontSize` remet le document a l'echelle : toutes les tailles du layout
 * sont en rem, la feuille se reduit donc proportionnellement (marges et
 * espacements des colonnes compris) au lieu d'etre tronquee.
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
  return (
    <style>{`@page { size: ${size}; margin: ${margin}; } @media print { html { font-size: ${rootFontSize}; } }`}</style>
  );
}
