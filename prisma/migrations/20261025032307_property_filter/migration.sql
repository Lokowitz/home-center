-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FeatureSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "healthEnabled" BOOLEAN NOT NULL DEFAULT true,
    "roomsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "equipmentTabEnabled" BOOLEAN NOT NULL DEFAULT true,
    "propertyFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FeatureSettings" ("equipmentTabEnabled", "healthEnabled", "id", "roomsEnabled", "updatedAt") SELECT "equipmentTabEnabled", "healthEnabled", "id", "roomsEnabled", "updatedAt" FROM "FeatureSettings";
DROP TABLE "FeatureSettings";
ALTER TABLE "new_FeatureSettings" RENAME TO "FeatureSettings";
CREATE TABLE "new_Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'OTHER',
    "dateOfBirth" DATETIME,
    "sex" TEXT,
    "bloodType" TEXT,
    "notes" TEXT,
    "imageFilename" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "primaryProviderId" TEXT,
    "propertyId" TEXT,
    CONSTRAINT "Person_primaryProviderId_fkey" FOREIGN KEY ("primaryProviderId") REFERENCES "Provider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Person_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Person" ("bloodType", "createdAt", "dateOfBirth", "id", "imageFilename", "name", "notes", "primaryProviderId", "relationship", "sex", "updatedAt") SELECT "bloodType", "createdAt", "dateOfBirth", "id", "imageFilename", "name", "notes", "primaryProviderId", "relationship", "sex", "updatedAt" FROM "Person";
DROP TABLE "Person";
ALTER TABLE "new_Person" RENAME TO "Person";
CREATE INDEX "Person_propertyId_idx" ON "Person"("propertyId");
CREATE TABLE "new_Vehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "vin" TEXT,
    "color" TEXT,
    "purchaseDate" DATETIME,
    "purchasePrice" REAL,
    "currentMileage" INTEGER,
    "meterUnit" TEXT NOT NULL DEFAULT 'MILES',
    "notes" TEXT,
    "imageFilename" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "propertyId" TEXT,
    CONSTRAINT "Vehicle_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Vehicle" ("color", "createdAt", "currentMileage", "id", "imageFilename", "make", "meterUnit", "model", "name", "notes", "purchaseDate", "purchasePrice", "updatedAt", "vin", "year") SELECT "color", "createdAt", "currentMileage", "id", "imageFilename", "make", "meterUnit", "model", "name", "notes", "purchaseDate", "purchasePrice", "updatedAt", "vin", "year" FROM "Vehicle";
DROP TABLE "Vehicle";
ALTER TABLE "new_Vehicle" RENAME TO "Vehicle";
CREATE INDEX "Vehicle_propertyId_idx" ON "Vehicle"("propertyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
