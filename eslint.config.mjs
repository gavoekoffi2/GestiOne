import js from '@eslint/js';
import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

/**
 * Configuration ESLint (format « flat », le seul reconnu par ESLint 10).
 *
 * `next lint` a disparu avec Next.js 16 : le script `npm run lint` appelle
 * desormais directement `eslint`, sans quoi la commande echouait en pretendant
 * que « lint » etait un repertoire de projet introuvable.
 */
export default tseslint.config(
  {
    ignores: [
      'src/generated/**', // code produit par Prisma
      '.next/**',
      'node_modules/**',
      'public/sw.js', // service worker : contexte navigateur, sans build
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  {
    rules: {
      // Une variable inutilisee est signalee, sauf si son nom commence par un
      // souligne : c'est la convention pour un parametre volontairement ignore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Les tests manipulent des donnees dont le typage precis n'apporte rien.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
