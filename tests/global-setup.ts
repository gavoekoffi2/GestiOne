import 'dotenv/config';
import { execFileSync } from 'node:child_process';

/**
 * Applique les migrations sur la base de test avant la suite. On utilise
 * `migrate deploy` (et non `db push`) pour verifier au passage que les
 * migrations versionnees sont bien applicables sur une base vierge.
 */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL est manquant. Renseignez-le dans .env (voir .env.example).',
    );
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
