-- Les depenses ont desormais leur propre compteur (documentType = 'EXPENSE').
-- Elles consommaient jusqu'ici celui des paiements, ce qui creait des trous
-- dans la numerotation des paiements.
--
-- Le nouveau compteur demarre, pour chaque entreprise et chaque annee, apres le
-- plus grand numero de depense deja attribue : aucun numero ne peut etre
-- attribue deux fois (contrainte unique companyId + number).
INSERT INTO "document_sequences"
  ("id", "companyId", "documentType", "period", "prefix", "nextValue", "padding", "updatedAt")
SELECT
  gen_random_uuid()::text,
  e."companyId",
  'EXPENSE',
  substring(e."number" FROM '-(\d{4})-\d+$'),
  MAX(substring(e."number" FROM '^(.*)-\d{4}-\d+$')),
  MAX(substring(e."number" FROM '(\d+)$')::int) + 1,
  5,
  NOW()
FROM "expenses" e
WHERE e."number" ~ '-\d{4}-\d+$'
GROUP BY e."companyId", substring(e."number" FROM '-(\d{4})-\d+$')
ON CONFLICT ("companyId", "documentType", "period") DO NOTHING;
