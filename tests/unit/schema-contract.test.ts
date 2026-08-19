import { describe, expect, it } from 'vitest';
import { paymentSchema, invoiceSchema, saleSchema } from '@/lib/validation/commerce';
import { purchaseSchema, expenseSchema } from '@/lib/validation/finance';
import { quoteSchema } from '@/lib/validation/commerce';
import { updateCompanySchema } from '@/lib/validation/company';
import {
  changePasswordSchema,
  profileSchema,
  resetMemberPasswordSchema,
} from '@/lib/validation/profile';

/**
 * Contrat entre les schemas de validation et les services.
 *
 * Zod **retire silencieusement** toute cle absente du schema. Un champ oublie
 * ne provoque donc aucune erreur : la requete reussit, mais l'information
 * n'atteint jamais le service. C'est exactement ainsi qu'un reglement
 * fournisseur a pu etre accepte sans jamais reduire la dette — le service
 * fonctionnait, le schema mangeait `orderId`.
 *
 * Ces tests verifient que chaque champ dont un service a besoin survit a la
 * validation.
 */

describe('paymentSchema', () => {
  it('conserve tous les champs lus par recordPayment', () => {
    const parsed = paymentSchema(0).parse({
      direction: 'OUT',
      amount: '15 000',
      invoiceId: 'inv_1',
      orderId: 'po_1',
      partnerId: 'partner_1',
      methodId: 'method_1',
      locationId: 'loc_1',
      paidAt: '2026-08-19',
      reference: 'VIR-001',
      notes: 'Solde',
      allowOverpayment: true,
    });

    expect(parsed.direction).toBe('OUT');
    expect(parsed.amount).toBe(15_000n);
    expect(parsed.invoiceId).toBe('inv_1');
    // Le champ dont l'absence rendait les reglements fournisseur sans effet.
    expect(parsed.orderId).toBe('po_1');
    expect(parsed.partnerId).toBe('partner_1');
    expect(parsed.methodId).toBe('method_1');
    expect(parsed.locationId).toBe('loc_1');
    expect(parsed.reference).toBe('VIR-001');
    expect(parsed.allowOverpayment).toBe(true);
  });

  it('rend undefined pour les identifiants vides plutot que la chaine vide', () => {
    const parsed = paymentSchema(0).parse({ amount: '100', invoiceId: '', orderId: '' });
    expect(parsed.invoiceId).toBeUndefined();
    expect(parsed.orderId).toBeUndefined();
  });
});

describe('invoiceSchema', () => {
  it('conserve tous les champs lus par createInvoice', () => {
    const parsed = invoiceSchema(0).parse({
      customerId: 'cust_1',
      locationId: 'loc_1',
      issueDate: '2026-08-19',
      dueDate: '2026-09-18',
      discountAmount: '5 000',
      notes: 'Merci',
      terms: 'Paiement a 30 jours',
      issue: true,
      lines: [
        {
          productId: 'prod_1',
          description: 'Sac de riz',
          quantity: '3',
          unitPrice: '15 000',
          discountRate: '10',
          taxRateId: 'tax_1',
        },
      ],
    });

    expect(parsed.customerId).toBe('cust_1');
    expect(parsed.locationId).toBe('loc_1');
    expect(parsed.issue).toBe(true);
    expect(parsed.discountAmount).toBe(5_000n);
    expect(parsed.lines[0]).toMatchObject({
      productId: 'prod_1',
      description: 'Sac de riz',
      quantity: 3_000n,
      unitPrice: 15_000n,
      discountRate: 1_000,
      taxRateId: 'tax_1',
    });
  });
});

describe('saleSchema', () => {
  it('conserve le reglement et son montant tendu', () => {
    const parsed = saleSchema(0).parse({
      customerId: 'cust_1',
      locationId: 'loc_1',
      lines: [{ productId: 'prod_1', quantity: '2' }],
      payment: { methodId: 'method_1', amount: '50 000', reference: 'MP-1' },
    });

    expect(parsed.locationId).toBe('loc_1');
    expect(parsed.payment?.methodId).toBe('method_1');
    expect(parsed.payment?.amount).toBe(50_000n);
    expect(parsed.payment?.reference).toBe('MP-1');
  });

  it('accepte une vente sans reglement (vente a credit)', () => {
    const parsed = saleSchema(0).parse({
      customerId: 'cust_1',
      locationId: 'loc_1',
      lines: [{ productId: 'prod_1', quantity: '2' }],
    });
    expect(parsed.payment).toBeUndefined();
  });

  it('laisse passer le nom d un client qui n a pas encore de fiche', () => {
    // Sans cette cle dans le schema, le nom tape au comptoir serait retire
    // silencieusement et la vente repartirait sans client.
    const parsed = saleSchema(0).parse({
      customerName: 'Mariam Sanogo',
      locationId: 'loc_1',
      lines: [{ productId: 'prod_1', quantity: '2' }],
    });

    expect(parsed.customerName).toBe('Mariam Sanogo');
    expect(parsed.customerId).toBeUndefined();
  });
});

describe('nom de tiers saisi a la volee', () => {
  it('survit a la validation sur les trois documents commerciaux', () => {
    expect(
      saleSchema(0).parse({
        customerName: 'Kone',
        locationId: 'loc_1',
        lines: [{ productId: 'p', quantity: '1' }],
      }).customerName,
    ).toBe('Kone');

    expect(
      invoiceSchema(0).parse({ customerName: 'Kone', lines: [{ productId: 'p', quantity: '1' }] })
        .customerName,
    ).toBe('Kone');

    expect(
      quoteSchema(0).parse({ customerName: 'Kone', lines: [{ productId: 'p', quantity: '1' }] })
        .customerName,
    ).toBe('Kone');

    expect(
      purchaseSchema(0).parse({
        supplierName: 'Grossiste Central',
        lines: [{ productId: 'p', quantity: '1' }],
      }).supplierName,
    ).toBe('Grossiste Central');
  });

  it('traite un nom vide comme une absence de tiers', () => {
    const parsed = saleSchema(0).parse({
      customerName: '   ',
      locationId: 'loc_1',
      lines: [{ productId: 'p', quantity: '1' }],
    });
    expect(parsed.customerName).toBeUndefined();
  });
});

describe('purchaseSchema', () => {
  it('conserve tous les champs lus par createPurchaseOrder', () => {
    const parsed = purchaseSchema(0).parse({
      supplierId: 'sup_1',
      locationId: 'loc_1',
      orderDate: '2026-08-19',
      expectedAt: '2026-08-25',
      dueDate: '2026-09-18',
      reference: 'BL-42',
      notes: 'Livraison matin',
      order: true,
      receiveNow: true,
      lines: [
        {
          productId: 'prod_1',
          description: 'Sac de riz',
          quantity: '20',
          unitCost: '11 500',
          taxRateId: 'tax_1',
        },
      ],
    });

    expect(parsed.supplierId).toBe('sup_1');
    expect(parsed.locationId).toBe('loc_1');
    expect(parsed.receiveNow).toBe(true);
    expect(parsed.reference).toBe('BL-42');
    expect(parsed.lines[0]).toMatchObject({
      productId: 'prod_1',
      quantity: 20_000n,
      unitCost: 11_500n,
      taxRateId: 'tax_1',
    });
  });
});

describe('expenseSchema', () => {
  it('conserve tous les champs lus par recordExpense', () => {
    const parsed = expenseSchema(0).parse({
      categoryId: 'cat_1',
      locationId: 'loc_1',
      supplierId: 'sup_1',
      methodId: 'method_1',
      amount: '12 000',
      spentAt: '2026-08-19',
      description: 'Carburant',
      reference: 'REC-1',
      notes: 'Livraison',
    });

    expect(parsed.categoryId).toBe('cat_1');
    expect(parsed.locationId).toBe('loc_1');
    expect(parsed.supplierId).toBe('sup_1');
    expect(parsed.methodId).toBe('method_1');
    expect(parsed.amount).toBe(12_000n);
    expect(parsed.description).toBe('Carburant');
  });
});

describe('updateCompanySchema — logo et format de document', () => {
  const base = {
    name: 'Boutique Awa',
    countryCode: 'CI',
    currencyCode: 'XOF',
    primaryColor: '#0F766E',
    invoicePrefix: 'FAC',
    quotePrefix: 'DEV',
    salePrefix: 'VTE',
    purchasePrefix: 'CMD',
    defaultDueDays: 30,
    documentFormat: 'A4',
  };

  it('accepte un logo transmis en image encodee', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    expect(updateCompanySchema.parse({ ...base, logoUrl: logo }).logoUrl).toBe(logo);
  });

  it('accepte les trois formats d impression', () => {
    for (const format of ['A4', 'A5', 'RECEIPT']) {
      expect(updateCompanySchema.parse({ ...base, documentFormat: format }).documentFormat).toBe(
        format,
      );
    }
  });

  it('refuse un format inconnu', () => {
    expect(() => updateCompanySchema.parse({ ...base, documentFormat: 'A3' })).toThrow();
  });

  it("refuse ce qui n'est pas une image", () => {
    expect(() =>
      updateCompanySchema.parse({ ...base, logoUrl: 'https://exemple.test/logo.png' }),
    ).toThrow();
    expect(() =>
      updateCompanySchema.parse({ ...base, logoUrl: 'data:text/html;base64,PHNjcmlwdD4=' }),
    ).toThrow();
  });

  it('traite un logo vide comme une absence de logo', () => {
    expect(updateCompanySchema.parse({ ...base, logoUrl: '' }).logoUrl).toBeUndefined();
  });
});

describe('profileSchema', () => {
  it('conserve les champs lus par updateProfile', () => {
    const parsed = profileSchema.parse({
      fullName: '  Ama Diallo  ',
      phone: '+225 07 00 00 00 00',
    });
    expect(parsed.fullName).toBe('Ama Diallo');
    expect(parsed.phone).toBe('+225 07 00 00 00 00');
  });

  it('rend undefined pour un telephone vide, pour effacer le champ', () => {
    expect(profileSchema.parse({ fullName: 'Ama Diallo', phone: '' }).phone).toBeUndefined();
  });
});

describe('changePasswordSchema', () => {
  it('conserve les deux mots de passe lus par changeOwnPassword', () => {
    const parsed = changePasswordSchema.parse({
      currentPassword: 'MotDePasse1',
      newPassword: 'NouveauPass2',
    });
    expect(parsed.currentPassword).toBe('MotDePasse1');
    expect(parsed.newPassword).toBe('NouveauPass2');
  });

  it('ne touche pas au mot de passe actuel', () => {
    const parsed = changePasswordSchema.parse({
      currentPassword: ' avec espaces 1',
      newPassword: 'NouveauPass2',
    });
    expect(parsed.currentPassword).toBe(' avec espaces 1');
  });

  it('applique au nouveau mot de passe les regles de l inscription', () => {
    expect(() =>
      changePasswordSchema.parse({ currentPassword: 'MotDePasse1', newPassword: 'court1' }),
    ).toThrow();
    expect(() =>
      changePasswordSchema.parse({ currentPassword: 'MotDePasse1', newPassword: 'sanschiffre' }),
    ).toThrow();
    expect(() =>
      changePasswordSchema.parse({ currentPassword: 'MotDePasse1', newPassword: '12345678' }),
    ).toThrow();
  });
});

describe('resetMemberPasswordSchema', () => {
  it('conserve le mot de passe lu par resetMemberPassword', () => {
    expect(resetMemberPasswordSchema.parse({ password: 'ProvisoireX1' }).password).toBe(
      'ProvisoireX1',
    );
  });
});
