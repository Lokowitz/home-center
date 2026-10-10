-- CreateTable
CREATE TABLE "InboxItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "parsedDate" DATETIME,
    "parsedTotal" REAL,
    "parsedVendor" TEXT,
    "parseMethod" TEXT,
    "suggestedAssetType" TEXT,
    "suggestedAssetId" TEXT,
    "error" TEXT,
    CONSTRAINT "InboxItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    "serviceRecordId" TEXT,
    "warrantyId" TEXT,
    "maintenanceScheduleId" TEXT,
    "healthConditionId" TEXT,
    "insurancePolicyId" TEXT,
    "observationId" TEXT,
    "medicationId" TEXT,
    "allergyId" TEXT,
    "immunizationId" TEXT,
    "assetType" TEXT,
    "assetId" TEXT,
    "inboxItemId" TEXT,
    CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attachment_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_maintenanceScheduleId_fkey" FOREIGN KEY ("maintenanceScheduleId") REFERENCES "MaintenanceSchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_healthConditionId_fkey" FOREIGN KEY ("healthConditionId") REFERENCES "HealthCondition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_insurancePolicyId_fkey" FOREIGN KEY ("insurancePolicyId") REFERENCES "InsurancePolicy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_allergyId_fkey" FOREIGN KEY ("allergyId") REFERENCES "Allergy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_immunizationId_fkey" FOREIGN KEY ("immunizationId") REFERENCES "Immunization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "InboxItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("allergyId", "assetId", "assetType", "filename", "healthConditionId", "id", "immunizationId", "insurancePolicyId", "maintenanceScheduleId", "medicationId", "mimeType", "observationId", "originalName", "recordType", "serviceRecordId", "sizeBytes", "uploadedAt", "uploadedById", "warrantyId") SELECT "allergyId", "assetId", "assetType", "filename", "healthConditionId", "id", "immunizationId", "insurancePolicyId", "maintenanceScheduleId", "medicationId", "mimeType", "observationId", "originalName", "recordType", "serviceRecordId", "sizeBytes", "uploadedAt", "uploadedById", "warrantyId" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
CREATE INDEX "Attachment_assetType_assetId_idx" ON "Attachment"("assetType", "assetId");
CREATE INDEX "Attachment_inboxItemId_idx" ON "Attachment"("inboxItemId");
CREATE TABLE "new_DocumentSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "indexingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ocrEnabled" BOOLEAN NOT NULL DEFAULT true,
    "semanticEnabled" BOOLEAN NOT NULL DEFAULT true,
    "embeddingModel" TEXT NOT NULL DEFAULT 'bge-small-en-v1.5',
    "captureParser" TEXT NOT NULL DEFAULT 'BASIC',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_DocumentSettings" ("embeddingModel", "id", "indexingEnabled", "ocrEnabled", "semanticEnabled", "updatedAt") SELECT "embeddingModel", "id", "indexingEnabled", "ocrEnabled", "semanticEnabled", "updatedAt" FROM "DocumentSettings";
DROP TABLE "DocumentSettings";
ALTER TABLE "new_DocumentSettings" RENAME TO "DocumentSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

