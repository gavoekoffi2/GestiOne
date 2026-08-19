/*
 * Service worker de GestiOne.
 *
 * Ce qu'il fait, et surtout ce qu'il ne fait pas.
 *
 * IL FAIT :
 *  - mettre en cache la coquille de l'application (JS, CSS, polices, icones),
 *    pour un demarrage quasi instantane sur une connexion lente ;
 *  - servir une page "hors connexion" claire quand le reseau manque.
 *
 * IL NE FAIT PAS :
 *  - mettre en file d'attente les ventes, paiements ou mouvements de stock
 *    saisis hors connexion.
 *
 * Ce dernier point est un **choix**, pas un oubli. Une file d'attente
 * d'ecritures suppose de resoudre des conflits qu'aucune interface ne peut
 * trancher seule : deux caissiers vendant hors ligne le dernier article en
 * stock, un numero de facture attribue deux fois, un paiement enregistre sur
 * une facture annulee entre-temps. Une file qui « marche presque » ferait
 * croire a un commercant que sa vente est enregistree alors qu'elle sera
 * rejetee a la synchronisation — et il aurait deja remis la marchandise.
 *
 * GestiOne prefere donc dire franchement qu'il faut du reseau pour vendre,
 * plutot que de simuler un mode hors ligne qu'il ne tient pas.
 */

const VERSION = 'gestione-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const OFFLINE_URL = '/hors-connexion';

const PRECACHE = [OFFLINE_URL, '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Les appels d'API ne sont jamais servis depuis le cache : afficher un solde
  // de caisse ou un stock perimes serait plus dangereux qu'une erreur franche.
  if (url.pathname.startsWith('/api/')) return;

  // Ressources versionnees de Next : leur nom change a chaque build, le cache
  // ne peut donc pas devenir obsolete.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Pages : le reseau d'abord, pour ne jamais afficher de donnees perimees.
  // Hors connexion, on annonce clairement la situation.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});
