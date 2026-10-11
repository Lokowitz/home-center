-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "assetId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "assetType" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_assetType_assetId_idx" ON "Attachment"("assetType", "assetId");
