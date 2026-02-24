CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS meetings (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	title VARCHAR(255) NOT NULL,
	description TEXT,

	workspace_id UUID,
	scheduled_start_time TIMESTAMP NOT NULL,
	scheduled_end_time TIMESTAMP,
	actual_start_time TIMESTAMP,
	actual_end_time TIMESTAMP,
	duration INTEGER,

	status VARCHAR(32) NOT NULL DEFAULT 'scheduled',

	recording_url TEXT,
	recording_path TEXT,
	transcript_url TEXT,
	transcript_path TEXT,

	summary TEXT,
	minutes_of_meeting TEXT,

	created_by_id UUID NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

	CONSTRAINT chk_meetings_status
		CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT chk_meetings_duration_non_negative
		CHECK (duration IS NULL OR duration >= 0),
	CONSTRAINT chk_meetings_scheduled_window
		CHECK (scheduled_end_time IS NULL OR scheduled_end_time >= scheduled_start_time),
	CONSTRAINT chk_meetings_actual_window
		CHECK (
			actual_end_time IS NULL
			OR actual_start_time IS NULL
			OR actual_end_time >= actual_start_time
		),

	CONSTRAINT fk_meetings_workspace
		FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
	CONSTRAINT fk_meetings_created_by
		FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meetings_workspace_id ON meetings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meetings_created_by_id ON meetings(created_by_id);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_start_time ON meetings(scheduled_start_time);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);

CREATE TABLE IF NOT EXISTS meeting_participants (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	meeting_id UUID NOT NULL,
	user_id UUID NOT NULL,
	role VARCHAR(32) NOT NULL DEFAULT 'participant',
	attended BOOLEAN NOT NULL DEFAULT FALSE,
	joined_at TIMESTAMP,
	left_at TIMESTAMP,

	CONSTRAINT chk_meeting_participants_role
		CHECK (role IN ('organizer', 'participant')),
	CONSTRAINT chk_meeting_participants_attendance_window
		CHECK (
			left_at IS NULL
			OR joined_at IS NULL
			OR left_at >= joined_at
		),

	CONSTRAINT uq_meeting_participants_meeting_user UNIQUE (meeting_id, user_id),
	CONSTRAINT fk_meeting_participants_meeting
		FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
	CONSTRAINT fk_meeting_participants_user
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting_id ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user_id ON meeting_participants(user_id);

CREATE TABLE IF NOT EXISTS meeting_minutes (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	meeting_id UUID NOT NULL,
	summary TEXT,
	minutes_of_meeting TEXT,
	generated_by VARCHAR(16) NOT NULL DEFAULT 'ai',
	created_at TIMESTAMP NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

	CONSTRAINT chk_meeting_minutes_generated_by
		CHECK (generated_by IN ('ai', 'manual')),
	CONSTRAINT uq_meeting_minutes_meeting_id UNIQUE (meeting_id),
	CONSTRAINT fk_meeting_minutes_meeting
		FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_minutes_meeting_id ON meeting_minutes(meeting_id);
