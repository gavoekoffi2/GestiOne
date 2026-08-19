import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { authenticate } from '@/server/services/accounts';
import {
  changeOwnPassword,
  describeDevice,
  getProfile,
  listActiveSessions,
  revokeOtherSessions,
  revokeOwnSession,
  updateProfile,
} from '@/server/services/profile';
import { createMember, resetMemberPassword } from '@/server/services/members';
import { createSession, revokeSession } from '@/server/auth/session';
import { resolveSession } from '@/server/tenant';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/server/errors';
import { createTestCompany, resetDatabase } from '../helpers';

/**
 * Compte personnel : profil, mot de passe et appareils connectes.
 *
 * Les cas verifies ici sont ceux ou une erreur coute cher a un utilisateur
 * reel : perdre l'acces a son propre compte, ou continuer a etre connecte sur
 * un telephone vole apres avoir change son mot de passe.
 */

beforeEach(async () => {
  await resetDatabase();
});

async function openSession(userId: string, userAgent: string) {
  return createSession({ userId, userAgent, ipAddress: '10.0.0.1' });
}

describe('profil personnel', () => {
  it('met a jour le nom et le telephone', async () => {
    const company = await createTestCompany();

    await updateProfile(company.userId, { fullName: 'Ama Diallo', phone: '+225 07 00 00 00 00' });

    const profile = await getProfile(company.userId);
    expect(profile.fullName).toBe('Ama Diallo');
    expect(profile.phone).toBe('+225 07 00 00 00 00');
  });

  it('efface le telephone lorsque le champ est vide', async () => {
    const company = await createTestCompany();
    await updateProfile(company.userId, { fullName: 'Ama Diallo', phone: '+225 07 00 00 00 00' });
    await updateProfile(company.userId, { fullName: 'Ama Diallo', phone: undefined });

    expect((await getProfile(company.userId)).phone).toBeNull();
  });
});

describe('changement de mot de passe', () => {
  it('remplace le mot de passe et permet de se reconnecter avec le nouveau', async () => {
    const company = await createTestCompany();
    const session = await openSession(company.userId, 'Chrome');

    await changeOwnPassword(company.userId, session.sessionId, 'MotDePasse1', 'NouveauPass2');

    await expect(authenticate(company.email, 'MotDePasse1')).rejects.toThrow(UnauthorizedError);
    const user = await authenticate(company.email, 'NouveauPass2');
    expect(user.userId).toBe(company.userId);
  });

  it('refuse un mot de passe actuel incorrect, sans rien changer', async () => {
    const company = await createTestCompany();
    const session = await openSession(company.userId, 'Chrome');

    await expect(
      changeOwnPassword(company.userId, session.sessionId, 'PasLeBon1', 'NouveauPass2'),
    ).rejects.toThrow(ValidationError);

    // Le mot de passe d'origine fonctionne toujours : rien n'a ete ecrit.
    expect((await authenticate(company.email, 'MotDePasse1')).userId).toBe(company.userId);
  });

  it('refuse de reconduire le mot de passe actuel', async () => {
    const company = await createTestCompany();
    const session = await openSession(company.userId, 'Chrome');

    await expect(
      changeOwnPassword(company.userId, session.sessionId, 'MotDePasse1', 'MotDePasse1'),
    ).rejects.toThrow(ValidationError);
  });

  /**
   * Le scenario qui justifie la fonction : un telephone est vole, la session
   * qu'il porte est deja ouverte. Changer le mot de passe doit couper cet
   * acces, sinon l'operation ne protege rien.
   */
  it('ferme les autres appareils mais conserve celui qui fait la demande', async () => {
    const company = await createTestCompany();
    const current = await openSession(company.userId, 'Chrome sur Windows');
    const stolen = await openSession(company.userId, 'Chrome sur Android');

    const result = await changeOwnPassword(
      company.userId,
      current.sessionId,
      'MotDePasse1',
      'NouveauPass2',
    );

    expect(result.revokedSessions).toBe(1);
    expect(await resolveSession(stolen.token)).toBeNull();
    expect(await resolveSession(current.token)).not.toBeNull();
  });
});

describe('appareils connectes', () => {
  it('ne liste que les sessions vivantes et signale celle en cours', async () => {
    const company = await createTestCompany();
    const current = await openSession(company.userId, 'Firefox sur Linux');
    const other = await openSession(company.userId, 'Safari sur iPhone');
    const closed = await openSession(company.userId, 'Edge');
    await revokeSession(closed.token);

    const sessions = await listActiveSessions(company.userId, current.sessionId);

    expect(sessions.map((session) => session.id).sort()).toEqual(
      [current.sessionId, other.sessionId].sort(),
    );
    expect(sessions.find((session) => session.id === current.sessionId)?.isCurrent).toBe(true);
    expect(sessions.find((session) => session.id === other.sessionId)?.isCurrent).toBe(false);
  });

  it('exclut les sessions expirees', async () => {
    const company = await createTestCompany();
    const current = await openSession(company.userId, 'Firefox');
    const stale = await openSession(company.userId, 'Firefox');
    await prisma.session.update({
      where: { id: stale.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const sessions = await listActiveSessions(company.userId, current.sessionId);
    expect(sessions).toHaveLength(1);
  });

  it('ferme un appareil precis', async () => {
    const company = await createTestCompany();
    const current = await openSession(company.userId, 'Firefox');
    const other = await openSession(company.userId, 'Safari');

    await revokeOwnSession(company.userId, other.sessionId, current.sessionId);

    expect(await resolveSession(other.token)).toBeNull();
    expect(await resolveSession(current.token)).not.toBeNull();
  });

  it("refuse de fermer la session en cours, qui releve du bouton de deconnexion", async () => {
    const company = await createTestCompany();
    const current = await openSession(company.userId, 'Firefox');

    await expect(
      revokeOwnSession(company.userId, current.sessionId, current.sessionId),
    ).rejects.toThrow(ValidationError);
  });

  /**
   * Isolation : l'identifiant d'une session appartenant a quelqu'un d'autre ne
   * doit jamais permettre de le deconnecter, meme au sein d'une entreprise ou
   * l'on se connait.
   */
  it("ne ferme pas la session d'un autre utilisateur", async () => {
    const company = await createTestCompany();
    const role = await prisma.role.findFirstOrThrow({
      where: { companyId: company.companyId, key: 'CASHIER' },
    });
    const member = await createMember(company.companyId, {
      fullName: 'Kofi Mensah',
      email: 'kofi@equipe.test',
      phone: undefined,
      password: 'MotDePasse1',
      roleId: role.id,
      defaultLocationId: undefined,
    });

    const mine = await openSession(company.userId, 'Firefox');
    const theirs = await openSession(member.userId, 'Chrome');

    await expect(
      revokeOwnSession(company.userId, theirs.sessionId, mine.sessionId),
    ).rejects.toThrow(NotFoundError);

    expect(await resolveSession(theirs.token)).not.toBeNull();
  });

  it('ferme tous les autres appareils en une fois', async () => {
    const company = await createTestCompany();
    const current = await openSession(company.userId, 'Firefox');
    const a = await openSession(company.userId, 'Chrome');
    const b = await openSession(company.userId, 'Safari');

    expect(await revokeOtherSessions(company.userId, current.sessionId)).toBe(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
    expect(await resolveSession(current.token)).not.toBeNull();
  });
});

describe("reinitialisation par un administrateur", () => {
  async function addMember(companyId: string, email = 'kofi@equipe.test') {
    const role = await prisma.role.findFirstOrThrow({ where: { companyId, key: 'CASHIER' } });
    return createMember(companyId, {
      fullName: 'Kofi Mensah',
      email,
      phone: undefined,
      password: 'MotDePasse1',
      roleId: role.id,
      defaultLocationId: undefined,
    });
  }

  it('remplace le mot de passe et ferme toutes les sessions du collaborateur', async () => {
    const company = await createTestCompany();
    const member = await addMember(company.companyId);
    const session = await openSession(member.userId, 'Chrome sur Android');

    const result = await resetMemberPassword(company.companyId, member.id, 'ProvisoireX1');

    expect(result.revokedSessions).toBe(1);
    expect(await resolveSession(session.token)).toBeNull();
    expect((await authenticate('kofi@equipe.test', 'ProvisoireX1')).userId).toBe(member.userId);
  });

  /**
   * Un compte partage entre plusieurs entreprises — le comptable qui travaille
   * pour trois commerces — ne doit pas pouvoir etre repris par l'administrateur
   * de l'une d'elles : ce serait l'isolation multi-entreprises contournee par
   * le detournement d'une identite, et non par une requete mal filtree.
   */
  it("refuse de toucher a un compte partage avec une autre entreprise", async () => {
    const first = await createTestCompany();
    const second = await createTestCompany({ email: 'autre@test.local' });

    const member = await addMember(first.companyId, 'comptable@partage.test');
    const secondRole = await prisma.role.findFirstOrThrow({
      where: { companyId: second.companyId, key: 'MANAGER' },
    });
    await createMember(second.companyId, {
      fullName: 'Kofi Mensah',
      email: 'comptable@partage.test',
      phone: undefined,
      password: 'MotDePasse1',
      roleId: secondRole.id,
      defaultLocationId: undefined,
    });

    await expect(
      resetMemberPassword(first.companyId, member.id, 'ProvisoireX1'),
    ).rejects.toThrow(ValidationError);

    // Le mot de passe d'origine est intact.
    expect((await authenticate('comptable@partage.test', 'MotDePasse1')).userId).toBe(member.userId);
  });

  it("refuse l'appartenance d'une autre entreprise", async () => {
    const first = await createTestCompany();
    const second = await createTestCompany({ email: 'autre@test.local' });
    const member = await addMember(second.companyId);

    await expect(
      resetMemberPassword(first.companyId, member.id, 'ProvisoireX1'),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('description des appareils', () => {
  it('reconnait les combinaisons courantes', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome sur Android');

    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1',
      ),
    ).toBe('Safari sur iPhone ou iPad');

    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/121.0')).toBe(
      'Firefox sur Windows',
    );
  });

  it('ne pretend rien quand l\'agent est absent ou inconnu', () => {
    expect(describeDevice(null)).toBe('Appareil inconnu');
    expect(describeDevice('curl/8.0')).toBe('Appareil inconnu');
  });
});
