import { describe, expect, it } from 'vitest';
import { PasswordError, assertPasswordStrength, hashPassword, verifyPassword } from '@/server/auth/password';

describe('hashPassword', () => {
  it('produit un hash au format documente', async () => {
    const hash = await hashPassword('MotDePasse1');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
  });

  it('ne stocke jamais le mot de passe en clair', async () => {
    const hash = await hashPassword('MotDePasse1');
    expect(hash).not.toContain('MotDePasse1');
  });

  it('utilise un sel different a chaque appel', async () => {
    const [first, second] = await Promise.all([
      hashPassword('MotDePasse1'),
      hashPassword('MotDePasse1'),
    ]);
    expect(first).not.toBe(second);
  });

  it('refuse un mot de passe trop faible', async () => {
    await expect(hashPassword('court1')).rejects.toThrow(PasswordError);
    await expect(hashPassword('sanschiffre')).rejects.toThrow(PasswordError);
    await expect(hashPassword('12345678')).rejects.toThrow(PasswordError);
  });
});

describe('verifyPassword', () => {
  it('accepte le bon mot de passe', async () => {
    const hash = await hashPassword('MotDePasse1');
    expect(await verifyPassword('MotDePasse1', hash)).toBe(true);
  });

  it('refuse un mot de passe errone', async () => {
    const hash = await hashPassword('MotDePasse1');
    expect(await verifyPassword('MotDePasse2', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('rend false plutot que de lever sur un hash corrompu', async () => {
    expect(await verifyPassword('MotDePasse1', 'nimportequoi')).toBe(false);
    expect(await verifyPassword('MotDePasse1', 'scrypt$x$y$z$aa$bb')).toBe(false);
  });

  it('normalise les formes Unicode equivalentes', async () => {
    // "é" compose (U+00E9) et decompose (e + U+0301) doivent ouvrir le meme compte.
    const hash = await hashPassword('caféSecret1');
    expect(await verifyPassword('caféSecret1', hash)).toBe(true);
  });
});

describe('assertPasswordStrength', () => {
  it('accepte un mot de passe conforme', () => {
    expect(() => assertPasswordStrength('MotDePasse1')).not.toThrow();
  });

  it('exige au moins une lettre et un chiffre', () => {
    expect(() => assertPasswordStrength('lettresseulement')).toThrow(PasswordError);
    expect(() => assertPasswordStrength('1234567890')).toThrow(PasswordError);
  });
});
