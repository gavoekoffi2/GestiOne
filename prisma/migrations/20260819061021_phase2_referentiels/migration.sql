-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "phone" TEXT,
    "secondPhone" TEXT,
    "email" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "countryCode" TEXT,
    "taxNumber" TEXT,
    "creditLimit" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GOOD',
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "description" TEXT,
    "categoryId" TEXT,
    "unitId" TEXT,
    "supplierId" TEXT,
    "imageUrl" TEXT,
    "costPrice" BIGINT NOT NULL DEFAULT 0,
    "salePrice" BIGINT NOT NULL DEFAULT 0,
    "wholesalePrice" BIGINT,
    "wholesaleFrom" BIGINT,
    "specialPrice" BIGINT,
    "minStock" BIGINT NOT NULL DEFAULT 0,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partners_companyId_kind_isActive_idx" ON "partners"("companyId", "kind", "isActive");

-- CreateIndex
CREATE INDEX "partners_companyId_name_idx" ON "partners"("companyId", "name");

-- CreateIndex
CREATE INDEX "partners_companyId_phone_idx" ON "partners"("companyId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "partners_companyId_kind_code_key" ON "partners"("companyId", "kind", "code");

-- CreateIndex
CREATE INDEX "categories_companyId_idx" ON "categories"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_companyId_name_parentId_key" ON "categories"("companyId", "name", "parentId");

-- CreateIndex
CREATE INDEX "units_companyId_idx" ON "units"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "units_companyId_symbol_key" ON "units"("companyId", "symbol");

-- CreateIndex
CREATE INDEX "products_companyId_isActive_idx" ON "products"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "products_companyId_name_idx" ON "products"("companyId", "name");

-- CreateIndex
CREATE INDEX "products_companyId_barcode_idx" ON "products"("companyId", "barcode");

-- CreateIndex
CREATE INDEX "products_companyId_categoryId_idx" ON "products"("companyId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "products_companyId_sku_key" ON "products"("companyId", "sku");

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
