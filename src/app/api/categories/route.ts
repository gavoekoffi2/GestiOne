import type { NextRequest } from 'next/server';
import { categorySchema } from '@/lib/validation/catalog';
import { createCategory, listCategories } from '@/server/services/catalog';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async () => {
  const context = await requireTenantWith('products.read');
  return jsonOk(await listCategories(context.companyId));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('products.write');
  const input = await readJson(request, categorySchema);
  const category = await createCategory(context.companyId, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'CREATE',
    entityType: 'Category',
    entityId: category.id,
    summary: `Catégorie "${category.name}" créée`,
    ipAddress: clientIp(request),
  });

  return jsonOk(category, 201);
});
