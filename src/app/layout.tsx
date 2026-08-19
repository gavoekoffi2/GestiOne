import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'GestiOne',
    template: '%s · GestiOne',
  },
  description:
    "GestiOne : la gestion complete de votre entreprise — ventes, stock, factures, caisse et rapports — depuis un seul endroit.",
  applicationName: 'GestiOne',
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
