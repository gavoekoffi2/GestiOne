import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenantContext } from '@/server/tenant';
import { ButtonLink } from '@/components/ui/primitives';

const FEATURES = [
  {
    number: '01',
    title: 'Vendez sans perdre le fil',
    body: 'Devis, ventes, factures, paiements et crédits clients restent reliés. Vous savez ce qui est vendu, encaissé et encore dû.',
    visual: 'sales',
  },
  {
    number: '02',
    title: 'Un stock qui suit la réalité',
    body: 'Produits, catégories, unités, entrées, sorties et transferts entre points de vente dans un historique fiable.',
    visual: 'stock',
  },
  {
    number: '03',
    title: 'Votre argent, lisible',
    body: 'Caisse, dépenses, achats, dettes fournisseurs et rapports se répondent pour vous aider à décider avec les bons chiffres.',
    visual: 'cash',
  },
];

const MODULES = [
  ['Ventes & devis', 'Transformez une demande en vente suivie, sans ressaisie.'],
  ['Factures & paiements', 'Émettez, suivez les échéances et enregistrez chaque règlement.'],
  ['Achats & fournisseurs', 'Gardez la main sur les approvisionnements et les dettes.'],
  ['Dépenses & caisse', 'Chaque sortie d’argent trouve sa place et son justificatif.'],
  ['Rapports de pilotage', 'Lisez activité, marge estimée, créances et soldes au même endroit.'],
  ['Multi-boutiques', 'Organisez vos points de vente, équipes et mouvements de stock.'],
];

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center" aria-label="GestiOne, accueil">
      <Image src="/gestione-logo.svg" alt="GestiOne" width={compact ? 154 : 180} height={45} priority />
    </Link>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function DashboardVisual() {
  return (
    <div className="hero-dashboard" aria-label="Aperçu du tableau de bord GestiOne">
      <div className="dashboard-topbar"><span className="dashboard-dot" /><span>Aperçu de la plateforme</span><span className="dashboard-date">Données de votre activité</span></div>
      <div className="dashboard-body">
        <aside className="dashboard-side"><span className="side-brand">G</span><span className="side-line active" /><span className="side-line" /><span className="side-line" /><span className="side-line short" /><span className="side-line" /></aside>
        <div className="dashboard-main">
          <div className="dashboard-heading"><div><span className="eyebrow">PILOTAGE</span><strong>Bonjour, votre activité</strong></div><span className="dashboard-avatar">K</span></div>
          <div className="metric-grid"><div><small>Chiffre d&apos;affaires</small><strong>Suivi en direct</strong><span className="metric-up">↗ ventes et paiements reliés</span></div><div><small>Solde de caisse</small><strong>Vue consolidée</strong><span className="metric-neutral">selon vos opérations</span></div></div>
          <div className="chart-card"><div className="chart-label"><span>Tendance des ventes</span><b>visualisation</b></div><svg viewBox="0 0 520 150" role="img" aria-label="Visualisation de la tendance des ventes"><path d="M0 120 C50 112 70 92 112 100 S175 55 220 76 S280 100 320 58 S380 75 420 30 S475 60 520 18" fill="none" stroke="#14b8a6" strokeWidth="5" strokeLinecap="round"/><path d="M0 120 C50 112 70 92 112 100 S175 55 220 76 S280 100 320 58 S380 75 420 30 S475 60 520 18 V150 H0Z" fill="url(#chartFill)" opacity=".18"/><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#14b8a6"/><stop offset="1" stopColor="#14b8a6" stopOpacity="0"/></linearGradient></defs></svg></div>
          <div className="dashboard-bottom"><div><span>Dernières ventes</span><b>historique relié</b></div><div><span>Alertes stock</span><b className="alert-count">à traiter</b></div></div>
        </div>
      </div>
    </div>
  );
}

function FeatureVisual({ type }: { type: string }) {
  if (type === 'sales') return <div className="feature-visual visual-sales"><div className="receipt"><span>FACTURE</span><b>F-2026-0148</b><i /><i /><i /><strong>1 250 000 F CFA</strong><small>PAYÉ · MOBILE MONEY</small></div><div className="floating-check">✓</div></div>;
  if (type === 'stock') return <div className="feature-visual visual-stock"><div className="warehouse"><span>STOCK CENTRAL</span><b>Produits disponibles</b><div className="bars"><i /><i /><i /><i /><i /></div></div><div className="stock-badge">↗ + 18<br /><small>entrée validée</small></div></div>;
  return <div className="feature-visual visual-cash"><div className="cash-card"><span>SOLDE DE CAISSE</span><b>1 280 500</b><small>F CFA</small><div><i /><i /><i /><i /></div></div><div className="cash-orbit">+ dépense enregistrée</div></div>;
}

export default async function HomePage() {
  const context = await getTenantContext();
  if (context) redirect('/tableau-de-bord');

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-container nav-inner"><Logo /><nav className="desktop-nav" aria-label="Navigation principale"><a href="#fonctionnalites">Fonctionnalités</a><a href="#methode">Comment ça marche</a><a href="#pilotage">Pilotage</a></nav><div className="nav-actions"><Link href="/connexion" className="nav-login">Se connecter</Link><ButtonLink href="/inscription" className="nav-cta">Créer mon espace <Arrow /></ButtonLink></div></div>
      </header>

      <main>
        <section className="landing-hero"><div className="landing-container hero-grid"><div className="hero-copy"><div className="hero-kicker"><span className="kicker-pulse" /> L&apos;OS de votre activité</div><h1>Votre entreprise mérite mieux que des fichiers éparpillés.</h1><p className="hero-lede">GestiOne rassemble ventes, stock, factures, caisse et rapports dans un espace conçu pour travailler vite — et décider avec confiance.</p><div className="hero-actions"><ButtonLink href="/inscription" className="hero-primary">Créer mon entreprise <Arrow /></ButtonLink><a href="#fonctionnalites" className="hero-secondary">Découvrir la plateforme <span>↓</span></a></div><p className="hero-note"><span>✓</span> Votre activité, vos règles, votre vision.</p></div><div className="hero-art"><div className="hero-glow" /><DashboardVisual /><div className="hero-float float-sales"><span>Ventes</span><b>+ 12,8 %</b><small>aujourd&apos;hui</small></div><div className="hero-float float-stock"><span className="mini-dot" /> Stock maîtrisé</div></div></div><div className="landing-container hero-strip"><span>Une seule source de vérité pour</span><b>les commerçants</b><b>les distributeurs</b><b>les équipes terrain</b><b>les PME en croissance</b></div></section>

        <section id="fonctionnalites" className="landing-section features-section"><div className="landing-container"><div className="section-intro"><div><span className="section-label">Ce que GestiOne change</span><h2>Moins de dispersion.<br /><span>Plus de maîtrise.</span></h2></div><p>Un logiciel ne doit pas seulement stocker vos données. Il doit vous aider à voir ce qui se passe, à agir au bon moment et à faire grandir votre activité.</p></div><div className="feature-list">{FEATURES.map((feature) => <article className="feature-row" key={feature.number}><div className="feature-number">{feature.number}</div><div className="feature-copy"><h3>{feature.title}</h3><p>{feature.body}</p><Link href="/inscription">Commencer avec ce module <Arrow /></Link></div><FeatureVisual type={feature.visual} /></article>)}</div></div></section>

        <section id="pilotage" className="landing-section modules-section"><div className="landing-container modules-grid"><div className="modules-statement"><span className="section-label">Une plateforme qui travaille avec vous</span><h2>Du premier produit au dernier rapport.</h2><p>Chaque module est relié aux autres. Une vente met à jour votre stock. Un paiement alimente votre caisse. Une dépense clarifie votre résultat.</p><ButtonLink href="/inscription" className="dark-button">Voir GestiOne en action <Arrow /></ButtonLink></div><div className="module-list">{MODULES.map(([title, body]) => <div className="module-item" key={title}><span className="module-icon">↗</span><div><h3>{title}</h3><p>{body}</p></div></div>)}</div></div></section>

        <section id="methode" className="landing-section method-section"><div className="landing-container"><div className="method-head"><span className="section-label">Commencer simplement</span><h2>Une prise en main qui ressemble à votre quotidien.</h2></div><div className="method-grid"><div className="method-step"><span>01</span><h3>Créez votre espace</h3><p>Renseignez votre entreprise, votre devise et vos premiers points de vente.</p></div><div className="method-connector" /><div className="method-step"><span>02</span><h3>Organisez vos données</h3><p>Importez produits, clients et fournisseurs. Vos équipes trouvent rapidement leurs repères.</p></div><div className="method-connector" /><div className="method-step"><span>03</span><h3>Pilotez avec clarté</h3><p>Travaillez, encaissez, contrôlez et consultez vos rapports depuis le même endroit.</p></div></div></div></section>

        <section className="landing-cta"><div className="landing-container cta-inner"><div><span className="section-label light-label">Votre prochaine décision commence ici</span><h2>Donnez à votre activité l&apos;espace qu&apos;elle mérite.</h2><p>Commencez par créer votre entreprise. Le reste se construit autour de votre façon de travailler.</p></div><ButtonLink href="/inscription" className="cta-button">Créer mon espace GestiOne <Arrow /></ButtonLink></div></section>
      </main>

      <footer className="landing-footer"><div className="landing-container footer-inner"><Logo compact /><div><span>GestiOne · La gestion qui avance avec vous.</span><Link href="/connexion">Accéder à mon espace <Arrow /></Link></div><small>© {new Date().getFullYear()} GestiOne</small></div></footer>
    </div>
  );
}
