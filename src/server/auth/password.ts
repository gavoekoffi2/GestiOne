import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * `promisify` perd la surcharge de `scrypt` qui accepte des options, et sans
 * options les parametres de cout retombent aux valeurs par defaut de Node.
 * On enveloppe donc l'appel a la main.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Hachage des mots de passe avec scrypt (module `crypto` de Node).
 *
 * scrypt est volontairement couteux en memoire, ce qui rend une attaque par
 * force brute sur GPU nettement moins rentable que sur un hash rapide. Le
 * format stocke embarque ses parametres, de sorte qu'ils peuvent etre renforces
 * plus tard sans invalider les mots de passe existants :
 *
 *   scrypt$N$r$p$<sel base64>$<hash base64>
 */

const KEY_LENGTH = 64;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 };

export const PASSWORD_MIN_LENGTH = 8;

export class PasswordError extends Error {}

export function assertPasswordStrength(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordError(
      `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
    );
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw new PasswordError('Le mot de passe doit contenir au moins une lettre et un chiffre.');
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordStrength(password);
  const salt = randomBytes(16);
  const { N, r, p } = DEFAULT_PARAMS;
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(parts[4] as string, 'base64');
  const expected = Buffer.from(parts[5] as string, 'base64');

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * N * r,
    });
  } catch {
    // Hash stocke corrompu (parametres absurdes, sel vide) : c'est un echec de
    // verification, pas une panne du serveur.
    return false;
  }

  // Comparaison a temps constant : une comparaison naive laisserait fuir la
  // longueur du prefixe correct par le temps de reponse.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
