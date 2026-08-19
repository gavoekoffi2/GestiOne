import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import {
  checkRateLimit,
  clearRateLimit,
  peekRateLimit,
  recordAttempt,
  resetRateLimits,
} from '@/server/rate-limit';

beforeEach(() => {
  resetRateLimits();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('peekRateLimit', () => {
  it('ne consomme rien', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(peekRateLimit('cle', 3, 60).allowed).toBe(true);
    }
  });

  it('bloque une fois la limite atteinte', () => {
    for (let i = 0; i < 3; i += 1) recordAttempt('cle', 60);
    const result = peekRateLimit('cle', 3, 60);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('libere la cle une fois la fenetre ecoulee', () => {
    for (let i = 0; i < 3; i += 1) recordAttempt('cle', 60);
    expect(peekRateLimit('cle', 3, 60).allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(peekRateLimit('cle', 3, 60).allowed).toBe(true);
  });

  it('isole les cles les unes des autres', () => {
    for (let i = 0; i < 3; i += 1) recordAttempt('a', 60);
    expect(peekRateLimit('a', 3, 60).allowed).toBe(false);
    expect(peekRateLimit('b', 3, 60).allowed).toBe(true);
  });
});

describe('clearRateLimit', () => {
  it('remet une cle a zero apres une authentification reussie', () => {
    for (let i = 0; i < 3; i += 1) recordAttempt('login:user:kofi', 900);
    expect(peekRateLimit('login:user:kofi', 3, 900).allowed).toBe(false);

    clearRateLimit('login:user:kofi');
    expect(peekRateLimit('login:user:kofi', 3, 900).allowed).toBe(true);
  });
});

describe('checkRateLimit', () => {
  it('consomme a chaque appel autorise', () => {
    expect(checkRateLimit('cle', 2, 60).allowed).toBe(true);
    expect(checkRateLimit('cle', 2, 60).allowed).toBe(true);
    expect(checkRateLimit('cle', 2, 60).allowed).toBe(false);
  });

  it("ne consomme pas quand l'appel est deja refuse", () => {
    checkRateLimit('cle', 1, 60);
    checkRateLimit('cle', 1, 60);
    checkRateLimit('cle', 1, 60);

    // Une fois la fenetre passee, la cle repart d'un seul appel consomme et non
    // de trois : un refus ne doit pas prolonger le blocage.
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit('cle', 1, 60).allowed).toBe(true);
  });
});

describe('scenario boutique : une equipe derriere une seule adresse IP', () => {
  it('ne bloque jamais des connexions reussies successives', () => {
    // Six caissiers prennent leur poste : aucune tentative n'est enregistree,
    // car seuls les echecs alimentent le compteur.
    for (let i = 0; i < 6; i += 1) {
      expect(peekRateLimit('login:ip:41.66.0.1', 30, 300).allowed).toBe(true);
    }
  });

  it('arrete malgre tout un bourrage d identifiants', () => {
    for (let i = 0; i < 8; i += 1) recordAttempt('login:user:cible@test', 900);
    expect(peekRateLimit('login:user:cible@test', 8, 900).allowed).toBe(false);
  });
});
