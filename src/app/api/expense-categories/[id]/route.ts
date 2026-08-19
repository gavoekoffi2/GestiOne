import type { NextRequest } from 'next/server';
import { deleteExpenseCategory } from '@/server/services/expenses';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk } from '@/server/http';

export const DELETE = handler(async (_request: NextRequest, { params }) => {
  const context = await requireTenantWith('expenses.delete');
  const { id } = await params;
  const result = await deleteExpenseCategory(context.companyId, id as string);
  return jsonOk(result ?? { id });
});
