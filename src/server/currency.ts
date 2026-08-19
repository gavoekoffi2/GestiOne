import { prisma } from '@/server/db';
import { NotFoundError } from '@/server/errors';
import type { CurrencyFormat } from '@/lib/money';

/**
 * Acces au format de la devise d'une entreprise.
 *
 * Le nombre de decimales conditionne l'interpretation de chaque montant saisi :
 * il est lu depuis la base, jamais suppose. Le referentiel des devises change
 * tres rarement, d'ou un cache en memoire qui evite une requete par formulaire.
 */
const cache = new Map<string, CurrencyFormat>();

export async function getCurrencyFormat(currencyCode: string): Promise<CurrencyFormat> {
  const cached = cache.get(currencyCode);
  if (cached) return cached;

  const currency = await prisma.currency.findUnique({ where: { code: currencyCode } });
  if (!currency) throw new NotFoundError(`Devise "${currencyCode}" inconnue.`);

  const format: CurrencyFormat = {
    code: currency.code,
    symbol: currency.symbol,
    decimals: currency.decimals,
    symbolPosition: currency.symbolPosition === 'before' ? 'before' : 'after',
  };
  cache.set(currencyCode, format);
  return format;
}

export function clearCurrencyCache(): void {
  cache.clear();
}
