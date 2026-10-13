import type { NextRequest } from 'next/server';
import { releaseStockSchema } from '@/lib/validation/commerce';
import { releaseInvoiceStock } from '@/server/services/invoices';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

/** Livraison d'une facture d'avance : le stock sort maintenant. */
export const POST = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('invoices.write');
  const { id } = await params;
  const { locationId } = await readJson(request, releaseStockSchema);
  return jsonOk(
    await releaseInvoiceStock(await commerceContext(context), id as string, { locationId }),
  );
});
