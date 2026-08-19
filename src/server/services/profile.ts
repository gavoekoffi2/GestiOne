import { prisma } from '@/server/db';
import { NotFoundError, ValidationError } from '@/server/errors';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import type { ProfileInput } from '@/lib/validation/profile';

/**
 * Compte personnel de l'utilisateur connecte.
 *
 * A distinguer de `members.ts`, qui gere les acces *des autres* : ici,
 * l'utilisateur agit sur son propre compte, et aucune permission d'entreprise
 * n'entre en jeu. Un caissier sans aucun droit d'administration doit pouvoir
 * changer son mot de passe — c'est meme la condition pour qu'un mot de passe
 * provisoire remis par l'employeur cesse d'etre connu de deux personnes.
 *
 * Toutes les fonctions prennent `userId` en premier argument et ne lisent
 * jamais l'identite depuis un autre canal : impossible d'agir sur le compte
 * d'autrui par ce module.
 */

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });
  if (!user) throw new NotFoundError('Compte introuvable.');
  return user;
}

export async function updateProfile(userId: string, input: ProfileInput) {
  return prisma.user.update({
    where: { id: userId },
    data: { fullName: input.fullName, phone: input.phone ?? null },
    select: { id: true, fullName: true, phone: true },
  });
}

export interface ActiveSession {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  isCurrent: boolean;
}

/**
 * Appareils actuellement connectes au compte.
 *
 * Les sessions revoquees et expirees sont exclues : afficher « expire il y a
 * deux mois » n'apprend rien et noie la seule information utile — quelqu'un
 * d'autre est-il connecte en ce moment.
 */
export async function listActiveSessions(
  userId: string,
  currentSessionId: string,
): Promise<ActiveSession[]> {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
    },
  });

  return sessions.map((session) => ({ ...session, isCurrent: session.id === currentSessionId }));
}

/**
 * Revoque une session precise du compte.
 *
 * Le `userId` fait partie du filtre : fournir l'identifiant de la session d'un
 * autre utilisateur ne revoque rien et rend 404, jamais la session d'autrui.
 */
export async function revokeOwnSession(
  userId: string,
  sessionId: string,
  currentSessionId: string,
): Promise<void> {
  if (sessionId === currentSessionId) {
    throw new ValidationError(
      "Cet appareil est celui que vous utilisez : servez-vous du bouton « Se deconnecter ».",
    );
  }

  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) throw new NotFoundError('Cette session est deja fermee.');
}

/** Ferme toutes les autres sessions. Renvoie le nombre d'appareils deconnectes. */
export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, id: { not: currentSessionId } },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Change le mot de passe et ferme les autres sessions.
 *
 * Changer son mot de passe apres un vol de telephone n'a d'interet que si
 * l'appareil vole perd l'acces : une session deja ouverte survivrait au
 * changement, puisqu'elle ne represente pas le mot de passe. La revocation
 * n'est donc pas une option, elle fait partie de l'operation.
 *
 * La session courante est preservee : sinon l'utilisateur se deconnecterait
 * lui-meme a chaque changement, ce qui decourage la bonne pratique.
 */
export async function changeOwnPassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ revokedSessions: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new NotFoundError('Compte introuvable.');

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  // 422 et non 401 : l'utilisateur *est* authentifie, c'est le champ du
  // formulaire qui est faux. Un 401 ferait croire a l'interface que la session
  // a expire et renverrait vers la page de connexion.
  if (!valid) throw new ValidationError('Mot de passe actuel incorrect.', { currentPassword: 'Mot de passe actuel incorrect.' });

  if (currentPassword === newPassword) {
    throw new ValidationError('Le nouveau mot de passe doit etre different de l\'actuel.', {
      newPassword: "Le nouveau mot de passe doit etre different de l'actuel.",
    });
  }

  const passwordHash = await hashPassword(newPassword);

  const [, revoked] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { revokedSessions: revoked.count };
}

/**
 * Resume lisible d'un agent utilisateur.
 *
 * Aucune bibliotheque de detection : elles pesent lourd, vieillissent mal et
 * n'apportent rien de plus ici. L'utilisateur a besoin de reconnaitre *son*
 * appareil parmi deux ou trois, pas d'un numero de version exact.
 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Appareil inconnu';

  const platform = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iPhone ou iPad'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? 'Mac'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : null;

  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /OPR\/|Opera/i.test(userAgent)
      ? 'Opera'
      : /Chrome\//i.test(userAgent)
        ? 'Chrome'
        : /Firefox\//i.test(userAgent)
          ? 'Firefox'
          : /Safari\//i.test(userAgent)
            ? 'Safari'
            : null;

  if (platform && browser) return `${browser} sur ${platform}`;
  return browser ?? platform ?? 'Appareil inconnu';
}
