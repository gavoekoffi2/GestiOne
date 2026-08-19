/**
 * Lecture de CSV.
 *
 * Analyseur ecrit a la main plutot qu'une dependance : le format est simple,
 * mais les fichiers reels ne le sont pas. Ceux que les PME produisent viennent
 * d'Excel, de LibreOffice ou d'un export bancaire, et cumulent :
 *
 *  * un BOM UTF-8 en tete, caractere invisible qui colle a la premiere
 *    en-tete et fait echouer sa correspondance avec la colonne attendue ;
 *  * un separateur point-virgule, standard des Excel en locale francaise ;
 *  * des champs entre guillemets contenant separateurs et retours a la ligne ;
 *  * des fins de ligne CRLF.
 *
 * Un `split(',')` echoue sur chacun de ces points.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export class CsvError extends Error {}

/**
 * Devine le separateur en comparant les occurrences hors guillemets sur la
 * premiere ligne. Le point-virgule prime en cas d'egalite : c'est ce que
 * produit Excel en francais, et le cas ou l'erreur est la plus probable.
 */
export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', ',', '\t'].map((delimiter) => {
    let count = 0;
    let inQuotes = false;
    for (const char of firstLine) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === delimiter && !inQuotes) count += 1;
    }
    return { delimiter, count };
  });

  const best = counts.reduce((left, right) => (right.count > left.count ? right : left));
  return best.count > 0 ? best.delimiter : ',';
}

export function parseCsv(input: string, delimiter?: string): ParsedCsv {
  // Le BOM ferait porter a la premiere en-tete un caractere invisible, et
  // toute correspondance de colonne echouerait sans explication visible.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Une ligne vide en fin de fichier est la norme, pas une donnee.
  const cleaned = rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
  if (cleaned.length === 0) throw new CsvError('Le fichier est vide.');

  const headers = (cleaned[0] as string[]).map((header) => header.trim());
  return { headers, rows: cleaned.slice(1), delimiter: sep };
}

/**
 * Fait correspondre les en-tetes du fichier aux champs attendus, sans exiger
 * une casse ni des accents exacts : "Prix de vente", "prix de vente" et
 * "PRIX DE VENTE" designent la meme colonne.
 */
export function normaliseHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export interface ColumnDefinition {
  /** Cle interne du champ. */
  key: string;
  label: string;
  /** Libelles acceptes dans le fichier, en plus du libelle principal. */
  aliases?: string[];
  required?: boolean;
}

export function mapColumns(
  headers: readonly string[],
  definitions: readonly ColumnDefinition[],
): { mapping: Record<string, number>; missing: string[] } {
  const normalised = headers.map(normaliseHeader);
  const mapping: Record<string, number> = {};
  const missing: string[] = [];

  for (const definition of definitions) {
    const candidates = [definition.label, definition.key, ...(definition.aliases ?? [])].map(
      normaliseHeader,
    );
    const index = normalised.findIndex((header) => candidates.includes(header));

    if (index >= 0) mapping[definition.key] = index;
    else if (definition.required) missing.push(definition.label);
  }

  return { mapping, missing };
}

export function cell(row: readonly string[], mapping: Record<string, number>, key: string): string {
  const index = mapping[key];
  if (index === undefined) return '';
  return (row[index] ?? '').trim();
}
