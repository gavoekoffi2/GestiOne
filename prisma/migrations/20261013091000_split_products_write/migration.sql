-- "Creer et modifier les articles" (products.write) devient deux droits
-- distincts : products.create et products.update. Chaque role qui avait
-- l'ancien droit recoit les deux nouveaux : personne ne perd d'acces, et
-- l'administrateur retire ensuite "Modifier" a qui il veut.
UPDATE "roles"
SET "permissions" = (
  SELECT ARRAY(
    SELECT DISTINCT p FROM unnest(
      array_remove("permissions", 'products.write') || ARRAY['products.create', 'products.update']
    ) AS p
    ORDER BY p
  )
)
WHERE 'products.write' = ANY("permissions");
