-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FeatureSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "healthEnabled" BOOLEAN NOT NULL DEFAULT true,
    "roomsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "equipmentTabEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FeatureSettings" ("healthEnabled", "id", "roomsEnabled", "updatedAt") SELECT "healthEnabled", "id", "roomsEnabled", "updatedAt" FROM "FeatureSettings";
DROP TABLE "FeatureSettings";
ALTER TABLE "new_FeatureSettings" RENAME TO "FeatureSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
