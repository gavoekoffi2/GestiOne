import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'GestiOne',
    template: '%s · GestiOne',
  },
  description:
    "GestiOne rassemble ventes, stock, factures, achats, dépenses, caisse et rapports pour aider les commerçants et PME à piloter leur activité avec clarté.",
  applicationName: 'GestiOne',
  keywords: ['gestion commerciale', 'stock', 'facturation', 'caisse', 'PME', 'commerce', 'GestiOne'],
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'GestiOne',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/gestione-logo.svg',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f766e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
