'use client';

import { useEffect, useState } from 'react';

/**
 * Indicateur de connexion et enregistrement du service worker.
 *
 * L'indicateur n'apparait que lorsque la connexion est perdue, et dit
 * exactement ce qui devient impossible. Une banniere permanente serait ignoree
 * au bout de deux jours ; une banniere qui n'apparait que quand c'est vrai est
 * lue.
 */
export function Connectivity() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // `navigator.onLine` est faux-negatif rare mais faux-positif frequent : il
    // dit "en ligne" des qu'une interface reseau est active, meme sans acces
    // reel. Il reste le meilleur signal immediat ; les erreurs de requete
    // completent le tableau lorsqu'elles surviennent.
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

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
      className="no-print sticky top-14 z-40 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
    >
      <strong>Hors connexion.</strong> Vous pouvez consulter les pages déjà ouvertes, mais
      enregistrer une vente, un paiement ou un mouvement de stock demande Internet.
    </div>
  );
}
