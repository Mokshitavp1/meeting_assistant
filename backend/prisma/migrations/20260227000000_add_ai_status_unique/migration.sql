-- Migration: add_ai_status_unique
-- 1. Add aiExtractionStatus tracking column to meetings
ALTER TABLE "meetings" ADD COLUMN "aiExtractionStatus" TEXT NOT NULL DEFAULT 'pending';

-- 2. Backfill existing meetings so the status-based guard works correctly:
--    • 'confirmed'  — meeting has at least one confirmed task  
--                     (and no unconfirmed ones left)
--    • 'extracted'  — meeting has unconfirmed (pending-review) tasks
--    • 'pending'    — no tasks yet (default, no update needed)
UPDATE "meetings"
SET "aiExtractionStatus" = CASE
    WHEN EXISTS (
        SELECT 1 FROM "tasks"
        WHERE "tasks"."meetingId" = "meetings"."id"
          AND "tasks"."isConfirmed" = false
    ) THEN 'extracted'
    WHEN EXISTS (
        SELECT 1 FROM "tasks"
        WHERE "tasks"."meetingId" = "meetings"."id"
          AND "tasks"."isConfirmed" = true
    ) THEN 'confirmed'
    ELSE 'pending'
END
WHERE "aiExtractionStatus" = 'pending';

-- 3. Add unique constraint on (meetingId, title) to the tasks table.
--    NOTE: PostgreSQL treats each NULL as distinct, so rows with a NULL
--    meetingId (manually-created tasks) are still allowed to share the
--    same title — only tasks within the same meeting are deduplicated.
CREATE UNIQUE INDEX "tasks_meetingId_title_key" ON "tasks"("meetingId", "title");
