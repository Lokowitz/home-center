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
    "uploadedById" TEXT,
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
    "roomId" TEXT,
    CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Attachment_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_maintenanceScheduleId_fkey" FOREIGN KEY ("maintenanceScheduleId") REFERENCES "MaintenanceSchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_healthConditionId_fkey" FOREIGN KEY ("healthConditionId") REFERENCES "HealthCondition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_insurancePolicyId_fkey" FOREIGN KEY ("insurancePolicyId") REFERENCES "InsurancePolicy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_allergyId_fkey" FOREIGN KEY ("allergyId") REFERENCES "Allergy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_immunizationId_fkey" FOREIGN KEY ("immunizationId") REFERENCES "Immunization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "InboxItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("allergyId", "assetId", "assetType", "filename", "healthConditionId", "id", "immunizationId", "inboxItemId", "insurancePolicyId", "maintenanceScheduleId", "medicationId", "mimeType", "observationId", "originalName", "recordType", "roomId", "serviceRecordId", "sizeBytes", "uploadedAt", "uploadedById", "warrantyId") SELECT "allergyId", "assetId", "assetType", "filename", "healthConditionId", "id", "immunizationId", "inboxItemId", "insurancePolicyId", "maintenanceScheduleId", "medicationId", "mimeType", "observationId", "originalName", "recordType", "roomId", "serviceRecordId", "sizeBytes", "uploadedAt", "uploadedById", "warrantyId" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
CREATE INDEX "Attachment_roomId_idx" ON "Attachment"("roomId");
CREATE INDEX "Attachment_assetType_assetId_idx" ON "Attachment"("assetType", "assetId");
CREATE INDEX "Attachment_inboxItemId_idx" ON "Attachment"("inboxItemId");
CREATE TABLE "new_InboxItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "parsedDate" DATETIME,
    "parsedTotal" REAL,
    "parsedVendor" TEXT,
    "parseMethod" TEXT,
    "parseNote" TEXT,
    "suggestedAssetType" TEXT,
    "suggestedAssetId" TEXT,
    "suggestedReason" TEXT,
    "suggestedByUser" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    CONSTRAINT "InboxItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InboxItem" ("createdAt", "createdById", "error", "id", "parseMethod", "parseNote", "parsedDate", "parsedTotal", "parsedVendor", "status", "suggestedAssetId", "suggestedAssetType", "suggestedByUser", "suggestedReason") SELECT "createdAt", "createdById", "error", "id", "parseMethod", "parseNote", "parsedDate", "parsedTotal", "parsedVendor", "status", "suggestedAssetId", "suggestedAssetType", "suggestedByUser", "suggestedReason" FROM "InboxItem";
DROP TABLE "InboxItem";
ALTER TABLE "new_InboxItem" RENAME TO "InboxItem";
CREATE TABLE "new_Observation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "time" TEXT,
    "type" TEXT NOT NULL,
    "severity" INTEGER,
    "durationMinutes" INTEGER,
    "notes" TEXT,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "personId" TEXT NOT NULL,
    "conditionId" TEXT,
    "createdById" TEXT,
    CONSTRAINT "Observation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Observation_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Observation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Observation" ("conditionId", "createdAt", "createdById", "date", "durationMinutes", "id", "notes", "personId", "severity", "tags", "time", "type", "updatedAt") SELECT "conditionId", "createdAt", "createdById", "date", "durationMinutes", "id", "notes", "personId", "severity", "tags", "time", "type", "updatedAt" FROM "Observation";
DROP TABLE "Observation";
ALTER TABLE "new_Observation" RENAME TO "Observation";
CREATE INDEX "Observation_personId_date_idx" ON "Observation"("personId", "date");
CREATE TABLE "new_ServiceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "vendor" TEXT,
    "cost" REAL,
    "category" TEXT,
    "mileageAtService" INTEGER,
    "providerId" TEXT,
    "conditionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "roomId" TEXT,
    CONSTRAINT "ServiceRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceRecord_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceRecord_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ServiceRecord" ("assetId", "assetType", "category", "conditionId", "cost", "createdAt", "createdById", "date", "description", "id", "mileageAtService", "providerId", "roomId", "title", "updatedAt", "vendor") SELECT "assetId", "assetType", "category", "conditionId", "cost", "createdAt", "createdById", "date", "description", "id", "mileageAtService", "providerId", "roomId", "title", "updatedAt", "vendor" FROM "ServiceRecord";
DROP TABLE "ServiceRecord";
ALTER TABLE "new_ServiceRecord" RENAME TO "ServiceRecord";
CREATE INDEX "ServiceRecord_roomId_idx" ON "ServiceRecord"("roomId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
