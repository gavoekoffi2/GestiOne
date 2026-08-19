import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  WILDCARD,
  hasPermission,
  isPermissionKey,
} from '@/server/permissions';

describe('catalogue de permissions', () => {
  it('ne contient aucun doublon', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('respecte le format <domaine>.<action>', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+\.[a-z.]+$/);
    }
  });
});

describe('hasPermission', () => {
  it('accorde tout au caractere generique', () => {
    expect(hasPermission([WILDCARD], 'settings.users')).toBe(true);
    expect(hasPermission([WILDCARD], 'sales.create')).toBe(true);
  });

  it('accorde une permission explicitement listee', () => {
    expect(hasPermission(['sales.create'], 'sales.create')).toBe(true);
  });

  it('refuse une permission absente', () => {
    expect(hasPermission(['sales.create'], 'sales.cancel')).toBe(false);
    expect(hasPermission([], 'sales.create')).toBe(false);
  });
});

describe('roles systeme', () => {
  it('ne referencent que des permissions du catalogue', () => {
    for (const role of SYSTEM_ROLES) {
      for (const permission of role.permissions) {
        if (permission === WILDCARD) continue;
        expect(isPermissionKey(permission), `${role.key} -> ${permission}`).toBe(true);
      }
    }
  });

  it("donne l'acces complet a l'administrateur uniquement", () => {
    const admin = SYSTEM_ROLES.find((role) => role.key === 'ADMIN');
    expect(admin?.permissions).toEqual([WILDCARD]);

    for (const role of SYSTEM_ROLES.filter((candidate) => candidate.key !== 'ADMIN')) {
      expect(role.permissions).not.toContain(WILDCARD);
    }
  });

  it("n'accorde la gestion des utilisateurs et des roles qu'a l'administrateur", () => {
    for (const role of SYSTEM_ROLES.filter((candidate) => candidate.key !== 'ADMIN')) {
      expect(hasPermission(role.permissions, 'settings.users')).toBe(false);
      expect(hasPermission(role.permissions, 'settings.roles')).toBe(false);
    }
  });

  it("ne montre pas les prix d'achat au commercial ni au caissier", () => {
    for (const key of ['SALES', 'CASHIER']) {
      const role = SYSTEM_ROLES.find((candidate) => candidate.key === key)!;
      expect(hasPermission(role.permissions, 'products.cost.read')).toBe(false);
    }
  });

  it('donne au caissier la caisse mais pas la modification du catalogue', () => {
    const cashier = SYSTEM_ROLES.find((role) => role.key === 'CASHIER')!;
    expect(hasPermission(cashier.permissions, 'cash.operate')).toBe(true);
    expect(hasPermission(cashier.permissions, 'products.write')).toBe(false);
  });

  it('donne au gestionnaire de stock les mouvements mais pas les ventes', () => {
    const stock = SYSTEM_ROLES.find((role) => role.key === 'STOCK')!;
    expect(hasPermission(stock.permissions, 'stock.adjust')).toBe(true);
    expect(hasPermission(stock.permissions, 'sales.create')).toBe(false);
  });
});
