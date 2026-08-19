import { describe, expect, it } from 'vitest';
import {
  TotalsError,
  balanceDue,
  computeTotals,
  distributeProportionally,
  paymentStatus,
  resolveUnitPrice,
  splitEvenly,
} from '@/lib/totals';

describe('distributeProportionally', () => {
  it('repartit exactement, sans perdre ni creer d unite', () => {
    // 100 a repartir sur 3 parts egales : 34 + 33 + 33, pas 33 + 33 + 33.
    const shares = distributeProportionally(100n, [1n, 1n, 1n]);
    expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(100n);
    expect([...shares].sort()).toEqual([33n, 33n, 34n]);
  });

  it('respecte les poids', () => {
    const shares = distributeProportionally(100n, [70n, 30n]);
    expect(shares).toEqual([70n, 30n]);
  });

  it('conserve le total sur des poids irreguliers', () => {
    const weights = [333n, 333n, 334n, 1n, 7n];
    const shares = distributeProportionally(1_000n, weights);
    expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(1_000n);
  });

  it('impute tout a la premiere ligne quand les poids sont nuls', () => {
    expect(distributeProportionally(500n, [0n, 0n])).toEqual([500n, 0n]);
  });

  it('rend une liste vide pour zero part', () => {
    expect(distributeProportionally(100n, [])).toEqual([]);
  });

  it('ne repartit rien quand le montant est nul', () => {
    expect(distributeProportionally(0n, [5n, 5n])).toEqual([0n, 0n]);
  });
});

describe('computeTotals — cas simples', () => {
  it('calcule une ligne sans remise ni taxe', () => {
    // 3 sacs a 15 000 F.
    const totals = computeTotals([{ quantity: 3_000n, unitPrice: 15_000n }]);
    expect(totals.subtotal).toBe(45_000n);
    expect(totals.taxTotal).toBe(0n);
    expect(totals.total).toBe(45_000n);
  });

  it('applique une remise de ligne', () => {
    // 45 000 - 10 % = 40 500.
    const totals = computeTotals([
      { quantity: 3_000n, unitPrice: 15_000n, discountRate: 1_000 },
    ]);
    expect(totals.lines[0]?.lineDiscount).toBe(4_500n);
    expect(totals.subtotal).toBe(40_500n);
  });

  it('applique une taxe de ligne', () => {
    // 45 000 + 18 % = 53 100.
    const totals = computeTotals([{ quantity: 3_000n, unitPrice: 15_000n, taxRate: 1_800 }]);
    expect(totals.taxTotal).toBe(8_100n);
    expect(totals.total).toBe(53_100n);
  });

  it('gere une quantite fractionnaire', () => {
    // 0,750 kg a 2 000 F/kg = 1 500 F.
    const totals = computeTotals([{ quantity: 750n, unitPrice: 2_000n }]);
    expect(totals.total).toBe(1_500n);
  });

  it('rend zero pour un document vide', () => {
    const totals = computeTotals([]);
    expect(totals.total).toBe(0n);
    expect(totals.subtotal).toBe(0n);
    expect(totals.lines).toEqual([]);
  });
});

describe('computeTotals — remise globale', () => {
  it('repartit une remise en montant sans perdre d unite', () => {
    const totals = computeTotals(
      [
        { quantity: 1_000n, unitPrice: 10_000n },
        { quantity: 1_000n, unitPrice: 10_000n },
        { quantity: 1_000n, unitPrice: 10_000n },
      ],
      { amount: 1_000n },
    );

    const allocated = totals.lines.reduce((sum, line) => sum + line.allocatedDiscount, 0n);
    expect(allocated).toBe(1_000n);
    expect(totals.total).toBe(29_000n);
  });

  it('repartit une remise en pourcentage', () => {
    const totals = computeTotals(
      [
        { quantity: 1_000n, unitPrice: 30_000n },
        { quantity: 1_000n, unitPrice: 10_000n },
      ],
      { rate: 1_000 },
    );

    expect(totals.discountTotal).toBe(4_000n);
    expect(totals.lines[0]?.allocatedDiscount).toBe(3_000n);
    expect(totals.lines[1]?.allocatedDiscount).toBe(1_000n);
    expect(totals.total).toBe(36_000n);
  });

  it('taxe apres remise globale, et non avant', () => {
    // 100 000 - 10 % = 90 000, puis 18 % = 16 200. Total 106 200.
    // Taxer avant la remise donnerait 118 000 - 10 % = 106 200 par coincidence,
    // mais l'assiette declaree serait fausse : la taxe doit porter sur 90 000.
    const totals = computeTotals(
      [{ quantity: 1_000n, unitPrice: 100_000n, taxRate: 1_800 }],
      { rate: 1_000 },
    );
    expect(totals.taxableTotal).toBe(90_000n);
    expect(totals.taxTotal).toBe(16_200n);
    expect(totals.total).toBe(106_200n);
  });

  it('repartit correctement avec des taux de taxe differents par ligne', () => {
    const totals = computeTotals(
      [
        { quantity: 1_000n, unitPrice: 50_000n, taxRate: 1_800 },
        { quantity: 1_000n, unitPrice: 50_000n, taxRate: 0 },
      ],
      { amount: 10_000n },
    );

    // La remise se repartit a parts egales : 5 000 chacune.
    expect(totals.lines.map((line) => line.allocatedDiscount)).toEqual([5_000n, 5_000n]);
    // Seule la premiere ligne est taxee : 45 000 x 18 % = 8 100.
    expect(totals.taxTotal).toBe(8_100n);
    expect(totals.total).toBe(98_100n);
  });

  it('cumule remise de ligne et remise globale', () => {
    const totals = computeTotals(
      [{ quantity: 2_000n, unitPrice: 10_000n, discountRate: 500 }],
      { rate: 1_000 },
    );
    // 20 000 - 5 % = 19 000 ; puis - 10 % = 17 100.
    expect(totals.subtotal).toBe(19_000n);
    expect(totals.discountTotal).toBe(1_900n);
    expect(totals.total).toBe(17_100n);
  });

  it('refuse une remise superieure au montant du document', () => {
    expect(() =>
      computeTotals([{ quantity: 1_000n, unitPrice: 1_000n }], { amount: 2_000n }),
    ).toThrow(TotalsError);
  });

  it('refuse un montant et un pourcentage simultanes', () => {
    expect(() =>
      computeTotals([{ quantity: 1_000n, unitPrice: 1_000n }], { amount: 100n, rate: 500 }),
    ).toThrow(TotalsError);
  });

  it('accepte une remise de 100 %', () => {
    const totals = computeTotals([{ quantity: 1_000n, unitPrice: 5_000n }], { rate: 10_000 });
    expect(totals.total).toBe(0n);
  });

  it('refuse une remise negative ou superieure a 100 %', () => {
    expect(() => computeTotals([{ quantity: 1_000n, unitPrice: 1_000n }], { rate: -1 })).toThrow(
      TotalsError,
    );
    expect(() =>
      computeTotals([{ quantity: 1_000n, unitPrice: 1_000n }], { rate: 10_001 }),
    ).toThrow(TotalsError);
  });
});

describe('computeTotals — coherence', () => {
  it('le total egale toujours la somme des lignes', () => {
    const totals = computeTotals(
      [
        { quantity: 1_333n, unitPrice: 1_333n, discountRate: 733, taxRate: 1_800 },
        { quantity: 7n, unitPrice: 99_999n, taxRate: 550 },
        { quantity: 250n, unitPrice: 3n, discountRate: 1_250, taxRate: 1_800 },
      ],
      { amount: 137n },
    );

    const sumOfLines = totals.lines.reduce((sum, line) => sum + line.total, 0n);
    expect(sumOfLines).toBe(totals.total);
    expect(totals.taxableTotal).toBe(totals.subtotal - totals.discountTotal);
  });

  it('refuse une quantite ou un prix negatif', () => {
    expect(() => computeTotals([{ quantity: -1n, unitPrice: 100n }])).toThrow(TotalsError);
    expect(() => computeTotals([{ quantity: 1n, unitPrice: -100n }])).toThrow(TotalsError);
  });
});

describe('resolveUnitPrice', () => {
  const product = {
    salePrice: 15_000n,
    wholesalePrice: 13_000n,
    wholesaleFrom: 10_000n, // a partir de 10 unites
    specialPrice: 12_000n,
  };

  it('applique le prix de detail sous le seuil de gros', () => {
    expect(resolveUnitPrice(product, 5_000n)).toBe(15_000n);
  });

  it('applique le prix de gros a partir du seuil, seuil inclus', () => {
    expect(resolveUnitPrice(product, 10_000n)).toBe(13_000n);
    expect(resolveUnitPrice(product, 20_000n)).toBe(13_000n);
  });

  it('donne la priorite au prix special', () => {
    expect(resolveUnitPrice(product, 50_000n, { useSpecialPrice: true })).toBe(12_000n);
  });

  it('retombe sur le prix de detail sans tarif de gros', () => {
    expect(
      resolveUnitPrice(
        { salePrice: 15_000n, wholesalePrice: null, wholesaleFrom: null, specialPrice: null },
        99_000n,
      ),
    ).toBe(15_000n);
  });

  it('ignore un prix special demande mais absent', () => {
    expect(
      resolveUnitPrice(
        { salePrice: 15_000n, wholesalePrice: null, wholesaleFrom: null, specialPrice: null },
        1_000n,
        { useSpecialPrice: true },
      ),
    ).toBe(15_000n);
  });
});

describe('balanceDue et paymentStatus', () => {
  it('calcule le reste a payer', () => {
    expect(balanceDue(50_000n, 20_000n)).toBe(30_000n);
    expect(balanceDue(50_000n, 50_000n)).toBe(0n);
  });

  it('ne rend jamais un reste negatif', () => {
    // Un trop-percu n'est pas une dette du client envers lui-meme.
    expect(balanceDue(50_000n, 60_000n)).toBe(0n);
  });

  it('qualifie le statut de paiement', () => {
    expect(paymentStatus(50_000n, 0n)).toBe('UNPAID');
    expect(paymentStatus(50_000n, 20_000n)).toBe('PARTIALLY_PAID');
    expect(paymentStatus(50_000n, 50_000n)).toBe('PAID');
    expect(paymentStatus(50_000n, 60_000n)).toBe('PAID');
  });
});

describe('splitEvenly', () => {
  it('repartit sans perte', () => {
    const parts = splitEvenly(10_000n, 3);
    expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(10_000n);
  });

  it('refuse un nombre de parts nul', () => {
    expect(() => splitEvenly(100n, 0)).toThrow(TotalsError);
  });
});
