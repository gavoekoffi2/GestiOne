/**
 * Liste des pays proposes a l'inscription, avec leur devise usuelle.
 *
 * GestiOne est un produit universel : la liste couvre plusieurs continents.
 * Elle est simplement ordonnee de facon a placer en tete les marches vises en
 * premier, et la devise suggeree reste modifiable par l'utilisateur.
 */
export interface Country {
  code: string;
  name: string;
  currency: string;
  dialCode: string;
}

export const COUNTRIES: Country[] = [
  { code: 'CI', name: "Côte d'Ivoire", currency: 'XOF', dialCode: '+225' },
  { code: 'SN', name: 'Sénégal', currency: 'XOF', dialCode: '+221' },
  { code: 'BJ', name: 'Bénin', currency: 'XOF', dialCode: '+229' },
  { code: 'BF', name: 'Burkina Faso', currency: 'XOF', dialCode: '+226' },
  { code: 'ML', name: 'Mali', currency: 'XOF', dialCode: '+223' },
  { code: 'NE', name: 'Niger', currency: 'XOF', dialCode: '+227' },
  { code: 'TG', name: 'Togo', currency: 'XOF', dialCode: '+228' },
  { code: 'GW', name: 'Guinee-Bissau', currency: 'XOF', dialCode: '+245' },
  { code: 'CM', name: 'Cameroun', currency: 'XAF', dialCode: '+237' },
  { code: 'GA', name: 'Gabon', currency: 'XAF', dialCode: '+241' },
  { code: 'CG', name: 'Congo', currency: 'XAF', dialCode: '+242' },
  { code: 'TD', name: 'Tchad', currency: 'XAF', dialCode: '+235' },
  { code: 'CF', name: 'République centrafricaine', currency: 'XAF', dialCode: '+236' },
  { code: 'GQ', name: 'Guinée équatoriale', currency: 'XAF', dialCode: '+240' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', dialCode: '+233' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', dialCode: '+234' },
  { code: 'GN', name: 'Guinée', currency: 'GNF', dialCode: '+224' },
  { code: 'CD', name: 'République démocratique du Congo', currency: 'CDF', dialCode: '+243' },
  { code: 'KE', name: 'Kenya', currency: 'KES', dialCode: '+254' },
  { code: 'ZA', name: 'Afrique du Sud', currency: 'ZAR', dialCode: '+27' },
  { code: 'MA', name: 'Maroc', currency: 'MAD', dialCode: '+212' },
  { code: 'TN', name: 'Tunisie', currency: 'TND', dialCode: '+216' },
  { code: 'FR', name: 'France', currency: 'EUR', dialCode: '+33' },
  { code: 'BE', name: 'Belgique', currency: 'EUR', dialCode: '+32' },
  { code: 'CH', name: 'Suisse', currency: 'EUR', dialCode: '+41' },
  { code: 'CA', name: 'Canada', currency: 'CAD', dialCode: '+1' },
  { code: 'US', name: 'Etats-Unis', currency: 'USD', dialCode: '+1' },
  { code: 'GB', name: 'Royaume-Uni', currency: 'GBP', dialCode: '+44' },
];

export function findCountry(code: string): Country | undefined {
  return COUNTRIES.find((country) => country.code === code);
}
