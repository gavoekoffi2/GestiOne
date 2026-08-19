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

/**
 * Contexte de service pret a l'emploi pour les tests des modules commerciaux.
 * Reprend les prefixes de numerotation reels de l'entreprise.
 */
export async function serviceContext(companyId: string, userId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      invoicePrefix: true,
      quotePrefix: true,
      salePrefix: true,
      purchasePrefix: true,
      paymentPrefix: true,
      defaultDueDays: true,
    },
  });
  return { companyId, userId, ...company };
}

/** Identifiant d'un mode de reglement systeme (CASH, MOBILE_MONEY, CREDIT...). */
export async function paymentMethodId(companyId: string, code: string) {
  const method = await prisma.paymentMethod.findFirstOrThrow({ where: { companyId, code } });
  return method.id;
}
