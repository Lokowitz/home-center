-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT,
    "area" REAL,
    "dimensions" TEXT,
    "flooringType" TEXT,
    "flooringProduct" TEXT,
    "flooringInstalled" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Room_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoomPaint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "brand" TEXT,
    "colorName" TEXT,
    "colorCode" TEXT,
    "finish" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RoomPaint_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "roomId" TEXT,
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
    CONSTRAINT "Attachment_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "InboxItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("allergyId", "assetId", "assetType", "filename", "healthConditionId", "id", "immunizationId", "inboxItemId", "insurancePolicyId", "maintenanceScheduleId", "medicationId", "mimeType", "observationId", "originalName", "recordType", "serviceRecordId", "sizeBytes", "uploadedAt", "uploadedById", "warrantyId") SELECT "allergyId", "assetId", "assetType", "filename", "healthConditionId", "id", "immunizationId", "inboxItemId", "insurancePolicyId", "maintenanceScheduleId", "medicationId", "mimeType", "observationId", "originalName", "recordType", "serviceRecordId", "sizeBytes", "uploadedAt", "uploadedById", "warrantyId" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
CREATE INDEX "Attachment_roomId_idx" ON "Attachment"("roomId");
CREATE INDEX "Attachment_assetType_assetId_idx" ON "Attachment"("assetType", "assetId");
CREATE INDEX "Attachment_inboxItemId_idx" ON "Attachment"("inboxItemId");
CREATE TABLE "new_Equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'APPLIANCE',
    "manufacturer" TEXT,
    "modelNumber" TEXT,
    "serialNumber" TEXT,
    "location" TEXT,
    "purchaseDate" DATETIME,
    "purchasePrice" REAL,
    "installDate" DATETIME,
    "notes" TEXT,
    "imageFilename" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "propertyId" TEXT,
    "roomId" TEXT,
    CONSTRAINT "Equipment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Equipment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Equipment" ("category", "createdAt", "id", "imageFilename", "installDate", "location", "manufacturer", "modelNumber", "name", "notes", "propertyId", "purchaseDate", "purchasePrice", "serialNumber", "updatedAt") SELECT "category", "createdAt", "id", "imageFilename", "installDate", "location", "manufacturer", "modelNumber", "name", "notes", "propertyId", "purchaseDate", "purchasePrice", "serialNumber", "updatedAt" FROM "Equipment";
DROP TABLE "Equipment";
ALTER TABLE "new_Equipment" RENAME TO "Equipment";
CREATE INDEX "Equipment_roomId_idx" ON "Equipment"("roomId");
CREATE TABLE "new_FeatureSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "healthEnabled" BOOLEAN NOT NULL DEFAULT true,
    "roomsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FeatureSettings" ("healthEnabled", "id", "updatedAt") SELECT "healthEnabled", "id", "updatedAt" FROM "FeatureSettings";
DROP TABLE "FeatureSettings";
ALTER TABLE "new_FeatureSettings" RENAME TO "FeatureSettings";
CREATE TABLE "new_MaintenanceSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "intervalDays" INTEGER,
    "intervalMiles" INTEGER,
    "lastCompletedDate" DATETIME,
    "lastCompletedMileage" INTEGER,
    "nextDueDate" DATETIME,
    "nextDueMileage" INTEGER,
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 14,
    "reminderMilesBefore" INTEGER NOT NULL DEFAULT 500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "snoozedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "roomId" TEXT,
    CONSTRAINT "MaintenanceSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MaintenanceSchedule" ("assetId", "assetType", "createdAt", "description", "id", "intervalDays", "intervalMiles", "isActive", "lastCompletedDate", "lastCompletedMileage", "nextDueDate", "nextDueMileage", "reminderDaysBefore", "reminderMilesBefore", "snoozedUntil", "title", "updatedAt") SELECT "assetId", "assetType", "createdAt", "description", "id", "intervalDays", "intervalMiles", "isActive", "lastCompletedDate", "lastCompletedMileage", "nextDueDate", "nextDueMileage", "reminderDaysBefore", "reminderMilesBefore", "snoozedUntil", "title", "updatedAt" FROM "MaintenanceSchedule";
DROP TABLE "MaintenanceSchedule";
ALTER TABLE "new_MaintenanceSchedule" RENAME TO "MaintenanceSchedule";
CREATE INDEX "MaintenanceSchedule_roomId_idx" ON "MaintenanceSchedule"("roomId");
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
    "createdById" TEXT NOT NULL,
    "roomId" TEXT,
    CONSTRAINT "ServiceRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceRecord_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceRecord_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ServiceRecord" ("assetId", "assetType", "category", "conditionId", "cost", "createdAt", "createdById", "date", "description", "id", "mileageAtService", "providerId", "title", "updatedAt", "vendor") SELECT "assetId", "assetType", "category", "conditionId", "cost", "createdAt", "createdById", "date", "description", "id", "mileageAtService", "providerId", "title", "updatedAt", "vendor" FROM "ServiceRecord";
DROP TABLE "ServiceRecord";
ALTER TABLE "new_ServiceRecord" RENAME TO "ServiceRecord";
CREATE INDEX "ServiceRecord_roomId_idx" ON "ServiceRecord"("roomId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Room_propertyId_idx" ON "Room"("propertyId");

-- CreateIndex
CREATE INDEX "RoomPaint_roomId_idx" ON "RoomPaint"("roomId");
