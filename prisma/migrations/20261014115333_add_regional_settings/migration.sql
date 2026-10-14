-- CreateTable
CREATE TABLE "RegionalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "distanceUnit" TEXT NOT NULL DEFAULT 'MILES',
    "areaUnit" TEXT NOT NULL DEFAULT 'SQFT',
    "dateFormat" TEXT NOT NULL DEFAULT 'MDY_SHORT',
    "hour12" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
