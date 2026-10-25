-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "pushedAt" DATETIME;

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "intervalMinutes" INTEGER,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushType" TEXT,
    "pushUrlEnc" TEXT,
    "pushTokenEnc" TEXT,
    "pushChatId" TEXT,
    "pushLastError" TEXT,
    "pushLastOkAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- Notifications that already exist were never meant for push. Without this,
-- turning push on would send the whole history in one message.
UPDATE "Notification" SET "pushedAt" = "createdAt";
