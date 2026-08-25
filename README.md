# GestiOne

Plateforme de gestion d'entreprise pour les PME : clients, fournisseurs, produits,
stock, ventes, devis, factures, paiements, achats, dépenses, caisse et rapports —
depuis un seul endroit.

GestiOne est un produit **universel**. Son architecture prend nativement en compte
des réalités opérationnelles fréquentes dans de nombreux marchés, notamment
africains : paiement en espèces et Mobile Money, vente à crédit, plusieurs
boutiques, connexion Internet instable, usage intensif du smartphone, devises sans
décimale (XOF, XAF, GNF), unités de mesure multiples.

## État du projet

| Phase | Contenu | État |
|-------|---------|------|
| 1 | Fondation : architecture, base de données, authentification, entreprises, utilisateurs, permissions, navigation | **livrée** |
| 2 | Référentiels : clients, fournisseurs, catégories, unités, produits, services | **livrée** |
| 3 | Stock : entrées, sorties, transferts, inventaire, alertes | **livrée** |
| 4 | Ventes : ventes, devis, factures, paiements, ventes à crédit | **livrée** |
| 5 | Finance : achats, dépenses, caisse, créances, dettes | **livrée** |
| 6 | Rapports : tableau de bord, statistiques, exports | **livrée** |
| 7 | Administration : paramètres, utilisateurs, audit, notifications, import | **livrée** |
| 8 | Expérience : responsive, PWA, recherche globale, sécurité, tests | **livrée** |

Le menu de l'application n'affiche que les écrans réellement livrés : aucun lien
ne mène vers une fonctionnalité inexistante.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** strict
- **PostgreSQL 16** + **Prisma 7** (adaptateur `pg`), migrations versionnées
- **Tailwind CSS v4**
- **Zod** pour la validation, appliquée côté serveur
- **Vitest** pour les tests, dont des tests d'intégration sur une vraie base

## Demarrage

```bash
# 1. Dépendances
npm install

# 2. Configuration
cp .env.example .env        # renseignez DATABASE_URL et TEST_DATABASE_URL

# 3. Base de données
npx prisma migrate deploy   # applique les migrations
npm run db:seed             # installe le referentiel des devises

# 4. Developpement
npm run dev                 # http://localhost:3000
```

Creez votre entreprise depuis `/inscription` : le premier compte devient
automatiquement administrateur et propriétaire.

## Scripts

| Commande | Effet |
|----------|-------|
| `npm run dev` | Serveur de développement |
| `npm run build` | Generation du client Prisma puis build de production |
| `npm run start` | Serveur de production |
| `npm run typecheck` | Verification TypeScript |
| `npm test` | Suite de tests complète |
| `npm run db:migrate` | Créé et applique une migration |
| `npm run db:seed` | Installe le referentiel des devises |

Les tests d'intégration s'exécutent sur la base désignée par `TEST_DATABASE_URL`,
**qui est vidée à chaque exécution**. Ne la faites jamais pointer vers une base
contenant des données réelles.

## Principes de conception

Ces règles sont appliquées dans le code, pas seulement documentées.

**Isolation multi-entreprises.** Toute donnée métier porte `companyId`.
L'entreprise active est résolue en un seul endroit (`src/server/tenant.ts`) et
transmise aux services ; aucune route ne construit son propre filtre
d'entreprise. Fournir l'identifiant d'une ressource appartenant à une autre
entreprise rend `404`, jamais la ressource.

**Aucun flottant pour l'argent.** `0.1 + 0.2 !== 0.3` : les montants sont des
entiers `bigint` exprimés dans la plus petite unité de la devise, dont le nombre
de décimales vient de la devise elle-même (XOF : 0, EUR : 2). Les quantités
suivent la même logique, en millièmes, pour permettre 0,750 kg sans arrondi.

**Formatage déterministe.** Le formatage monétaire n'utilise pas
`Intl.NumberFormat`, qui produit des espaces insécables fines dont le rendu varie
selon la version d'ICU et casse sur une imprimante thermique ou dans un PDF.

**Numérotation sans doublon.** Un numéro de facture est attribué par une unique
instruction `INSERT ... ON CONFLICT DO UPDATE` exécutée dans la transaction du
document. Deux caissiers qui encaissent au même instant obtiennent deux numéros
distincts — c'est vérifié par un test de concurrence.

**Journaux non réécrits.** Le journal d'audit est en ajout seul. Aucune fonction
ne permet de modifier ou supprimer un événement, y compris à un administrateur.

**Le frontend n'est pas une couche de sécurité.** Les permissions sont vérifiées
par le serveur à chaque opération. L'interface se contente de masquer ce qui est
de toute façon refusé.

**Rien de fictif.** Aucun bouton inerte, aucune donnée de démonstration présentée
comme réelle, aucun indicateur affiché avant que la donnée correspondante ne soit
réellement mesurée. Le mode hors ligne ne met pas les ventes en file d'attente,
et l'interface explique pourquoi. Les canaux de notification non branchés sont
annoncés comme tels.

**Les alertes sont calculées, jamais stockées.** « Stock faible » décrit un état,
pas un événement : une alerte stockée ment dès que le problème est résolu.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — analyse, architecture cible,
  schéma de données et plan de développement par phases.
