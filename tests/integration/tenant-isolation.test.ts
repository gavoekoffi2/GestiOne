import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { createSession, hashToken, revokeSession } from '@/server/auth/session';
import { loadTenantContext, requirePermission, resolveSession } from '@/server/tenant';
import { ForbiddenError } from '@/server/errors';
import { createTestCompany, resetDatabase } from '../helpers';

/**
 * L'isolation multi-entreprises est la garantie la plus critique du produit :
 * une seule fuite compromettrait la confiance de toutes les PME hebergees.
 * Ces tests verifient qu'elle tient meme quand un identifiant valide d'une
 * autre entreprise est fourni explicitement.
 */

beforeEach(async () => {
  await resetDatabase();
});

describe('isolation entre entreprises', () => {
  it('refuse de charger le contexte d une appartenance appartenant a un autre utilisateur', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    const session = await createSession({ userId: alpha.userId });

    // L'utilisateur d'Alpha presente l'identifiant d'appartenance de Beta.
    const context = await loadTenantContext(session.sessionId, alpha.userId, beta.membershipId);
    expect(context).toBeNull();
  });

  it('charge le contexte de sa propre entreprise', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const session = await createSession({ userId: alpha.userId });

    const context = await loadTenantContext(session.sessionId, alpha.userId, alpha.membershipId);
    expect(context?.companyId).toBe(alpha.companyId);
    expect(context?.roleKey).toBe('ADMIN');
    expect(context?.permissions).toEqual(['*']);
  });

  it('ne rend que les appartenances de l utilisateur connecte', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    await createTestCompany({ companyName: 'Beta' });

    const { token } = await createSession({ userId: alpha.userId });
    const session = await resolveSession(token);

    expect(session?.memberships).toHaveLength(1);
    expect(session?.memberships[0]?.companyId).toBe(alpha.companyId);
  });

  it('gere un utilisateur reellement present dans deux entreprises', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    const betaSalesRole = await prisma.role.findFirstOrThrow({
      where: { companyId: beta.companyId, key: 'SALES' },
    });
    const invited = await prisma.membership.create({
      data: { userId: alpha.userId, companyId: beta.companyId, roleId: betaSalesRole.id },
    });

    const { token, sessionId } = await createSession({ userId: alpha.userId });
    const session = await resolveSession(token);
    expect(session?.memberships).toHaveLength(2);

    const inAlpha = await loadTenantContext(sessionId, alpha.userId, alpha.membershipId);
    const inBeta = await loadTenantContext(sessionId, alpha.userId, invited.id);

    expect(inAlpha?.companyId).toBe(alpha.companyId);
    expect(inAlpha?.roleKey).toBe('ADMIN');
    expect(inBeta?.companyId).toBe(beta.companyId);
    expect(inBeta?.roleKey).toBe('SALES');

    // Le meme utilisateur n'a pas les memes droits selon l'entreprise active.
    expect(() => requirePermission(inAlpha!, 'settings.users')).not.toThrow();
    expect(() => requirePermission(inBeta!, 'settings.users')).toThrow(ForbiddenError);
  });

  it('refuse une appartenance desactivee', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    await prisma.membership.update({
      where: { id: alpha.membershipId },
      data: { isActive: false },
    });

    const { sessionId } = await createSession({ userId: alpha.userId });
    expect(await loadTenantContext(sessionId, alpha.userId, alpha.membershipId)).toBeNull();
  });

  it('cloisonne les roles : modifier un role d Alpha ne change rien chez Beta', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await prisma.role.updateMany({
      where: { companyId: alpha.companyId, key: 'SALES' },
      data: { permissions: ['sales.read'] },
    });

    const betaSales = await prisma.role.findFirstOrThrow({
      where: { companyId: beta.companyId, key: 'SALES' },
    });
    expect(betaSales.permissions.length).toBeGreaterThan(1);
  });

  it('supprime en cascade toutes les donnees d une entreprise supprimee', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await prisma.company.delete({ where: { id: alpha.companyId } });

    expect(await prisma.role.count({ where: { companyId: alpha.companyId } })).toBe(0);
    expect(await prisma.location.count({ where: { companyId: alpha.companyId } })).toBe(0);
    expect(await prisma.membership.count({ where: { companyId: alpha.companyId } })).toBe(0);

    // Beta est intacte.
    expect(await prisma.role.count({ where: { companyId: beta.companyId } })).toBe(5);
    expect(await prisma.user.count()).toBe(2);
  });
});

describe('sessions', () => {
  it('ne stocke jamais le jeton en clair', async () => {
    const alpha = await createTestCompany();
    const { token } = await createSession({ userId: alpha.userId });

    const stored = await prisma.session.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(token);
    expect(stored[0]?.tokenHash).toBe(hashToken(token));
  });

  it('rejette un jeton inconnu', async () => {
    await createTestCompany();
    expect(await resolveSession('jeton-invente')).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
  });

  it('rejette une session revoquee', async () => {
    const alpha = await createTestCompany();
    const { token } = await createSession({ userId: alpha.userId });

    expect(await resolveSession(token)).not.toBeNull();
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it('rejette une session expiree', async () => {
    const alpha = await createTestCompany();
    const { token, sessionId } = await createSession({ userId: alpha.userId });

    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resolveSession(token)).toBeNull();
  });

  it('rejette la session d un utilisateur desactive', async () => {
    const alpha = await createTestCompany();
    const { token } = await createSession({ userId: alpha.userId });

    await prisma.user.update({ where: { id: alpha.userId }, data: { isActive: false } });
    expect(await resolveSession(token)).toBeNull();
  });
});
