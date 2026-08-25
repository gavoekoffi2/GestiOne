import type { NextRequest } from 'next/server';
import { categorySchema } from '@/lib/validation/catalog';
import { deleteCategory, updateCategory } from '@/server/services/catalog';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.write');
  const { id } = await params;
  const input = await readJson(request, categorySchema);
  const category = await updateCategory(context.companyId, id as string, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'Category',
    entityId: category.id,
    summary: `Catégorie "${category.name}" modifiée`,
    ipAddress: clientIp(request),
  });

  return jsonOk(category);
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.delete');
  const { id } = await params;
  await deleteCategory(context.companyId, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'DELETE',
    entityType: 'Category',
    entityId: id as string,
    summary: 'Catégorie supprimée',
    ipAddress: clientIp(request),
  });

  return jsonOk({ id });
});
