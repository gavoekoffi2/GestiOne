/**
 * Photos d'articles.
 *
 * Une boutique n'a ni serveur de fichiers ni compte de stockage a configurer :
 * la photo est donc **compressee dans le navigateur** puis rangee avec la fiche
 * article, sous forme de data URL. Une vignette de 512 px en JPEG pese quelques
 * dizaines de kilo-octets — assez pour reconnaitre un produit derriere un
 * comptoir, assez peu pour rester utilisable sur une connexion mobile et dans
 * le cache hors-ligne de l'application.
 *
 * Une adresse http(s) reste acceptee pour les catalogues dont les images sont
 * deja hebergees ailleurs.
 */

/** Cote maximal de la vignette produite a la prise de vue, en pixels. */
export const IMAGE_MAX_SIDE = 512;

/**
 * Longueur maximale de la valeur stockee (~300 Ko de binaire une fois decode).
 * Au-dela, ce n'est plus une vignette : le catalogue deviendrait lourd a
 * charger et chaque ecran de vente en patirait.
 */
export const IMAGE_MAX_LENGTH = 400_000;

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const HTTP_URL = /^https?:\/\/[^\s<>"']+$/i;

/** Une valeur d'image exploitable : data URL d'image, ou adresse http(s). */
export function isSupportedImageSource(value: string): boolean {
  if (value.length > IMAGE_MAX_LENGTH) return false;
  return DATA_URL.test(value) || HTTP_URL.test(value);
}
