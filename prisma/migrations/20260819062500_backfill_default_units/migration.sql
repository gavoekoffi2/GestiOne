-- Rattrapage des unites de mesure pour les entreprises creees avant la phase 2.
--
-- `provisionDefaultUnits` n'installe les unites qu'a la creation d'une
-- entreprise. Sans ce rattrapage, toute entreprise existante au moment de la
-- mise a jour se retrouverait avec un catalogue sans aucune unite : impossible
-- d'y saisir correctement un article.
--
-- La liste doit rester alignee sur DEFAULT_UNITS (src/server/services/catalog.ts).
INSERT INTO "units" ("id", "companyId", "name", "symbol", "isSystem", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  defaults."name",
  defaults."symbol",
  true,
  NOW(),
  NOW()
FROM "companies" c
CROSS JOIN (
  VALUES
    ('Unite', 'u'),
    ('Piece', 'pce'),
    ('Carton', 'crt'),
    ('Sac', 'sac'),
    ('Paquet', 'paq'),
    ('Kilogramme', 'kg'),
    ('Gramme', 'g'),
    ('Tonne', 't'),
    ('Litre', 'L'),
    ('Metre', 'm'),
    ('Metre carre', 'm2'),
    ('Heure', 'h'),
    ('Jour', 'j')
) AS defaults("name", "symbol")
-- La contrainte unique est (companyId, symbol) : on n'insere que ce qui manque,
-- ce qui rend le script rejouable sans erreur.
WHERE NOT EXISTS (
  SELECT 1 FROM "units" u
  WHERE u."companyId" = c."id" AND u."symbol" = defaults."symbol"
);
