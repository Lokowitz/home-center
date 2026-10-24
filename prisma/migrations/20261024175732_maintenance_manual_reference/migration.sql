-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "estimatedCost" REAL,
    "dueMonths" TEXT,
    "dueDay" INTEGER,
    "referenceAttachmentId" TEXT,
    "referencePage" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "roomId" TEXT,
    CONSTRAINT "MaintenanceSchedule_referenceAttachmentId_fkey" FOREIGN KEY ("referenceAttachmentId") REFERENCES "Attachment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MaintenanceSchedule" ("assetId", "assetType", "createdAt", "description", "dueDay", "dueMonths", "estimatedCost", "id", "intervalDays", "intervalMiles", "isActive", "lastCompletedDate", "lastCompletedMileage", "nextDueDate", "nextDueMileage", "reminderDaysBefore", "reminderMilesBefore", "roomId", "snoozedUntil", "title", "updatedAt") SELECT "assetId", "assetType", "createdAt", "description", "dueDay", "dueMonths", "estimatedCost", "id", "intervalDays", "intervalMiles", "isActive", "lastCompletedDate", "lastCompletedMileage", "nextDueDate", "nextDueMileage", "reminderDaysBefore", "reminderMilesBefore", "roomId", "snoozedUntil", "title", "updatedAt" FROM "MaintenanceSchedule";
DROP TABLE "MaintenanceSchedule";
ALTER TABLE "new_MaintenanceSchedule" RENAME TO "MaintenanceSchedule";
CREATE INDEX "MaintenanceSchedule_roomId_idx" ON "MaintenanceSchedule"("roomId");
CREATE INDEX "MaintenanceSchedule_referenceAttachmentId_idx" ON "MaintenanceSchedule"("referenceAttachmentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
