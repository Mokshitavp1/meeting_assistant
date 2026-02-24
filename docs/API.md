# AI Meeting Assistant API

## Base URL and Versioning

- **Base URL (local):** `http://localhost:3000`
- **API prefix:** `/api`
- **Current version:** `v1`
- **Versioned base path:** `/api/v1`

### Version endpoints

- `GET /api` → redirects to latest version (`/api/v1`)
- `GET /api/versions` → returns available versions
- `GET /api/v1` → returns API metadata and endpoint map

---

## Authentication

Protected endpoints require a JWT **access token** in the `Authorization` header.

```http
Authorization: Bearer <access_token>
```

### How to get tokens

1. Register or login via auth endpoints.
2. Use `accessToken` for protected routes.
3. Use `refreshToken` with `POST /api/v1/auth/refresh` when access token expires.

---

## Common Response Format

### Success

```json
{
	"success": true,
	"message": "Optional message",
	"data": {}
}
```

### Error

```json
{
	"success": false,
	"error": "ErrorName",
	"message": "Human readable message",
	"code": "ERROR_CODE",
	"details": {},
	"timestamp": "2026-02-24T00:00:00.000Z"
}
```

---

## Rate Limiting

Rate limiting is enabled when `RATE_LIMIT_ENABLED=true`.

- **Global limiter:**
	- Window: `RATE_LIMIT_WINDOW_MINUTES` (default 15 minutes)
	- Max requests: `RATE_LIMIT_MAX_REQUESTS` (default 100)
- **Auth limiter** (`/api/v1/auth/*`):
	- Window: `LOGIN_RATE_LIMIT_WINDOW_MINUTES` (default 15 minutes)
	- Max requests: `LOGIN_RATE_LIMIT_MAX` (default 5)

429 response example:

```json
{
	"error": "Too many authentication attempts, please try again later"
}
```

---

## Pagination Format

Used by list endpoints that support pagination (e.g., `GET /api/v1/meetings`).

### Request query params

- `page` (string/integer, default `1`)
- `limit` (string/integer, default `20`)

### Response format

```json
{
	"success": true,
	"data": {
		"items": [],
		"pagination": {
			"page": 1,
			"limit": 20,
			"total": 42,
			"pages": 3
		}
	}
}
```

---

## Auth Endpoints

### 1) Register

- **Method/Path:** `POST /api/v1/auth/register`
- **Description:** Register a new user account.
- **Auth:** Public

**Request body**

```json
{
	"email": "user@example.com",
	"name": "John Doe",
	"password": "StrongPass123",
	"confirmPassword": "StrongPass123"
}
```

**Response example**

```json
{
	"success": true,
	"message": "User registered successfully. Please verify your email.",
	"data": {
		"user": {
			"id": "user_id",
			"email": "user@example.com",
			"name": "John Doe",
			"role": "user",
			"isEmailVerified": false,
			"createdAt": "2026-02-24T10:00:00.000Z",
			"lastLoginAt": null
		},
		"accessToken": "jwt_access_token",
		"refreshToken": "jwt_refresh_token"
	}
}
```

**Error responses**

- `400` validation error
- `409` duplicate email

---

### 2) Login

- **Method/Path:** `POST /api/v1/auth/login`
- **Description:** Authenticate user and return token pair.
- **Auth:** Public

**Request body**

```json
{
	"email": "user@example.com",
	"password": "StrongPass123"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Login successful",
	"data": {
		"user": {
			"id": "user_id",
			"email": "user@example.com",
			"name": "John Doe",
			"role": "user",
			"isEmailVerified": true,
			"createdAt": "2026-02-24T10:00:00.000Z",
			"lastLoginAt": "2026-02-24T11:00:00.000Z"
		},
		"accessToken": "jwt_access_token",
		"refreshToken": "jwt_refresh_token"
	}
}
```

**Error responses**

- `400` validation error
- `401` invalid credentials / disabled account

---

### 3) Logout

- **Method/Path:** `POST /api/v1/auth/logout`
- **Description:** Blacklist current access token and optionally revoke refresh token.
- **Auth:** Private

**Request body**

```json
{
	"refreshToken": "optional_refresh_token"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Logout successful"
}
```

**Error responses**

- `401` unauthorized

---

### 4) Refresh Token

- **Method/Path:** `POST /api/v1/auth/refresh`
- **Description:** Rotate refresh token and issue new access/refresh token pair.
- **Auth:** Public

**Request body**

```json
{
	"refreshToken": "jwt_refresh_token"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Access token refreshed successfully",
	"data": {
		"accessToken": "new_access_token",
		"refreshToken": "new_refresh_token"
	}
}
```

**Error responses**

- `400` invalid request
- `401` invalid/revoked/expired token

---

### 5) Forgot Password

- **Method/Path:** `POST /api/v1/auth/forgot-password`
- **Description:** Generate password reset token (response is generic to prevent email enumeration).
- **Auth:** Public

**Request body**

```json
{
	"email": "user@example.com"
}
```

**Response example**

```json
{
	"success": true,
	"message": "If an account exists with this email, a password reset link has been sent"
}
```

**Error responses**

- `400` validation error

---

### 6) Reset Password

- **Method/Path:** `POST /api/v1/auth/reset-password`
- **Description:** Reset user password with valid reset token.
- **Auth:** Public

**Request body**

```json
{
	"token": "reset_token",
	"password": "NewStrongPass123",
	"confirmPassword": "NewStrongPass123"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Password reset successful. Please login with your new password."
}
```

**Error responses**

- `400` invalid/expired token or validation error

---

### 7) Verify Email

- **Method/Path:** `POST /api/v1/auth/verify-email`
- **Description:** Verify user email using verification token.
- **Auth:** Public

**Request body**

```json
{
	"token": "verification_token"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Email verified successfully",
	"data": {
		"user": {
			"id": "user_id",
			"email": "user@example.com",
			"name": "John Doe",
			"role": "user",
			"isEmailVerified": true,
			"createdAt": "2026-02-24T10:00:00.000Z",
			"lastLoginAt": null
		}
	}
}
```

**Error responses**

- `400` invalid/expired token

---

### 8) Resend Verification (placeholder implementation)

- **Method/Path:** `POST /api/v1/auth/resend-verification`
- **Description:** Placeholder endpoint, currently returns static success.
- **Auth:** Public

**Request body**

```json
{}
```

**Response example**

```json
{
	"success": true,
	"message": "Verification email sent"
}
```

---

### 9) Get Current User (placeholder implementation)

- **Method/Path:** `GET /api/v1/auth/me`
- **Description:** Placeholder endpoint, currently returns empty user payload.
- **Auth:** Private (intended)

**Request example**

```json
{}
```

**Response example**

```json
{
	"success": true,
	"data": {}
}
```

---

### 10) Change Password (placeholder implementation)

- **Method/Path:** `PUT /api/v1/auth/change-password`
- **Description:** Placeholder endpoint, currently returns static success.
- **Auth:** Private (intended)

**Request body**

```json
{
	"currentPassword": "CurrentPass123",
	"newPassword": "NewStrongPass123"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Password changed successfully"
}
```

---

### 11) Google Auth (placeholder implementation)

- **Method/Path:** `POST /api/v1/auth/google`
- **Description:** Placeholder endpoint for OAuth login.
- **Auth:** Public

**Request body**

```json
{
	"providerToken": "google_oauth_token"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Google authentication successful",
	"data": {}
}
```

---

## Workspaces Endpoints

> All workspace endpoints require `Authorization: Bearer <access_token>`.

### 1) List Workspaces

- **Method/Path:** `GET /api/v1/workspaces`
- **Description:** Get all workspaces for current user.
- **Query params:** none

**Response example**

```json
{
	"success": true,
	"data": {
		"workspaces": [],
		"count": 0
	}
}
```

---

### 2) Create Workspace

- **Method/Path:** `POST /api/v1/workspaces`
- **Description:** Create new workspace.

**Request body**

```json
{
	"name": "Product Team",
	"description": "Workspace for product planning"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Workspace created successfully",
	"data": {
		"workspace": {
			"id": "workspace_id",
			"name": "Product Team",
			"description": "Workspace for product planning",
			"inviteCode": "ABC123"
		}
	}
}
```

---

### 3) Join Workspace

- **Method/Path:** `POST /api/v1/workspaces/join`
- **Description:** Join workspace using invite code.

**Request body**

```json
{
	"inviteCode": "ABC123"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Successfully joined workspace",
	"data": {
		"workspace": {
			"id": "workspace_id",
			"name": "Product Team"
		}
	}
}
```

---

### 4) Get Workspace by ID

- **Method/Path:** `GET /api/v1/workspaces/:id`
- **Description:** Get workspace details.
- **Path params:** `id` (workspace ID)

**Response example**

```json
{
	"success": true,
	"data": {
		"workspace": {
			"id": "workspace_id",
			"name": "Product Team",
			"members": []
		}
	}
}
```

**Errors:** `401`, `403`, `404`

---

### 5) Update Workspace

- **Method/Path:** `PUT /api/v1/workspaces/:id`
- **Description:** Update workspace (admin only).

**Request body**

```json
{
	"name": "Updated Workspace Name",
	"description": "Updated description"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Workspace updated successfully",
	"data": {
		"workspace": {
			"id": "workspace_id",
			"name": "Updated Workspace Name"
		}
	}
}
```

---

### 6) Delete Workspace

- **Method/Path:** `DELETE /api/v1/workspaces/:id`
- **Description:** Delete workspace (admin only).

**Response example**

```json
{
	"success": true,
	"message": "Workspace deleted successfully"
}
```

---

### 7) Regenerate Invite Code

- **Method/Path:** `POST /api/v1/workspaces/:id/invite-code`
- **Description:** Generate a new invite code (admin only).

**Response example**

```json
{
	"success": true,
	"message": "Invite code generated successfully",
	"data": {
		"inviteCode": "NEWCODE123",
		"workspaceId": "workspace_id",
		"workspaceName": "Product Team"
	}
}
```

---

### 8) List Members

- **Method/Path:** `GET /api/v1/workspaces/:id/members`
- **Description:** List workspace members.

**Response example**

```json
{
	"success": true,
	"data": {
		"members": [],
		"count": 0
	}
}
```

---

### 9) Add Member

- **Method/Path:** `POST /api/v1/workspaces/:id/members`
- **Description:** Add member to workspace (admin only).

**Request body**

```json
{
	"userId": "user_id",
	"role": "member"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Member added successfully",
	"data": {
		"member": {
			"id": "member_id",
			"role": "member"
		}
	}
}
```

---

### 10) Update Member Role

- **Method/Path:** `PUT /api/v1/workspaces/:id/members/:memberId`
- **Description:** Update member role (admin only).

**Request body**

```json
{
	"role": "admin"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Member role updated successfully",
	"data": {
		"member": {
			"id": "member_id",
			"role": "admin"
		}
	}
}
```

---

### 11) Remove Member

- **Method/Path:** `DELETE /api/v1/workspaces/:id/members/:memberId`
- **Description:** Remove member from workspace (admin only).

**Response example**

```json
{
	"success": true,
	"message": "Member removed successfully"
}
```

---

## Meetings Endpoints

> All meeting endpoints require `Authorization: Bearer <access_token>`.

### 1) List Meetings

- **Method/Path:** `GET /api/v1/meetings`
- **Description:** List meetings available to user.
- **Query params:**
	- `workspaceId` (optional)
	- `status` (`scheduled|in_progress|completed|cancelled`, optional)
	- `startDate` (ISO datetime, optional)
	- `endDate` (ISO datetime, optional)
	- `page` (default `1`)
	- `limit` (default `20`)

**Request example**

```json
{}
```

**Response example**

```json
{
	"success": true,
	"data": {
		"meetings": [],
		"pagination": {
			"page": 1,
			"limit": 20,
			"total": 0,
			"pages": 0
		}
	}
}
```

---

### 2) Create Meeting

- **Method/Path:** `POST /api/v1/meetings`
- **Description:** Create and schedule meeting.

**Request body**

```json
{
	"title": "Sprint Planning",
	"description": "Plan next sprint",
	"workspaceId": "workspace_id",
	"scheduledStartTime": "2026-02-24T10:00:00.000Z",
	"scheduledEndTime": "2026-02-24T11:00:00.000Z",
	"participantIds": ["user_1", "user_2"]
}
```

**Response example**

```json
{
	"success": true,
	"message": "Meeting created successfully",
	"data": {
		"meeting": {
			"id": "meeting_id",
			"title": "Sprint Planning",
			"status": "scheduled"
		}
	}
}
```

---

### 3) Get Meeting Details

- **Method/Path:** `GET /api/v1/meetings/:id`
- **Description:** Get one meeting with details.
- **Path params:** `id`

**Response example**

```json
{
	"success": true,
	"data": {
		"meeting": {
			"id": "meeting_id",
			"title": "Sprint Planning",
			"participants": [],
			"tasks": []
		}
	}
}
```

**Errors:** `401`, `403`, `404`

---

### 4) Update Meeting

- **Method/Path:** `PUT /api/v1/meetings/:id`
- **Description:** Update meeting fields.

**Request body**

```json
{
	"title": "Updated Meeting Title",
	"description": "Updated description",
	"status": "in_progress"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Meeting updated successfully",
	"data": {
		"meeting": {
			"id": "meeting_id",
			"title": "Updated Meeting Title"
		}
	}
}
```

---

### 5) Delete Meeting

- **Method/Path:** `DELETE /api/v1/meetings/:id`
- **Description:** Delete meeting and related assets.

**Response example**

```json
{
	"success": true,
	"message": "Meeting deleted successfully"
}
```

---

### 6) Start Meeting

- **Method/Path:** `POST /api/v1/meetings/:id/start`
- **Description:** Mark meeting as `in_progress`.

**Response example**

```json
{
	"success": true,
	"message": "Meeting started successfully",
	"data": {
		"meeting": {
			"id": "meeting_id",
			"status": "in_progress"
		}
	}
}
```

---

### 7) End Meeting

- **Method/Path:** `POST /api/v1/meetings/:id/end`
- **Description:** Mark meeting as `completed`.

**Response example**

```json
{
	"success": true,
	"message": "Meeting ended successfully",
	"data": {
		"meeting": {
			"id": "meeting_id",
			"status": "completed"
		},
		"duration": "45 minutes"
	}
}
```

---

### 8) Upload Recording

- **Method/Path:** `POST /api/v1/meetings/:id/recording`
- **Description:** Upload audio/video recording for meeting.
- **Content-Type:** `multipart/form-data`
- **Form field:** `recording` (file)

**Request example (multipart)**

```json
{
	"recording": "<binary file>"
}
```

**Response example**

```json
{
	"success": true,
	"message": "Recording uploaded successfully",
	"data": {
		"recordingUrl": "https://...",
		"filename": "meeting-123.wav",
		"size": 123456
	}
}
```

**Error responses**

- `400` no file uploaded / invalid file type
- `401` unauthorized
- `403` forbidden

---

### 9) Get Transcript

- **Method/Path:** `GET /api/v1/meetings/:id/transcript`
- **Description:** Return transcript URL if transcript exists.

**Response example**

```json
{
	"success": true,
	"data": {
		"meetingId": "meeting_id",
		"title": "Sprint Planning",
		"transcriptUrl": "https://..."
	}
}
```

**Error responses**

- `404` transcript not available

---

### 10) Trigger AI Processing

- **Method/Path:** `POST /api/v1/meetings/:id/process`
- **Description:** Trigger async AI processing pipeline.

**Response example**

```json
{
	"success": true,
	"message": "Meeting processing initiated. This may take a few minutes.",
	"data": {
		"meetingId": "meeting_id",
		"status": "processing",
		"estimatedTime": "2-5 minutes"
	}
}
```

---

## Tasks / Notifications / Integrations (Resource Groups)

These groups are referenced in the API root metadata but are **not currently mounted** in `src/routes/index.ts`.

- Planned base paths:
	- `/api/v1/tasks`
	- `/api/v1/notifications`
	- `/api/v1/transcriptions`
	- `/api/v1/integrations`
	- `/api/v1/search`
	- `/api/v1/analytics`
	- `/api/v1/settings`

If these route modules are enabled later, add full endpoint sections for each in this document.

---

## Common Error Responses

### 400 Bad Request (validation / malformed input)

```json
{
	"success": false,
	"error": "ValidationError",
	"message": "Request validation failed",
	"code": "VALIDATION_ERROR",
	"details": [
		{
			"field": "email",
			"message": "Invalid email address",
			"code": "invalid_string"
		}
	],
	"timestamp": "2026-02-24T00:00:00.000Z"
}
```

### 401 Unauthorized

```json
{
	"success": false,
	"error": "AuthenticationError",
	"message": "Authentication failed",
	"code": "AUTHENTICATION_ERROR",
	"timestamp": "2026-02-24T00:00:00.000Z"
}
```

### 403 Forbidden

```json
{
	"success": false,
	"error": "AuthorizationError",
	"message": "Access forbidden",
	"code": "AUTHORIZATION_ERROR",
	"timestamp": "2026-02-24T00:00:00.000Z"
}
```

### 404 Not Found

```json
{
	"success": false,
	"error": "NotFoundError",
	"message": "Resource not found",
	"code": "NOT_FOUND",
	"timestamp": "2026-02-24T00:00:00.000Z"
}
```

### 409 Conflict

```json
{
	"success": false,
	"error": "ConflictError",
	"message": "Resource already exists",
	"code": "CONFLICT_ERROR",
	"timestamp": "2026-02-24T00:00:00.000Z"
}
```

---

## Notes

- Date/time fields use ISO-8601 timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- Most protected endpoints require workspace membership/meeting access checks.
- Upload endpoint accepts files only; JSON shown above is structural representation.
