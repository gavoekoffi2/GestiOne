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
| 1 | Fondation : architecture, base, auth, entreprises, utilisateurs, permissions, navigation | **livrée** |
| 2 | Référentiels : clients, fournisseurs, catégories, unités, produits, services | **livrée** |
| 3 | Stock : entrées, sorties, transferts, inventaire, alertes | **livrée** |
| 4 | Ventes : ventes, devis, factures, paiements, ventes à crédit | **livrée** |
| 5 | Finance : achats, dépenses, caisse, créances, dettes | **livrée** |
| 6 | Rapports : tableau de bord, statistiques, exports | **livrée** |
| 7 | Administration : paramètres, utilisateurs, audit, notifications, import | **livrée** |
| 8 | Expérience : responsive, PWA, recherche globale, sécurité, tests | **livrée** |
| 9 | Audit : correction de bugs, accents, guidage du premier jour, confidentialité des coûts, impression | **livrée** |

À chaque phase : développer → tester → corriger → vérifier → continuer.

## 7. Décisions prises en cours de route

Trois problèmes découverts par les tests ont modifié la conception ; ils sont
consignés ici parce qu'ils se reproduiraient à l'identique dans les phases
suivantes.

**Un `upsert` Prisma ne sérialise pas.** Le premier compteur de numérotation
lisait la ligne de séquence puis l'insérait ou la mettait à jour. Sous
concurrence, deux transactions constatent l'absence de ligne et tentent toutes
les deux l'insertion : la seconde échoue sur la contrainte d'unicité. Un test
lançant 25 transactions simultanées l'a montré immédiatement. La numérotation
tient désormais dans une seule instruction `INSERT ... ON CONFLICT DO UPDATE`.
Le même piège a resurgi sur les codes clients/fournisseurs (`count()` puis
insertion) : ils passent maintenant par la même séquence.

**Compter les succès dans la limitation de débit bloque les équipes.** La
version initiale décomptait chaque tentative de connexion, réussie ou non, par
adresse IP. Dans une boutique dont toute l'équipe partage un routeur 4G — donc
une seule adresse IP publique — six caissiers prenant leur poste épuisaient le
quota. Seuls les échecs sont désormais comptabilisés, et une authentification
réussie remet le compteur du compte à zéro.

**`Intl.NumberFormat` n'est pas déterministe.** En français, il produit une
espace fine insécable (U+202F) comme séparateur de milliers. Ces montants
finissent sur des factures imprimées, des tickets thermiques et des exports
CSV, où ce caractère se rend mal et varie selon la version d'ICU embarquée. Le
formatage monétaire est écrit à la main, avec des séparateurs explicites.

**Un seul document de créance.** La tentation était de modéliser la vente au
comptoir, la facture et le devis comme trois objets portant chacun leurs
totaux. Deux tables de créances finissent toujours par diverger — un paiement
enregistré d'un côté, un avoir de l'autre — et le « combien mes clients me
doivent-ils » affiché au dirigeant devient faux sans que personne ne s'en
aperçoive. Une vente au comptoir produit donc une facture (`origin = "POS"`),
un devis accepté se convertit en facture, et `Invoice.balanceDue` est le seul
endroit où se lit une créance. Le solde n'est jamais incrémenté : il est
recalculé à partir des paiements réellement en base, dans la transaction de
chaque encaissement.

**Zod retire silencieusement les clés absentes d'un schéma.** Un règlement
fournisseur enregistré via l'API renvoyait `201` sans jamais réduire la dette :
le service lisait `orderId`, mais le schéma de validation ne le déclarait pas,
si bien que Zod le supprimait avant l'appel. Les tests d'intégration ne
pouvaient pas le voir — ils appellent les services directement. Seul un essai
bout en bout sur l'application l'a révélé. Une suite dédiée
(`tests/unit/schema-contract.test.ts`) vérifie désormais que chaque champ lu par
un service survit à la validation.

**Un composant client ne doit jamais importer depuis `src/server`.** Le
sélecteur de période importait ses libellés depuis un service — trois chaînes de
caractères. Cet import a entraîné toute la chaîne de dépendances du service dans
le paquet navigateur : Prisma, le pilote PostgreSQL, et un `require('dns')` qui
a fait échouer la compilation. Le symptôme était spectaculaire ; il aurait pu
être bien pire, car le même import depuis un module contenant une clé d'API
l'aurait expédiée au navigateur sans qu'aucune erreur ne le signale. Les
définitions partagées vivent désormais dans `src/lib`, et
`tests/unit/client-server-boundary.test.ts` parcourt les sources pour refuser
tout franchissement.

**TypeScript ne voit pas tout de la frontière serveur/client.** Passer une
fonction de formatage d'un composant serveur à un composant client compile sans
erreur et échoue à l'exécution : seules des valeurs sérialisables franchissent
la frontière. Le graphique reçoit donc le format de devise comme *donnée* et
formate lui-même. Aucun test unitaire n'aurait attrapé cela — seul l'affichage
réel de la page l'a révélé.

**Une alerte est un état, pas un événement.** « Stock faible » ou « facture en
retard » décrit une situation qui se résout. Stocker ces notifications, c'est
accepter qu'elles mentent : un réapprovisionnement laisserait l'alerte affichée
jusqu'au passage d'une tâche de nettoyage — et si cette tâche ne tourne pas,
indéfiniment. Elles sont donc calculées à chaque affichage et disparaissent
d'elles-mêmes. Il n'y a rien à « marquer comme lu » : on les efface en
agissant. Les vrais événements (une vente, un paiement) ne sont pas des
alertes — ils sont déjà dans le journal d'audit et sur le tableau de bord.

**Le mode hors ligne s'arrête là où l'honnêteté s'arrête.** Le service worker
met en cache la coquille de l'application et sert une page « hors connexion »
explicite. Il ne met **pas** les ventes en file d'attente. Ce n'est pas un
manque de temps : une file d'écritures suppose de trancher des conflits
qu'aucune interface ne peut résoudre seule — deux caissiers vendant hors ligne
le dernier article, un numéro de facture attribué deux fois, un paiement porté
sur une facture annulée entre-temps. Une file qui « marche presque » ferait
croire au commerçant que sa vente est enregistrée alors qu'elle sera rejetée à
la reconnexion, et il aurait déjà remis la marchandise. GestiOne dit donc
franchement qu'il faut du réseau pour vendre.


**Une prop fonction ne franchit pas la frontière serveur → client.** Les pages
« Nouvelle facture » et « Nouveau devis » passaient `redirectTo={(id) => ...}`
au composant de saisie. React ne sait pas sérialiser une fonction : les deux
pages répondaient 500, et comme aucun bouton ne menait à « Nouvelle facture »,
personne ne l'avait constaté. La destination est maintenant déduite du type de
document, et un test parcourt les composants serveur pour refuser toute prop
fonction — la panne était invisible à la relecture, elle ne doit plus l'être.

**React 19 supprime une balise `<style>` rendue dans l'arbre.** La règle `@page`
qui met les devis au format A5 était posée par un `<style>` dans le rendu. Elle
figurait bien dans le HTML servi, puis disparaissait à l'hydratation : React
traite ces balises comme des ressources hoistables. L'impression retombait donc
sur le format par défaut — un export PDF le montre, aucun test ne l'aurait vu.
La règle est désormais posée depuis un effet, et retirée en quittant la page
pour ne pas déborder sur l'impression d'un autre document. Chrome, au passage,
ignore une hauteur `auto` dans `@page` : le ticket 80 mm donne sa hauteur.

**Masquer un montant à l'écran ne le protège pas.** L'écran des rôles prévient
que « masquer un bouton ne suffit pas » ; le prix d'achat, lui, était envoyé au
navigateur puis caché en CSS pour les utilisateurs sans `products.cost.read`.
Un caissier pouvait lire la marge de l'entreprise dans les outils de
développement, dans la réponse de l'API et dans un export CSV. La donnée ne
quitte plus le serveur sans le droit correspondant, et une modification sans ce
droit conserve la valeur enregistrée au lieu de l'écraser.

**Deux filtres dans le même objet Prisma s'écrasent en silence.** La liste des
factures posait `status` une première fois pour le statut choisi, puis une
seconde dans le filtre « impayées ». Le second gagnait : demander « Émise +
impayées » renvoyait toutes les impayées. Aucune erreur, aucun symptôme —
seulement un chiffre faux. Les critères qui portent sur le même champ passent
maintenant par un `AND` explicite.

**Le contexte de requête doit être mémoïsé.** Un affichage traverse le layout,
la page et plusieurs composants serveur ; chacun réclamait la session, puis
l'appartenance, l'entreprise et le rôle. La même page relisait cinq à six fois
les mêmes lignes. `cache` de React memoïse ces lectures pour la durée de la
requête — le tableau de bord est passé de 171 à 117 requêtes, la liste des
factures de 69 à 42.

**Le premier obstacle n'est pas une fonctionnalité manquante.** Un commerçant
qui ouvre GestiOne crée un article, va vendre… et se heurte au refus de vente à
découvert : un article neuf n'a pas de stock. L'application était complète et
inutilisable le premier jour. La fiche article accepte donc une quantité
initiale — enregistrée comme une entrée de stock normale, journalisée comme les
autres — et le tableau de bord affiche le chemin jusqu'à la première vente tant
qu'il n'est pas parcouru. Le service qui calcule ces étapes existait depuis la
phase 1 sans avoir jamais été appelé.

Deux décisions relèvent de la migration plutôt que du bug. La première : les unités de
mesure sont installées à la création d'une entreprise, ce qui laissait sans
unités toutes les entreprises créées avant la phase 2. Une migration de
rattrapage, rejouable, les complète. La seconde : les libellés fournis par
GestiOne — modes de règlement, unités, catégories de dépense, devises —
s'écrivaient sans accents. Les corriger dans les sources ne change rien aux
entreprises déjà créées, dont les reçus affichaient encore « Especes » ; une
migration remet à jour les seules lignes système portant l'ancienne graphie, en
préservant celles qu'une entreprise a renommées.
