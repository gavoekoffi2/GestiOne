import 'dotenv/config';

/**
 * Toute la suite parle a la base de test. La substitution doit avoir lieu avant
 * le premier import de `@/server/db`, qui lit `DATABASE_URL` a la construction
 * du client.
 */
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error('TEST_DATABASE_URL est manquant.');
}
process.env.DATABASE_URL = testUrl;
Object.assign(process.env, { NODE_ENV: 'test' });
