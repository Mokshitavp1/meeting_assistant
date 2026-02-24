CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tasks (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	title VARCHAR(255) NOT NULL,
	description TEXT,

	meeting_id UUID,
	assigned_to_id UUID,

	status VARCHAR(32) NOT NULL DEFAULT 'pending',
	priority VARCHAR(16) NOT NULL DEFAULT 'medium',
	due_date TIMESTAMP,

	created_at TIMESTAMP NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
	completed_at TIMESTAMP,

	CONSTRAINT chk_tasks_status
		CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT chk_tasks_priority
		CHECK (priority IN ('low', 'medium', 'high')),
	CONSTRAINT chk_tasks_completed_at
		CHECK (
			completed_at IS NULL
			OR status IN ('completed', 'cancelled')
		),

	CONSTRAINT fk_tasks_meeting
		FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
	CONSTRAINT fk_tasks_assigned_to
		FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_meeting_id ON tasks(meeting_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_id ON tasks(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due_date ON tasks(status, due_date);

CREATE TABLE IF NOT EXISTS task_comments (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	task_id UUID NOT NULL,
	user_id UUID NOT NULL,
	content TEXT NOT NULL,

	created_at TIMESTAMP NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

	CONSTRAINT chk_task_comments_content_non_empty
		CHECK (length(trim(content)) > 0),

	CONSTRAINT fk_task_comments_task
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
	CONSTRAINT fk_task_comments_user
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at);

CREATE TABLE IF NOT EXISTS reminders (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	task_id UUID NOT NULL,
	user_id UUID NOT NULL,
	reminder_type VARCHAR(16) NOT NULL,
	due_date_snapshot TIMESTAMP,
	scheduled_for TIMESTAMP,
	sent_at TIMESTAMP,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	error_message TEXT,

	created_at TIMESTAMP NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

	CONSTRAINT chk_reminders_type
		CHECK (reminder_type IN ('24h', '1h', 'overdue')),
	CONSTRAINT chk_reminders_status
		CHECK (status IN ('pending', 'sent', 'failed')),
	CONSTRAINT chk_reminders_attempts_non_negative
		CHECK (attempts >= 0),

	CONSTRAINT fk_reminders_task
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
	CONSTRAINT fk_reminders_user
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT uq_reminders_task_user_type_due
		UNIQUE (task_id, user_id, reminder_type, due_date_snapshot)
);

CREATE INDEX IF NOT EXISTS idx_reminders_task_id ON reminders(task_id);
CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_scheduled_for ON reminders(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_reminders_sent_at ON reminders(sent_at);
