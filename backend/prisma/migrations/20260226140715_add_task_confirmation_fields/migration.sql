-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "calendarEventId" TEXT,
ADD COLUMN     "isConfirmed" BOOLEAN NOT NULL DEFAULT false;
