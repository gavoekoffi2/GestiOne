import { describe, expect, it } from 'vitest';
import { daysBetween, formatDate, formatDateTime, formatRelative } from '@/lib/dates';

/**
 * Mise en forme des dates.
 *
 * Comme le formatage monetaire, elle est ecrite a la main : `Intl` varie selon
 * la version d'ICU embarquee, et un rendu serveur qui differe du rendu
 * navigateur provoque une erreur d'hydratation React.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatDate', () => {
  it('complete le jour et le mois a deux chiffres', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('05/01/2026');
    expect(formatDate(new Date(2026, 11, 31))).toBe('31/12/2026');
  });
});

describe('formatDateTime', () => {
  it('ajoute l heure sur deux chiffres', () => {
    expect(formatDateTime(new Date(2026, 7, 19, 9, 5))).toBe('19/08/2026 a 09h05');
    expect(formatDateTime(new Date(2026, 7, 19, 23, 59))).toBe('19/08/2026 a 23h59');
  });
});

describe('formatRelative', () => {
  const now = new Date(2026, 7, 19, 12, 0);

  it('parle en minutes puis en heures', () => {
    expect(formatRelative(new Date(now.getTime() - 30_000), now)).toBe("a l'instant");
    expect(formatRelative(new Date(now.getTime() - 20 * MINUTE), now)).toBe('il y a 20 minutes');
    expect(formatRelative(new Date(now.getTime() - HOUR), now)).toBe('il y a 1 heure');
    expect(formatRelative(new Date(now.getTime() - 5 * HOUR), now)).toBe('il y a 5 heures');
  });

  it('dit « hier » puis compte les jours', () => {
    expect(formatRelative(new Date(now.getTime() - DAY), now)).toBe('hier');
    expect(formatRelative(new Date(now.getTime() - 3 * DAY), now)).toBe('il y a 3 jours');
  });

  /**
   * Au-dela d'une semaine, « il y a 43 jours » demande un calcul mental que la
   * date evite.
   */
  it('bascule sur la date au-dela d une semaine', () => {
    expect(formatRelative(new Date(now.getTime() - 40 * DAY), now)).toBe('le 10/07/2026');
  });

  /**
   * Les horloges d'un poste de vente et du serveur ne sont pas toujours
   * d'accord. Une date « dans le futur » ne doit pas produire « il y a -3
   * minutes ».
   */
  it('affiche simplement la date pour un horodatage futur', () => {
    expect(formatRelative(new Date(now.getTime() + HOUR), now)).toBe('19/08/2026');
  });
});

describe('daysBetween', () => {
  it('compte les journees entieres ecoulees', () => {
    const start = new Date(2026, 7, 1);
    expect(daysBetween(start, new Date(2026, 7, 1))).toBe(0);
    expect(daysBetween(start, new Date(2026, 7, 11))).toBe(10);
  });

  it('rend un nombre negatif quand la seconde date precede la premiere', () => {
    expect(daysBetween(new Date(2026, 7, 11), new Date(2026, 7, 1))).toBe(-10);
  });
});
