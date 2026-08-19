import { prisma } from '@/server/db';
import { ensureCurrencies } from '@/server/services/currencies';
import { registerAccount } from '@/server/services/accounts';
import { resetRateLimits } from '@/server/rate-limit';

/**
 * Remet la base de test a zero. `TRUNCATE ... CASCADE` est nettement plus rapide
 * qu'une suppression modele par modele et remet aussi les sequences a plat.
 * `currencies` est preserve puis re-seede : c'est un referentiel, pas une
 * donnee de test.
 */
export async function resetDatabase(): Promise<void> {
  const tables: Array<{ tablename: string }> = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;

  const names = tables
    .map((row) => `"public"."${row.tablename}"`)
    .join(', ');

  if (names) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  }

  resetRateLimits();
  await ensureCurrencies();
}

let counter = 0;

/** Cree une entreprise complete avec son proprietaire, prete a etre utilisee. */
export async function createTestCompany(
  overrides: Partial<{ companyName: string; currencyCode: string; email: string }> = {},
) {
  counter += 1;
  const email = overrides.email ?? `owner${counter}@test.local`;
  const result = await registerAccount({
    fullName: `Proprietaire ${counter}`,
    email,
    phone: undefined,
    password: 'MotDePasse1',
    companyName: overrides.companyName ?? `Entreprise ${counter}`,
    countryCode: 'CI',
    currencyCode: overrides.currencyCode ?? 'XOF',
  });

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: result.companyId, isDefault: true },
  });

  return { ...result, email, locationId: location.id };
}
