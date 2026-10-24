-- AlterTable
ALTER TABLE "MaintenanceSchedule" ADD COLUMN "dueDay" INTEGER;
ALTER TABLE "MaintenanceSchedule" ADD COLUMN "dueMonths" TEXT;
ALTER TABLE "MaintenanceSchedule" ADD COLUMN "estimatedCost" REAL;

-- Reminders without an interval used to keep their due value after being
-- completed, so they stayed overdue. Clear the ones already done.
UPDATE "MaintenanceSchedule" SET "nextDueDate" = NULL
WHERE "intervalDays" IS NULL AND "intervalMiles" IS NULL
  AND "lastCompletedDate" IS NOT NULL AND "nextDueDate" IS NOT NULL
  AND "lastCompletedDate" >= "nextDueDate";
UPDATE "MaintenanceSchedule" SET "nextDueMileage" = NULL
WHERE "intervalDays" IS NULL AND "intervalMiles" IS NULL
  AND "lastCompletedMileage" IS NOT NULL AND "nextDueMileage" IS NOT NULL
  AND "lastCompletedMileage" >= "nextDueMileage";
