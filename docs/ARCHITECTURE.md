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
| 9 | Fiches et compte : compte personnel, appareils connectés, fiches client, fournisseur et article | **livrée** |

À chaque phase : développer → tester → corriger → vérifier → continuer.

La phase 9 ne figurait pas au plan initial. Elle est née d'une relecture de
l'application du point de vue de celui qui s'en sert tous les jours, et non de
celui qui l'a écrite. Trois manques y sont apparus, dont deux où le code serveur
existait déjà sans qu'aucun écran ne permette de l'atteindre — la fonction était
écrite, testée, et inaccessible.

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

Une quatrième décision relève de la migration plutôt que du bug : les unités de
mesure sont installées à la création d'une entreprise, ce qui laissait sans
unités toutes les entreprises créées avant la phase 2. Une migration de
rattrapage, rejouable, les complète.

## 8. Décisions de la phase 9

**Une fonction sans écran n'est pas livrée.** `changePassword` était écrit et
couvert par des tests depuis la phase 1 ; `productStockByLocation` depuis la
phase 3. Aucune route ni aucun écran ne les appelait. La suite de tests était
verte, le service correct, et l'utilisateur ne pouvait ni changer son mot de
passe, ni voir où se trouvait son stock. Un test d'intégration qui appelle un
service directement ne prouve rien sur l'accessibilité de ce service : il faut
suivre le chemin complet, du menu jusqu'à la base.

**Réinitialiser un mot de passe est une opération multi-entreprises.** Un compte
peut appartenir à plusieurs entreprises de la plateforme — le comptable qui
travaille pour trois commerces. Si l'administrateur de l'un d'eux pouvait
réinitialiser son mot de passe, il obtiendrait du même coup l'accès aux deux
autres. L'isolation ne tomberait pas par un `where` oublié, mais par le
détournement d'une identité — une brèche qu'aucun test de filtrage n'aurait
détectée, puisque chaque requête reste correctement filtrée. La réinitialisation
est donc refusée dès que le compte a plus d'une appartenance, et la personne
doit changer son mot de passe elle-même.

**Changer son mot de passe doit révoquer les autres sessions.** Une session
ouverte ne représente pas le mot de passe : elle lui survit. Le geste qu'on fait
après avoir perdu son téléphone n'aurait donc eu aucun effet sur le téléphone
perdu. La révocation fait partie de l'opération, elle n'en est pas une option ;
seule la session courante est préservée, sinon l'utilisateur se déconnecterait
lui-même à chaque changement et la bonne pratique deviendrait pénible.

**Un total agrégé sur la page affichée est un total faux.** Le relevé de compte
liste les cinquante derniers documents. La première version en tirait aussi les
totaux : un client fidèle dépasse vite cinquante factures, et son solde se
serait mis à mentir sans que rien ne le signale. Les montants sont désormais
agrégés en base sur tout l'historique, la liste reste plafonnée, et la fiche dit
explicitement combien de documents ne sont pas affichés.

**Un bouton qui présélectionne doit vraiment présélectionner.** Le lien
« Nouvelle facture » de la fiche client passe l'identifiant en paramètre d'URL.
Le laisser sans effet aurait été un bouton décoratif de plus. L'identifiant reçu
est confronté à la liste des clients déjà chargée pour l'entreprise courante : une
valeur fabriquée dans l'URL ne présélectionne rien, et ne révèle donc pas
l'existence d'un client d'une autre entreprise.

**La marge se lit sur les coûts figés, pas sur le catalogue.** La fiche article
calcule sa marge à partir de `InvoiceLine.unitCost`, figé à l'émission. Utiliser
le prix d'achat courant aurait fait varier rétroactivement la rentabilité des
ventes passées à chaque renégociation avec le fournisseur — le rapport du mois
dernier se serait réécrit tout seul.

**Trois copies d'une règle finissent par diverger.** Les contraintes de mot de
passe étaient recopiées dans l'inscription, la création d'un collaborateur et
— une fois de plus — dans le changement de mot de passe. La divergence se serait
manifestée au pire moment : un mot de passe accepté à la création du compte,
refusé le jour où son titulaire veut le changer. La règle vit maintenant dans
`src/lib/validation/password.ts`, et nulle part ailleurs.
