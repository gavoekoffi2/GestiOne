import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { listMovements } from '@/server/services/stock-query';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readQuery } from '@/server/http';

const movementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  productId: z.string().trim().max(64).optional().transform((v) => (v === '' ? undefined : v)),
  locationId: z.string().trim().max(64).optional().transform((v) => (v === '' ? undefined : v)),
  kind: z.string().trim().max(24).optional().transform((v) => (v === '' ? undefined : v)),
});

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('stock.read');
  return jsonOk(await listMovements(context.companyId, readQuery(request, movementQuerySchema)));
});
