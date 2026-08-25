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
  // Upsert plutot que createMany : reamorcer une base existante doit aussi
  // remettre a jour les libelles et le nombre de decimales.
  for (const currency of SEED_CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      create: { ...currency },
      update: {
        name: currency.name,
        symbol: currency.symbol,
        decimals: currency.decimals,
        symbolPosition: currency.symbolPosition,
      },
    });
  }
  console.log(`Devises a jour : ${SEED_CURRENCIES.length} au total.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
