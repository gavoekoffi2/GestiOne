# GestiOne

Plateforme de gestion d'entreprise pour les PME : clients, fournisseurs, produits,
stock, ventes, devis, factures, paiements, achats, depenses, caisse et rapports —
depuis un seul endroit.

GestiOne est un produit **universel**. Son architecture prend nativement en compte
des realites operationnelles frequentes dans de nombreux marches, notamment
africains : paiement en especes et Mobile Money, vente a credit, plusieurs
boutiques, connexion Internet instable, usage intensif du smartphone, devises sans
decimale (XOF, XAF, GNF), unites de mesure multiples.

## Etat du projet

| Phase | Contenu | Etat |
|-------|---------|------|
| 1 | Fondation : architecture, base de donnees, authentification, entreprises, utilisateurs, permissions, navigation | **livree** |
| 2 | Referentiels : clients, fournisseurs, categories, unites, produits, services | **livree** |
| 3 | Stock : entrees, sorties, transferts, inventaire, alertes | **livree** |
| 4 | Ventes : ventes, devis, factures, paiements, ventes a credit | **livree** |
| 5 | Finance : achats, depenses, caisse, creances, dettes | **livree** |
| 6 | Rapports : tableau de bord, statistiques, exports | **livree** |
| 7 | Administration : parametres, utilisateurs, audit, notifications, import | **livree** |
| 8 | Experience : responsive, PWA, recherche globale, securite, tests | **livree** |
| 9 | Fiches et compte : compte personnel, appareils connectes, fiches client, fournisseur et article | **livree** |

Le menu de l'application n'affiche que les ecrans reellement livres : aucun lien
ne mene vers une fonctionnalite inexistante.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** strict
- **PostgreSQL 16** + **Prisma 7** (adaptateur `pg`), migrations versionnees
- **Tailwind CSS v4**
- **Zod** pour la validation, appliquee cote serveur
- **Vitest** pour les tests, dont des tests d'integration sur une vraie base

## Demarrage

```bash
# 1. Dependances
npm install

# 2. Configuration
cp .env.example .env        # renseignez DATABASE_URL et TEST_DATABASE_URL

# 3. Base de donnees
npx prisma migrate deploy   # applique les migrations
npm run db:seed             # installe le referentiel des devises

# 4. Developpement
npm run dev                 # http://localhost:3000
```

Creez votre entreprise depuis `/inscription` : le premier compte devient
automatiquement administrateur et proprietaire.

## Scripts

| Commande | Effet |
|----------|-------|
| `npm run dev` | Serveur de developpement |
| `npm run build` | Generation du client Prisma puis build de production |
| `npm run start` | Serveur de production |
| `npm run typecheck` | Verification TypeScript |
| `npm run lint` | Verification du style et des regles React |
| `npm test` | Suite de tests complete |
| `npm run db:migrate` | Cree et applique une migration |
| `npm run db:seed` | Installe le referentiel des devises |

Les tests d'integration s'executent sur la base designee par `TEST_DATABASE_URL`,
**qui est videe a chaque execution**. Ne la faites jamais pointer vers une base
contenant des donnees reelles.

## Integration continue

`.github/workflows/ci.yml` rejoue sur chaque poussee la totalite des
verifications : types, style, tests d'integration sur un vrai PostgreSQL, et
build de production. Une etape supplementaire compare le schema Prisma aux
migrations versionnees : une modification de `schema.prisma` sans migration
correspondante passerait les tests mais casserait le deploiement.

Avant de proposer une modification, la meme sequence tourne en local :

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Mise en production

L'application est un serveur Next.js standard ; elle n'a besoin que de
PostgreSQL et des variables de `.env.example`.

```bash
npm ci
npx prisma migrate deploy   # jamais `migrate dev` en production
npm run db:seed             # referentiel des devises, idempotent
npm run build
npm run start               # ecoute sur $PORT, 3000 par defaut
```

Servez l'application **derriere HTTPS** : le cookie de session porte l'attribut
`Secure` des que `NODE_ENV=production`, et ne serait donc pas emis en clair.
L'en-tete HSTS n'est envoye que dans ce meme cas.

## Principes de conception

Ces regles sont appliquees dans le code, pas seulement documentees.

**Isolation multi-entreprises.** Toute donnee metier porte `companyId`.
L'entreprise active est resolue en un seul endroit (`src/server/tenant.ts`) et
transmise aux services ; aucune route ne construit son propre filtre
d'entreprise. Fournir l'identifiant d'une ressource appartenant a une autre
entreprise rend `404`, jamais la ressource.

**Aucun flottant pour l'argent.** `0.1 + 0.2 !== 0.3` : les montants sont des
entiers `bigint` exprimes dans la plus petite unite de la devise, dont le nombre
de decimales vient de la devise elle-meme (XOF : 0, EUR : 2). Les quantites
suivent la meme logique, en milliemes, pour permettre 0,750 kg sans arrondi.

**Formatage deterministe.** Le formatage monetaire n'utilise pas
`Intl.NumberFormat`, qui produit des espaces insecables fines dont le rendu varie
selon la version d'ICU et casse sur une imprimante thermique ou dans un PDF.

**Numerotation sans doublon.** Un numero de facture est attribue par une unique
instruction `INSERT ... ON CONFLICT DO UPDATE` executee dans la transaction du
document. Deux caissiers qui encaissent au meme instant obtiennent deux numeros
distincts — c'est verifie par un test de concurrence.

**Journaux non reecrits.** Le journal d'audit est en ajout seul. Aucune fonction
ne permet de modifier ou supprimer un evenement, y compris a un administrateur.

**Le frontend n'est pas une couche de securite.** Les permissions sont verifiees
par le serveur a chaque operation. L'interface se contente de masquer ce qui est
de toute facon refuse.

**Defense en profondeur cote navigateur.** Chaque reponse porte une politique de
securite du contenu dont le nonce change a chaque requete (`src/proxy.ts`) :
un script injecte dans une donnee ne s'executerait pas, faute de porter le nonce
du moment. Aucune origine tierce n'est autorisee, ni pour un script, ni pour une
requete sortante.

**La saisie ne precede pas la vente.** Le client se tape directement dans la
vente, la facture ou le devis : si le nom correspond a une fiche, elle est
reutilisee ; sinon elle est creee avec ce seul nom. Obliger a creer la fiche
avant de vendre, c'est garantir que tout finira au « client de passage » et que
les creances deviendront introuvables. Meme chose pour le fournisseur sur un
achat.

**Un formulaire ne montre que ce qu'il exige.** Les champs facultatifs — adresse,
identifiant fiscal, tarifs degressifs — sont replies derriere « Plus de
details ». Une fiche article se cree avec un nom et un prix ; le reste attend
d'etre utile.

**Le document imprime est le meme partout.** Facture, devis et recu partagent un
seul balisage ; A4, demi-feuille A5 et ticket 80 mm ne sont que des feuilles de
style. Le format se choisit devant le document, pas dans l'administration, parce
qu'une meme boutique imprime une facture A4 pour un client et un ticket pour le
suivant. Le logo voyage avec la fiche de l'entreprise, encode dans la base : il
ne depend d'aucun disque ni d'aucun serveur tiers, et survit donc a un
redeploiement.

**Rien de fictif.** Aucun bouton inerte, aucune donnee de demonstration presentee
comme reelle, aucun indicateur affiche avant que la donnee correspondante ne soit
reellement mesuree. Le mode hors ligne ne met pas les ventes en file d'attente,
et l'interface explique pourquoi. Les canaux de notification non branches sont
annonces comme tels.

**Chacun est maitre de son mot de passe.** Un compte cree par l'employeur
recoit un mot de passe provisoire, que son titulaire remplace lui-meme depuis
« Mon compte » — sans quoi deux personnes le connaissent indefiniment. Le
changement ferme les autres sessions ouvertes : sans cela, un telephone perdu
garderait l'acces et l'operation ne protegerait rien. Un administrateur peut
reinitialiser le mot de passe d'un collaborateur qui l'a oublie, mais **jamais**
celui d'un compte partage avec une autre entreprise de la plateforme : ce serait
l'isolation multi-entreprises contournee par le detournement d'une identite.

**Les alertes sont calculees, jamais stockees.** « Stock faible » decrit un etat,
pas un evenement : une alerte stockee ment des que le probleme est resolu.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — analyse, architecture cible,
  schema de donnees et plan de developpement par phases.
