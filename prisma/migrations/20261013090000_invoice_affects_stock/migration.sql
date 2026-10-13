-- Facture d'avance : encaissable sans sortie de stock. Les factures existantes
-- ont toutes deja sorti leur stock (ou n'en avaient pas) : true par defaut.
ALTER TABLE "invoices" ADD COLUMN "affectsStock" BOOLEAN NOT NULL DEFAULT true;
