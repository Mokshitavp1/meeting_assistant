# Workspace API Documentation

This document describes the workspace management endpoints for the AI Meeting Assistant API.

## Authentication

All workspace endpoints require authentication. Include the JWT access token in the Authorization header:

```
Authorization: Bearer <access_token>
```

## Endpoints

### 1. List Workspaces

Get all workspaces for the current user.

**Endpoint:** `GET /api/v1/workspaces`
**Access:** Private (Authenticated users)

**Response:**
```json
{
  "success": true,
  "data": {
    "workspaces": [
      {
        "id": "workspace_id",
        "name": "My Workspace",
        "description": "Workspace description",
        "inviteCode": "abc123...",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z",
        "members": [
          {
            "id": "member_id",
            "role": "admin",
            "user": {
              "id": "user_id",
              "name": "John Doe",
              "email": "john@example.com"
            },
            "joinedAt": "2024-01-01T00:00:00.000Z"
          }
        ],
        "_count": {
          "members": 5
        }
      }
    ],
    "count": 1
  }
}
```

---

### 2. Create Workspace

Create a new workspace. The creator automatically becomes an admin.

**Endpoint:** `POST /api/v1/workspaces`
**Access:** Private (Authenticated users)

**Request Body:**
```json
{
  "name": "My New Workspace",
  "description": "Optional description"
}
```

**Validation:**
- `name`: Required, 2-100 characters
- `description`: Optional, max 500 characters

**Response:**
```json
{
  "success": true,
  "message": "Workspace created successfully",
  "data": {
    "workspace": {
      "id": "workspace_id",
      "name": "My New Workspace",
      "description": "Optional description",
      "inviteCode": "generated_code",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "members": [...]
    }
  }
}
```

---

### 3. Get Workspace Details

Get detailed information about a specific workspace.

**Endpoint:** `GET /api/v1/workspaces/:id`
**Access:** Private (Workspace members only)

**Response:**
```json
{
  "success": true,
  "data": {
    "workspace": {
      "id": "workspace_id",
      "name": "My Workspace",
      "description": "Description",
      "inviteCode": "invite_code",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "members": [...],
      "_count": {
        "members": 5
      }
    }
  }
}
```

---

### 4. Update Workspace

Update workspace details. Only admins can update workspaces.

**Endpoint:** `PUT /api/v1/workspaces/:id`
**Access:** Private (Admin only)

**Request Body:**
```json
{
  "name": "Updated Workspace Name",
  "description": "Updated description"
}
```

**Validation:**
- `name`: Optional, 2-100 characters
- `description`: Optional, max 500 characters

**Response:**
```json
{
  "success": true,
  "message": "Workspace updated successfully",
  "data": {
    "workspace": {...}
  }
}
```

**Errors:**
- `401`: Not authenticated
- `403`: Not a workspace admin
- `404`: Workspace not found

---

### 5. Delete Workspace

Delete a workspace. Only admins can delete workspaces.

**Endpoint:** `DELETE /api/v1/workspaces/:id`
**Access:** Private (Admin only)

**Response:**
```json
{
  "success": true,
  "message": "Workspace deleted successfully"
}
```

**Errors:**
- `401`: Not authenticated
- `403`: Not a workspace admin
- `404`: Workspace not found

---

### 6. Generate Invite Code

Generate a new unique invite code for the workspace. Invalidates the previous code.

**Endpoint:** `POST /api/v1/workspaces/:id/invite-code`
**Access:** Private (Admin only)

**Response:**
```json
{
  "success": true,
  "message": "Invite code generated successfully",
  "data": {
    "inviteCode": "new_invite_code",
    "workspaceId": "workspace_id",
    "workspaceName": "Workspace Name"
  }
}
```

**Errors:**
- `401`: Not authenticated
- `403`: Not a workspace admin
- `404`: Workspace not found

---

### 7. Join Workspace

Join a workspace using an invite code.

**Endpoint:** `POST /api/v1/workspaces/join`
**Access:** Private (Authenticated users)

**Request Body:**
```json
{
  "inviteCode": "invite_code_here"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully joined workspace",
  "data": {
    "workspace": {...}
  }
}
```

**Errors:**
- `401`: Not authenticated
- `404`: Invalid invite code
- `409`: Already a member of this workspace

---

### 8. List Members

Get all members of a workspace.

**Endpoint:** `GET /api/v1/workspaces/:id/members`
**Access:** Private (Workspace members only)

**Response:**
```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": "member_id",
        "role": "admin",
        "user": {
          "id": "user_id",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "joinedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 5
  }
}
```

---

### 9. Add Member

Add a new member to the workspace by user ID.

**Endpoint:** `POST /api/v1/workspaces/:id/members`
**Access:** Private (Admin only)

**Request Body:**
```json
{
  "userId": "user_id_to_add",
  "role": "member"
}
```

**Validation:**
- `userId`: Required
- `role`: Optional, must be "admin" or "member" (default: "member")

**Response:**
```json
{
  "success": true,
  "message": "Member added successfully",
  "data": {
    "member": {
      "id": "member_id",
      "role": "member",
      "user": {
        "id": "user_id",
        "name": "Jane Doe",
        "email": "jane@example.com"
      },
      "joinedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**Errors:**
- `401`: Not authenticated
- `403`: Not a workspace admin
- `404`: User or workspace not found
- `409`: User is already a member

---

### 10. Update Member Role

Update a member's role (admin or member).

**Endpoint:** `PUT /api/v1/workspaces/:id/members/:memberId`
**Access:** Private (Admin only)

**Request Body:**
```json
{
  "role": "admin"
}
```

**Validation:**
- `role`: Required, must be "admin" or "member"

**Response:**
```json
{
  "success": true,
  "message": "Member role updated successfully",
  "data": {
    "member": {...}
  }
}
```

**Errors:**
- `401`: Not authenticated
- `403`: Not a workspace admin
- `404`: Member not found
- `400`: Cannot remove the last admin (when demoting the only admin)

---

### 11. Remove Member

Remove a member from the workspace.

**Endpoint:** `DELETE /api/v1/workspaces/:id/members/:memberId`
**Access:** Private (Admin only)

**Response:**
```json
{
  "success": true,
  "message": "Member removed successfully"
}
```

**Errors:**
- `401`: Not authenticated
- `403`: Not a workspace admin
- `404`: Member not found
- `400`: Cannot remove the last admin

---

## Roles and Permissions

### Admin
- Create/update/delete workspace
- Generate invite codes
- Add/remove members
- Update member roles
- All member permissions

### Member
- View workspace details
- View members list
- Leave workspace (use remove member on self)

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error Type",
  "message": "Detailed error message",
  "code": "ERROR_CODE"
}
```

**Common Error Codes:**
- `401`: Unauthorized (not authenticated)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource doesn't exist)
- `409`: Conflict (duplicate entry)
- `400`: Bad Request (validation error)

---

## Usage Examples

### Create and Invite Flow

1. User creates workspace:
```bash
POST /api/v1/workspaces
{
  "name": "Product Team"
}
```

2. Admin generates/shares invite code:
```bash
POST /api/v1/workspaces/{id}/invite-code
```

3. Other users join with code:
```bash
POST /api/v1/workspaces/join
{
  "inviteCode": "abc123..."
}
```

### Permission Management

1. List all members:
```bash
GET /api/v1/workspaces/{id}/members
```

2. Promote member to admin:
```bash
PUT /api/v1/workspaces/{id}/members/{memberId}
{
  "role": "admin"
}
```

3. Remove member:
```bash
DELETE /api/v1/workspaces/{id}/members/{memberId}
```
