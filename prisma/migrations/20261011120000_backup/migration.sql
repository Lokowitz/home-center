-- CreateTable
CREATE TABLE "BackupSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "schedule" TEXT NOT NULL DEFAULT 'OFF',
    "time" TEXT NOT NULL DEFAULT '03:00',
    "weekday" INTEGER NOT NULL DEFAULT 0,
    "folder" TEXT,
    "keep" INTEGER NOT NULL DEFAULT 14,
    "protection" TEXT NOT NULL DEFAULT 'NONE',
    "publicKey" TEXT,
    "keyFingerprint" TEXT,
    "passphraseEnc" TEXT,
    "enabledAt" DATETIME,
    "hintDismissedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "file" TEXT,
    "size" INTEGER,
    "protection" TEXT NOT NULL DEFAULT 'NONE',
    "progressDone" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdById" TEXT
);

-- CreateIndex
CREATE INDEX "BackupRun_kind_startedAt_idx" ON "BackupRun"("kind", "startedAt");

