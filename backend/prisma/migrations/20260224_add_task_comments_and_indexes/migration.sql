-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_comments_taskId_idx" ON "task_comments"("taskId");

-- CreateIndex
CREATE INDEX "task_comments_userId_idx" ON "task_comments"("userId");

-- CreateIndex
CREATE INDEX "task_comments_taskId_createdAt_idx" ON "task_comments"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add missing indexes on tasks (if not already present)
CREATE INDEX IF NOT EXISTS "tasks_priority_idx" ON "tasks"("priority");
CREATE INDEX IF NOT EXISTS "tasks_dueDate_idx" ON "tasks"("dueDate");
CREATE INDEX IF NOT EXISTS "tasks_assignedToId_status_idx" ON "tasks"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "tasks_meetingId_status_idx" ON "tasks"("meetingId", "status");

-- Add missing indexes on meetings (if not already present)
CREATE INDEX IF NOT EXISTS "meetings_workspaceId_status_idx" ON "meetings"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "meetings_createdById_status_idx" ON "meetings"("createdById", "status");
