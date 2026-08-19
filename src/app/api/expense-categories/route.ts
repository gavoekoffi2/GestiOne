import type { NextRequest } from 'next/server';
import { expenseCategorySchema } from '@/lib/validation/finance';
import { createExpenseCategory, listExpenseCategories } from '@/server/services/expenses';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async () => {
  const context = await requireTenantWith('expenses.read');
  return jsonOk(await listExpenseCategories(context.companyId));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('expenses.write');
  const { name } = await readJson(request, expenseCategorySchema);
  return jsonOk(await createExpenseCategory(context.companyId, name), 201);
});
