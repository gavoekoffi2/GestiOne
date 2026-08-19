import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { listQuerySchema } from '@/lib/validation/list-query';
import { listStock, stockSummary } from '@/server/services/stock-query';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readQuery } from '@/server/http';

const stockQuerySchema = listQuerySchema.extend({
  locationId: z.string().trim().max(64).optional().transform((v) => (v === '' ? undefined : v)),
  categoryId: z.string().trim().max(64).optional().transform((v) => (v === '' ? undefined : v)),
  lowOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
});

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('stock.read');
  const query = readQuery(request, stockQuerySchema);

  const [rows, summary] = await Promise.all([
    listStock(context.companyId, query),
    stockSummary(context.companyId, query.locationId),
  ]);

  return jsonOk({ ...rows, summary });
});
