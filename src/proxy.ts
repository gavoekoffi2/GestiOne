import { NextResponse, type NextRequest } from 'next/server';

/**
 * En-tetes de securite dependants de la requete.
 *
 * Les en-tetes fixes (nosniff, anti-cadrage, politique de referent) sont poses
 * une fois pour toutes dans `next.config.ts`. Deux d'entre eux ne peuvent pas
 * l'etre :
 *
 *  * **La politique de securite du contenu (CSP)** doit porter un nonce
 *    different a chaque reponse. C'est ce qui permet d'autoriser les scripts
 *    que Next.js insere dans la page sans ouvrir la porte a `unsafe-inline`,
 *    qui reviendrait a n'avoir aucune protection contre l'injection de script.
 *    Next.js lit le nonce dans l'en-tete et le reporte lui-meme sur ses
 *    balises.
 *
 *  * **HSTS** n'a de sens qu'en HTTPS. Sur `http://localhost`, les navigateurs
 *    l'ignorent ; l'envoyer en production sur un site servi en clair
 *    enfermerait le visiteur sur un schema inaccessible. Il n'est donc emis
 *    qu'en production.
 */
export default function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const isProduction = process.env.NODE_ENV === 'production';

  const policy = [
    "default-src 'self'",
    // `strict-dynamic` laisse un script autorise charger ses propres modules :
    // sans lui, chaque fragment produit par le build devrait etre liste.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Les styles utilitaires sont compiles dans une feuille servie par le site,
    // mais React pose aussi des styles en attribut : les interdire casserait
    // des composants sans rien apporter, un attribut `style` ne pouvant pas
    // executer de code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Aucune requete sortante : ni telemetrie, ni service tiers.
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  if (isProduction) {
    response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Toutes les routes sauf les fichiers deja construits et les icones : ils
     * ne portent pas de HTML, et leur faire traverser le middleware couterait
     * une invocation par image sans rien securiser.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|apple-touch-icon\\.png|sw\\.js|manifest\\.webmanifest).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
