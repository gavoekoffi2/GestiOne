import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { SEED_CURRENCIES } from '../src/server/services/currencies.js';

/**
 * Amorce du referentiel global.
 *
 * Ce script n'installe que les devises, c'est-a-dire des donnees de reference
 * dont l'application a besoin pour fonctionner. Il ne cree **aucune** entreprise
 * ni aucun jeu de donnees de demonstration : une base amorcee est une base
 * vide et prete, jamais une base qui semble deja contenir une activite.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL est manquant. Copiez .env.example vers .env.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const result = await prisma.currency.createMany({
    data: SEED_CURRENCIES.map((currency) => ({ ...currency })),
    skipDuplicates: true,
  });
  console.log(`Devises installees : ${result.count} ajoutee(s), ${SEED_CURRENCIES.length} au total.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
