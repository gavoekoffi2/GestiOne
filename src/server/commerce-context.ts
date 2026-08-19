import { prisma } from '@/server/db';
import type { TenantContext } from '@/server/tenant';

/**
 * Contexte des services commerciaux : identite de l'entreprise plus les
 * prefixes de numerotation qu'elle a choisis. Les prefixes viennent toujours de
 * la base, jamais d'une constante : c'est ce qui permet a chaque entreprise
 * d'imposer son propre format de facture.
 */
export interface CommerceContext {
  companyId: string;
  userId: string;
  invoicePrefix: string;
  quotePrefix: string;
  salePrefix: string;
  paymentPrefix: string;
  defaultDueDays: number;
}

export async function commerceContext(context: TenantContext): Promise<CommerceContext> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: context.companyId },
    select: {
      invoicePrefix: true,
      quotePrefix: true,
      salePrefix: true,
      paymentPrefix: true,
      defaultDueDays: true,
    },
  });

  return { companyId: context.companyId, userId: context.userId, ...company };
}
