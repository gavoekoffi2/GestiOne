import { prisma } from '@/server/db';

/**
 * Devises pre-chargees. La liste couvre les zones ou GestiOne est destine a
 * etre utilise en premier, mais rien n'est code en dur ailleurs : ajouter une
 * devise ici (ou en base) suffit a la rendre disponible.
 *
 * `decimals` est la donnee critique : le franc CFA ne se divise pas en
 * centimes, l'euro si.
 */
export const SEED_CURRENCIES = [
  { code: 'XOF', name: 'Franc CFA (UEMOA)', symbol: 'F CFA', decimals: 0, symbolPosition: 'after' },
  { code: 'XAF', name: 'Franc CFA (CEMAC)', symbol: 'FCFA', decimals: 0, symbolPosition: 'after' },
  { code: 'GHS', name: 'Cedi ghaneen', symbol: 'GH₵', decimals: 2, symbolPosition: 'before' },
  { code: 'NGN', name: 'Naira nigerian', symbol: '₦', decimals: 2, symbolPosition: 'before' },
  { code: 'MAD', name: 'Dirham marocain', symbol: 'DH', decimals: 2, symbolPosition: 'after' },
  { code: 'TND', name: 'Dinar tunisien', symbol: 'DT', decimals: 3, symbolPosition: 'after' },
  { code: 'KES', name: 'Shilling kenyan', symbol: 'KSh', decimals: 2, symbolPosition: 'before' },
  { code: 'ZAR', name: 'Rand sud-africain', symbol: 'R', decimals: 2, symbolPosition: 'before' },
  { code: 'CDF', name: 'Franc congolais', symbol: 'FC', decimals: 2, symbolPosition: 'after' },
  { code: 'GNF', name: 'Franc guineen', symbol: 'FG', decimals: 0, symbolPosition: 'after' },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, symbolPosition: 'after' },
  { code: 'USD', name: 'Dollar americain', symbol: '$', decimals: 2, symbolPosition: 'before' },
  { code: 'GBP', name: 'Livre sterling', symbol: '£', decimals: 2, symbolPosition: 'before' },
  { code: 'CAD', name: 'Dollar canadien', symbol: 'CA$', decimals: 2, symbolPosition: 'before' },
] as const;

export async function ensureCurrencies(): Promise<void> {
  await prisma.currency.createMany({
    data: SEED_CURRENCIES.map((currency) => ({ ...currency })),
    skipDuplicates: true,
  });
}

export async function listCurrencies() {
  return prisma.currency.findMany({ orderBy: { code: 'asc' } });
}

export async function getCurrency(code: string) {
  return prisma.currency.findUnique({ where: { code } });
}
