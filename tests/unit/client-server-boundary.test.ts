import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Frontiere client / serveur.
 *
 * Un composant marque `'use client'` qui importe un module de `src/server`
 * entraine **toute sa chaine de dependances** dans le paquet navigateur. Un
 * simple import de libelles depuis un service a suffi a y faire entrer Prisma et
 * le pilote PostgreSQL, faisant echouer la compilation sur un `require('dns')`.
 *
 * Le symptome etait spectaculaire ; il aurait pu etre bien pire. Le meme import
 * depuis un module contenant une cle d'API ou une requete SQL l'aurait expedie
 * au navigateur sans qu'aucune erreur ne le signale.
 *
 * Ce test parcourt les sources et refuse tout franchissement de la frontiere.
 */

const ROOTS = ['src/components', 'src/app'];

function collectTsxFiles(directory: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      entries.push(...collectTsxFiles(path));
    } else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
      entries.push(path);
    }
  }
  return entries;
}

function isClientModule(source: string): boolean {
  const head = source.slice(0, 200);
  return head.includes("'use client'") || head.includes('"use client"');
}

/** Imports statiques d'un fichier, quelle que soit la forme de la clause. */
function importedModules(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1] as string);
  }
  return specifiers;
}

describe('frontiere client / serveur', () => {
  const files = ROOTS.flatMap((root) => collectTsxFiles(root));

  it('trouve bien les sources a analyser', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("aucun composant client n'importe depuis @/server", () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!isClientModule(source)) continue;

      for (const specifier of importedModules(source)) {
        if (specifier.startsWith('@/server')) {
          violations.push(`${file} importe ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("aucun composant client n'importe le client Prisma", () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!isClientModule(source)) continue;

      for (const specifier of importedModules(source)) {
        if (specifier.includes('generated/prisma') || specifier === '@prisma/client') {
          violations.push(`${file} importe ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Une prop fonction ne franchit pas la frontiere serveur -> client : React
   * ne sait pas la serialiser et la page entiere tombe en erreur 500. Le cas
   * s'est produit sur /factures/nouvelle et /devis/nouveau, ou un
   * `redirectTo={(id) => ...}` rendait la creation de document impossible.
   */
  it("aucun composant serveur ne passe une prop fonction a un composant client", () => {
    const violations: string[] = [];
    // prop={(x) => ...}, prop={function ...} ou prop={async () => ...}
    const inlineFunctionProp =
      /\s([a-zA-Z][\w]*)=\{\s*(?:async\s*)?(?:function\b|\(([^)]*)\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (isClientModule(source)) continue;
      if (!file.endsWith('.tsx')) continue;

      let match: RegExpExecArray | null;
      while ((match = inlineFunctionProp.exec(source)) !== null) {
        violations.push(`${file} passe la prop ${match[1]} sous forme de fonction`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('les modules partages ne dependent pas du serveur', () => {
    // `src/lib` est importable des deux cotes : il doit rester neutre.
    const violations: string[] = [];

    for (const file of collectTsxFiles('src/lib')) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importedModules(source)) {
        if (specifier.startsWith('@/server/services') || specifier.includes('generated/prisma')) {
          violations.push(`${file} importe ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
