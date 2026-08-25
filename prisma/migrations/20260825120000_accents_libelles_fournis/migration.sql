-- Rattrapage des libelles fournis par GestiOne, ecrits sans accents jusqu'ici.
--
-- Ces valeurs sont des donnees, pas du code : les corriger dans les sources ne
-- change rien aux entreprises deja creees, qui continueraient d'afficher
-- "Especes" sur leurs recus et "Electricite" dans leurs depenses.
--
-- Chaque mise a jour est bornee aux lignes fournies par le systeme et encore
-- porteuses de l'ancien libelle : une entreprise qui a renomme le sien le
-- garde, et rejouer la migration ne fait rien.

-- Modes de reglement (voir DEFAULT_PAYMENT_METHODS).
UPDATE "payment_methods" SET "name" = 'Espèces'
  WHERE "isSystem" = true AND "code" = 'CASH' AND "name" = 'Especes';
UPDATE "payment_methods" SET "name" = 'Chèque'
  WHERE "isSystem" = true AND "code" = 'CHEQUE' AND "name" = 'Cheque';
UPDATE "payment_methods" SET "name" = 'Crédit (à payer plus tard)'
  WHERE "isSystem" = true AND "code" = 'CREDIT' AND "name" = 'Credit (a payer plus tard)';

-- Unites de mesure (voir DEFAULT_UNITS).
UPDATE "units" SET "name" = 'Unité'
  WHERE "isSystem" = true AND "symbol" = 'u' AND "name" = 'Unite';
UPDATE "units" SET "name" = 'Pièce'
  WHERE "isSystem" = true AND "symbol" = 'pce' AND "name" = 'Piece';
UPDATE "units" SET "name" = 'Mètre'
  WHERE "isSystem" = true AND "symbol" = 'm' AND "name" = 'Metre';
UPDATE "units" SET "name" = 'Mètre carré'
  WHERE "isSystem" = true AND "symbol" = 'm2' AND "name" = 'Metre carre';

-- Categories de depense (voir DEFAULT_EXPENSE_CATEGORIES).
UPDATE "expense_categories" SET "name" = 'Électricité'
  WHERE "isSystem" = true AND "name" = 'Electricite';
UPDATE "expense_categories" SET "name" = 'Internet et téléphone'
  WHERE "isSystem" = true AND "name" = 'Internet et telephone';
UPDATE "expense_categories" SET "name" = 'Taxes et impôts'
  WHERE "isSystem" = true AND "name" = 'Taxes et impots';

-- Devises : referentiel global, partage par toutes les entreprises.
UPDATE "currencies" SET "name" = 'Cedi ghanéen'    WHERE "code" = 'GHS' AND "name" = 'Cedi ghaneen';
UPDATE "currencies" SET "name" = 'Naira nigérian'  WHERE "code" = 'NGN' AND "name" = 'Naira nigerian';
UPDATE "currencies" SET "name" = 'Franc guinéen'   WHERE "code" = 'GNF' AND "name" = 'Franc guineen';
UPDATE "currencies" SET "name" = 'Dollar américain' WHERE "code" = 'USD' AND "name" = 'Dollar americain';
