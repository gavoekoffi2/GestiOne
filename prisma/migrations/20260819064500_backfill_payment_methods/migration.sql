-- Rattrapage des modes de reglement pour les entreprises creees avant la phase 4.
--
-- `provisionPaymentMethods` n'installe les modes qu'a la creation d'une
-- entreprise. Sans ce rattrapage, toute entreprise existante au moment de la
-- mise a jour ne pourrait encaisser aucune vente.
--
-- La liste doit rester alignee sur DEFAULT_PAYMENT_METHODS
-- (src/server/services/commerce-setup.ts).
INSERT INTO "payment_methods" (
  "id", "companyId", "code", "name", "kind",
  "isCredit", "affectsCash", "requiresReference", "isSystem", "isActive", "position",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  c."id",
  d."code",
  d."name",
  d."kind",
  d."isCredit",
  d."affectsCash",
  d."requiresReference",
  true,
  true,
  d."position",
  NOW(),
  NOW()
FROM "companies" c
CROSS JOIN (
  VALUES
    ('CASH',          'Especes',                     'CASH',          false, true,  false, 1),
    ('MOBILE_MONEY',  'Mobile Money',                'MOBILE_MONEY',  false, false, true,  2),
    ('BANK_TRANSFER', 'Virement bancaire',           'BANK_TRANSFER', false, false, true,  3),
    ('CARD',          'Carte bancaire',              'CARD',          false, false, false, 4),
    ('CHEQUE',        'Cheque',                      'CHEQUE',        false, false, true,  5),
    ('CREDIT',        'Credit (a payer plus tard)',  'CREDIT',        true,  false, false, 6)
) AS d("code", "name", "kind", "isCredit", "affectsCash", "requiresReference", "position")
-- La contrainte unique est (companyId, code) : on n'insere que ce qui manque,
-- ce qui rend le script rejouable sans erreur.
WHERE NOT EXISTS (
  SELECT 1 FROM "payment_methods" pm
  WHERE pm."companyId" = c."id" AND pm."code" = d."code"
);
