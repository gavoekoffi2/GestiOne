'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/layout/icons';
import { Connectivity } from '@/components/layout/connectivity';
import { GlobalSearch } from '@/components/layout/global-search';
import { cx } from '@/components/ui/primitives';
import type { NavSection } from '@/lib/navigation';

export interface ShellUser {
  fullName: string;
  email: string;
  roleName: string;
}

export interface ShellCompany {
  id: string;
  name: string;
  currencyCode: string;
}

export interface ShellMembership {
  id: string;
  companyId: string;
  companyName: string;
  roleName: string;
}

export function AppShell({
  navigation,
  user,
  company,
  memberships,
  children,
}: {
  navigation: NavSection[];
  user: ShellUser;
  company: ShellCompany;
  memberships: ShellMembership[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sur mobile, le menu recouvre l'ecran : le refermer a la navigation evite
  // que l'utilisateur ait a le fermer manuellement apres chaque clic. L'ajuster
  // pendant le rendu, et non dans un effet, evite d'afficher une premiere fois
  // le menu encore ouvert sur la nouvelle page avant de le refermer.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMenuOpen(false);
  }

  async function logout() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/connexion');
    router.refresh();
  }

  async function switchCompany(membershipId: string) {
    setBusy(true);
    await fetch('/api/auth/switch-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId }),
    });
    router.refresh();
    setBusy(false);
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4" aria-label="Navigation principale">
      {navigation.map((section) => (
        <div key={section.label}>
          <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/tableau-de-bord' && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition',
                      active
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                    )}
                  >
                    <Icon name={item.icon} className={cx('size-5 shrink-0', active && 'text-brand-700')} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-ink-100">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-3 sm:px-5">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="grid size-11 place-items-center rounded-lg text-ink-600 hover:bg-ink-100 lg:hidden"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} />
        </button>

        <Link href="/tableau-de-bord" className="flex shrink-0 items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white">
            G
          </span>
          <span className="hidden font-semibold text-ink-900 sm:inline">GestiOne</span>
        </Link>

        <GlobalSearch />

        <div className="flex shrink-0 items-center gap-2">
          {memberships.length > 1 && (
            <label className="hidden items-center gap-2 sm:flex">
              <span className="sr-only">Entreprise active</span>
              <select
                value={memberships.find((m) => m.companyId === company.id)?.id ?? ''}
                onChange={(event) => switchCompany(event.target.value)}
                disabled={busy}
                className="min-h-9 rounded-lg border-0 bg-ink-100 px-2 text-sm font-medium text-ink-800 ring-1 ring-inset ring-ink-200"
              >
                {memberships.map((membership) => (
                  <option key={membership.id} value={membership.id}>
                    {membership.companyName}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-ink-900">{user.fullName}</p>
            <p className="text-xs leading-tight text-ink-500">{user.roleName}</p>
          </div>

          <button
            type="button"
            onClick={logout}
            disabled={busy}
            className="grid size-11 place-items-center rounded-lg text-ink-600 hover:bg-ink-100 disabled:opacity-50"
            title="Se deconnecter"
          >
            <Icon name="logout" />
            <span className="sr-only">Se deconnecter</span>
          </button>
        </div>
      </header>

      <Connectivity />

      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 border-r border-ink-200 bg-white lg:block">
          {sidebar}
        </aside>

        {menuOpen && (
          <div className="fixed inset-0 top-14 z-20 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-ink-900/40"
              onClick={() => setMenuOpen(false)}
              aria-label="Fermer le menu"
            />
            <div className="relative h-full w-72 max-w-[85vw] bg-white shadow-xl">{sidebar}</div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-3 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
