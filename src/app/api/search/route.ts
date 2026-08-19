import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { globalSearch } from '@/server/services/search';
import { requireTenant } from '@/server/tenant';
import { handler, jsonOk, readQuery } from '@/server/http';

const querySchema = z.object({ q: z.string().trim().max(120).default('') });

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenant();
  const { q } = readQuery(request, querySchema);
  return jsonOk(await globalSearch(context.companyId, context.permissions, q));
});
