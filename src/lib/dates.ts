/**
 * Mise en forme des dates.
 *
 * Ecrite a la main, pour la meme raison que le formatage monetaire :
 * `Intl.RelativeTimeFormat` et `Intl.DateTimeFormat` produisent des resultats
 * qui varient selon la version d'ICU embarquee dans l'environnement. Un
 * rendu serveur et un rendu navigateur qui different sur la meme donnee
 * provoquent une erreur d'hydratation React — et le texte affiche a
 * l'utilisateur cesse d'etre previsible.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Date au format jour/mois/annee, sans dependance a la locale du systeme. */
export function formatDate(value: Date): string {
  const day = String(value.getDate()).padStart(2, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${value.getFullYear()}`;
}

/** Date et heure, pour un journal ou une session. */
export function formatDateTime(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${formatDate(value)} a ${hours}h${minutes}`;
}

/**
 * Anciennete lisible : « a l'instant », « il y a 3 heures », puis la date.
 *
 * Au-dela d'une semaine, un ecart relatif n'aide plus personne : « il y a 43
 * jours » demande un calcul mental, alors que la date se lit directement.
 */
export function formatRelative(value: Date, now: Date = new Date()): string {
  const elapsed = now.getTime() - value.getTime();

  if (elapsed < 0) return formatDate(value);
  if (elapsed < 2 * MINUTE) return "a l'instant";
  if (elapsed < HOUR) return `il y a ${Math.floor(elapsed / MINUTE)} minutes`;
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? 'il y a 1 heure' : `il y a ${hours} heures`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? 'hier' : `il y a ${days} jours`;
  }
  return `le ${formatDate(value)}`;
}

/** Nombre de jours entiers separant deux dates, la plus recente en second. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}
