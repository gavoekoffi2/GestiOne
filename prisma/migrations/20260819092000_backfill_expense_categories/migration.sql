-- Rattrapage des categories de depense pour les entreprises creees avant la
-- phase 5. Sans elles, l'ecran des depenses s'ouvrirait sans aucun classement
-- possible.
--
-- La liste doit rester alignee sur DEFAULT_EXPENSE_CATEGORIES
-- (src/server/services/expenses.ts).
INSERT INTO "expense_categories" (
  "id", "companyId", "name", "isSystem", "isActive", "position", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  c."id",
  d."name",
  true,
  true,
  d."position",
  NOW(),
  NOW()
FROM "companies" c
CROSS JOIN (
  VALUES
    ('Transport', 1),
    ('Loyer', 2),
    ('Salaires', 3),
    ('Electricite', 4),
    ('Eau', 5),
    ('Internet et telephone', 6),
    ('Marketing', 7),
    ('Fournitures', 8),
    ('Maintenance', 9),
    ('Taxes et impots', 10),
    ('Autres', 11)
) AS d("name", "position")
-- La contrainte unique est (companyId, name) : rejouable sans erreur.
WHERE NOT EXISTS (
  SELECT 1 FROM "expense_categories" ec
  WHERE ec."companyId" = c."id" AND ec."name" = d."name"
);
