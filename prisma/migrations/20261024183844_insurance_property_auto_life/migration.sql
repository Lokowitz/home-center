-- CreateTable
CREATE TABLE "InsurancePremium" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyId" TEXT NOT NULL,
    "effectiveDate" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'ANNUAL',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InsurancePremium_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsuranceCoverage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "limit" REAL,
    "deductible" REAL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InsuranceCoverage_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_InsurancePolicyToProperty" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_InsurancePolicyToProperty_A_fkey" FOREIGN KEY ("A") REFERENCES "InsurancePolicy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_InsurancePolicyToProperty_B_fkey" FOREIGN KEY ("B") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_InsurancePolicyToVehicle" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_InsurancePolicyToVehicle_A_fkey" FOREIGN KEY ("A") REFERENCES "InsurancePolicy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_InsurancePolicyToVehicle_B_fkey" FOREIGN KEY ("B") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InsurancePremium_policyId_idx" ON "InsurancePremium"("policyId");

-- CreateIndex
CREATE INDEX "InsuranceCoverage_policyId_idx" ON "InsuranceCoverage"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "_InsurancePolicyToProperty_AB_unique" ON "_InsurancePolicyToProperty"("A", "B");

-- CreateIndex
CREATE INDEX "_InsurancePolicyToProperty_B_index" ON "_InsurancePolicyToProperty"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_InsurancePolicyToVehicle_AB_unique" ON "_InsurancePolicyToVehicle"("A", "B");

-- CreateIndex
CREATE INDEX "_InsurancePolicyToVehicle_B_index" ON "_InsurancePolicyToVehicle"("B");
