# GestiOne — Analyse, architecture et plan de développement

## 1. État actuel du projet

Le dépôt `gavoekoffi2/GestiOne` était **entièrement vide** au démarrage de ce travail :

```
GestiOne/
└── .git/          (aucun commit, branche claude/gestione-erp-platform-j8dj1w)
```

- Aucun code source, aucun `package.json`, aucun schéma de base de données.
- Aucune stack imposée, aucune dépendance héritée, aucune dette technique.
- Aucune fonctionnalité existante à préserver ou à migrer.

**Conséquence :** il n'y a pas de code à réutiliser. Le choix de stack est libre, et
la contrainte du prompt (« analyser le dépôt existant et réutiliser intelligemment
les technologies déjà présentes ») se résout en : *greenfield, stack moderne au choix*.

## 2. Architecture actuelle

Néant. Voir §1.

## 3. Problèmes identifiés

Il ne s'agit pas de bugs mais de **risques de conception** à traiter dès la fondation,
parce qu'ils sont très coûteux à corriger après coup :

| # | Risque | Traitement retenu |
|---|--------|-------------------|
| P1 | **Fuite inter-entreprises** (multi-tenant). Un `where` oublié suffit à exposer les données d'une autre PME. | Toute donnée métier porte `companyId`. Aucun accès direct au client Prisma depuis les routes : une couche `withTenant()` injecte le scope et les *guards* de permission côté serveur. |
| P2 | **Argent en virgule flottante.** `0.1 + 0.2 !== 0.3` : inacceptable pour de la facturation. | Tous les montants sont stockés en **entiers de plus petite unité** (`BigInt`/`Int` de « centimes »), avec le nombre de décimales piloté par la devise (XOF = 0 décimale, EUR = 2). Aucun `Float` dans le schéma. |
| P3 | **Devise codée en dur.** | `Company.currency` + table `Currency` (code, symbole, décimales, position). Le formatage passe par un seul helper. |
| P4 | **Historique de stock mutable.** | Le stock d'un produit dans un point de vente est un *solde dérivé* alimenté par un journal `StockMovement` append-only. Aucune écriture ne modifie un mouvement passé ; une correction crée un mouvement inverse. |
| P5 | **Numérotation de documents en doublon.** Deux ventes simultanées peuvent obtenir le même numéro de facture. | Table `DocumentSequence` par (company, type, année) avec incrémentation dans la même transaction et contrainte d'unicité `(companyId, type, number)`. |
| P6 | **Reste à payer incohérent.** | Jamais stocké seul : recalculé et réécrit dans la même transaction que chaque paiement, avec invariant testé `total - sum(payments) = balanceDue`. |
| P7 | **Faux mode hors ligne.** | La PWA met en cache l'app-shell et les données de consultation ; toute opération nécessitant le réseau et indisponible est explicitement signalée à l'écran. Pas de file d'attente d'écritures simulée. |
| P8 | **Permissions côté client uniquement.** | Les permissions sont vérifiées dans la couche serveur ; l'UI ne fait que masquer ce qui est déjà refusé côté serveur. |

## 4. Architecture recommandée

### Stack

| Couche | Choix | Justification |
|--------|-------|---------------|
| Langage | **TypeScript** strict | Exigé par le prompt, indispensable sur un domaine métier riche. |
| Frontend + Backend | **Next.js 15 (App Router) + React 19** | Un seul déploiement, rendu serveur rapide sur connexion lente, *Route Handlers* pour l'API REST, support PWA natif. |
| Style | **Tailwind CSS v4** | Rapide, responsive par défaut, aucun runtime CSS. |
| Base de données | **PostgreSQL 16** | Transactions ACID, contraintes fortes, `numeric`/`bigint` fiables. |
| ORM | **Prisma** | Migrations versionnées, typage bout en bout. |
| Validation | **Zod** | Un schéma = validation serveur + types TS. Validation **toujours** côté serveur. |
| Auth | **Sessions opaques maison** (scrypt + cookie httpOnly) | Pas de dépendance lourde, révocation immédiate, aucun secret dans le JWT côté client. |
| Tests | **Vitest** | Rapide, TS natif ; tests d'intégration sur une vraie base Postgres. |

### Couches

```
app/(auth)          écrans publics : connexion, inscription
app/(app)           application authentifiée (layout + navigation)
app/api/**          Route Handlers REST  →  jamais de Prisma en direct
src/server/auth     mots de passe (scrypt), sessions, cookies
src/server/tenant   requireSession → contexte { user, company, role, permissions }
src/server/guard    requirePermission(ctx, 'sales.create')
src/server/services domaine métier (ventes, stock, factures, caisse…)
src/lib/money       arithmétique entière + formatage par devise
src/lib/validation  schémas Zod partagés
prisma/schema.prisma
```

**Règle d'or :** une route HTTP ne parle jamais à Prisma directement. Elle
(1) valide l'entrée avec Zod, (2) obtient un contexte tenant, (3) vérifie une
permission, (4) appelle un service. Le service reçoit le `companyId` et ne peut
pas l'ignorer.

## 5. Schéma de données recommandé

Modèles (tous les modèles métier portent `companyId` + index correspondant) :

- **Socle :** `Company`, `User`, `Membership` (user↔company + rôle), `Role`,
  `Permission`, `Session`, `AuditLog`, `Location` (boutique/dépôt/point de vente),
  `DocumentSequence`, `Currency`.
- **Référentiels :** `Customer`, `Supplier`, `Category`, `Unit`, `Product`
  (bien ou service), `ProductPrice` (détail/gros/spécial), `TaxRate`,
  `PaymentMethod`, `ExpenseCategory`.
- **Stock :** `StockLevel` (solde par produit × point de vente),
  `StockMovement` (journal append-only : IN / OUT / TRANSFER / ADJUSTMENT / INVENTORY).
- **Ventes :** `Quote` + `QuoteLine`, `Sale` + `SaleLine`, `Invoice` + `InvoiceLine`,
  `Payment` (client ou fournisseur), `PaymentAllocation`.
- **Achats :** `PurchaseOrder` + `PurchaseOrderLine`, `Receipt`.
- **Finance :** `Expense`, `CashSession` (ouverture/fermeture), `CashMovement`.
- **Système :** `Notification`, `ImportJob`.

Invariants garantis par la base ou par transaction :
`unique(companyId, sku)`, `unique(companyId, documentType, number)`,
`sum(payments) ≤ total`, `stockLevel = Σ mouvements`.

## 6. Plan de développement par phases

| Phase | Contenu | État |
|-------|---------|------|
| 1 | Fondation : architecture, base, auth, entreprises, utilisateurs, permissions, navigation | en cours |
| 2 | Référentiels : clients, fournisseurs, catégories, unités, produits, services | à venir |
| 3 | Stock : entrées, sorties, transferts, inventaire, alertes | à venir |
| 4 | Ventes : ventes, devis, factures, paiements, ventes à crédit | à venir |
| 5 | Finance : achats, dépenses, caisse, créances, dettes | à venir |
| 6 | Rapports : tableau de bord, statistiques, exports | à venir |
| 7 | Administration : paramètres, utilisateurs, audit, notifications | à venir |
| 8 | Expérience : responsive, PWA, performances, UX, sécurité, tests | à venir |

À chaque phase : développer → tester → corriger → vérifier → continuer.
