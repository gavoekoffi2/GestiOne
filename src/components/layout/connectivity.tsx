'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Indicateur de connexion et enregistrement du service worker.
 *
 * L'indicateur n'apparait que lorsque la connexion est perdue, et dit
 * exactement ce qui devient impossible. Une banniere permanente serait ignoree
 * au bout de deux jours ; une banniere qui n'apparait que quand c'est vrai est
 * lue.
 */
/**
 * L'etat du reseau vit dans le navigateur, pas dans React : il se lit donc par
 * `useSyncExternalStore`. Copier `navigator.onLine` dans un `useState` depuis un
 * effet afficherait « en ligne » pendant un rendu avant de se corriger, et
 * declencherait un rendu en cascade a chaque montage.
 *
 * `navigator.onLine` est faux-negatif rare mais faux-positif frequent : il dit
 * « en ligne » des qu'une interface reseau est active, meme sans acces reel. Il
 * reste le meilleur signal immediat ; les erreurs de requete completent le
 * tableau lorsqu'elles surviennent.
 */
function subscribeToNetwork(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function Connectivity() {
  const online = useSyncExternalStore(
    subscribeToNetwork,
    () => navigator.onLine,
    // Rendu serveur : aucun navigateur, donc aucune raison d'annoncer une
    // coupure. La valeur reelle est lue des l'hydratation.
    () => true,
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // L'enregistrement echoue silencieusement en HTTP non securise (hors
    // localhost) : c'est attendu, et l'application fonctionne sans.
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-14 z-40 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
    >
      <strong>Hors connexion.</strong> Vous pouvez consulter les pages deja ouvertes, mais
      enregistrer une vente, un paiement ou un mouvement de stock demande Internet.
    </div>
  );
}
