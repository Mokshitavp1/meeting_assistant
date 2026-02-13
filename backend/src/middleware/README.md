# Middleware Directory

This directory contains all Express middleware functions for the AI Meeting Assistant application.

## Available Middleware

### 1. Authentication Middleware (`auth.middleware.ts`)

Handles JWT-based authentication and authorization.

**See full documentation in this file for detailed usage.**

### 2. Error Handling Middleware (`error.middleware.ts`)

Comprehensive error handling system with custom error classes.

**See [ERROR_HANDLING.md](./ERROR_HANDLING.md) for complete documentation.**

#### Quick Start

```typescript
import {
    asyncHandler,
    NotFoundError,
    ValidationError,
    AuthenticationError,
    ConflictError
} from '../middleware/error.middleware';

// Use asyncHandler to catch errors
router.get('/users/:id', asyncHandler(async (req, res) => {
    const user = await getUser(req.params.id);

    if (!user) {
        throw new NotFoundError('User', req.params.id);
    }

    res.json({ user });
}));

// Errors are automatically handled and logged
```

---

## Authentication Middleware Documentation

Handles JWT-based authentication and authorization.

#### Exported Functions

##### 1. `authenticate` - Required Authentication

Requires valid JWT token in Authorization header. Returns 401 if authentication fails.

```typescript
import { authenticate } from '../middleware/auth.middleware';

// Protect a route
router.get('/profile', authenticate, (req, res) => {
    // req.user is now available and typed
    res.json({ user: req.user });
});
```

**Behavior:**
- Extracts JWT from `Authorization` header (supports `Bearer <token>` or `<token>`)
- Verifies token signature and expiration
- Checks if token is blacklisted in Redis
- Fetches user from database
- Attaches user to `req.user`
- Returns 401 for any authentication failure

**Error Responses:**
```json
// No token
{ "error": "Unauthorized", "message": "No authentication token provided" }

// Expired token
{ "error": "Unauthorized", "message": "Token has expired", "code": "TOKEN_EXPIRED" }

// Invalid token
{ "error": "Unauthorized", "message": "Invalid token", "code": "INVALID_TOKEN" }

// Blacklisted token
{ "error": "Unauthorized", "message": "Token has been revoked" }

// User not found
{ "error": "Unauthorized", "message": "User not found" }
```

##### 2. `optionalAuth` - Optional Authentication

Attaches user to `req.user` if valid token is provided, but doesn't fail if no token or invalid token.

```typescript
import { optionalAuth } from '../middleware/auth.middleware';

// Route that works differently for authenticated users
router.get('/posts', optionalAuth, (req, res) => {
    if (req.user) {
        // Show personalized posts
    } else {
        // Show public posts
    }
});
```

**Behavior:**
- Same verification as `authenticate`
- Never returns error
- Continues without `req.user` if authentication fails

##### 3. `authorize` - Role-Based Authorization

Checks if authenticated user has required role. Must be used after `authenticate` middleware.

```typescript
import { authenticate, authorize } from '../middleware/auth.middleware';

// Only allow admin users
router.delete('/users/:id',
    authenticate,
    authorize('admin'),
    userController.delete
);

// Allow multiple roles
router.post('/meetings',
    authenticate,
    authorize('admin', 'moderator', 'user'),
    meetingController.create
);
```

**Error Responses:**
```json
// Not authenticated
{ "error": "Unauthorized", "message": "Authentication required" }

// No role assigned
{ "error": "Forbidden", "message": "User has no role assigned" }

// Insufficient permissions
{ "error": "Forbidden", "message": "Insufficient permissions" }
```

#### Helper Functions

##### `generateAccessToken`
```typescript
import { generateAccessToken } from '../middleware/auth.middleware';

const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email
});
```

##### `generateRefreshToken`
```typescript
import { generateRefreshToken } from '../middleware/auth.middleware';

const refreshToken = generateRefreshToken({
    userId: user.id,
    email: user.email
});
```

##### `verifyRefreshToken`
```typescript
import { verifyRefreshToken } from '../middleware/auth.middleware';

try {
    const payload = verifyRefreshToken(token);
    // payload.userId, payload.email
} catch (error) {
    // Handle REFRESH_TOKEN_EXPIRED, INVALID_REFRESH_TOKEN
}
```

##### `blacklistToken`
```typescript
import { blacklistToken } from '../middleware/auth.middleware';

// Logout - blacklist access token
await blacklistToken(accessToken, 900); // 15 minutes
```

##### `isAuthenticated` (Type Guard)
```typescript
import { isAuthenticated } from '../middleware/auth.middleware';

if (isAuthenticated(req)) {
    // TypeScript knows req.user exists
    const userId = req.user.id;
}
```

## TypeScript Types

### `AuthUser` Interface

```typescript
interface AuthUser {
    id: string;
    email: string;
    name?: string;
    role?: string;
    workspaceId?: string;
}
```

The `Request` type is extended globally to include the optional `user` property:

```typescript
declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}
```

## Usage Examples

### Protected Route
```typescript
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as userController from '../controllers/user.controller';

const router = Router();

router.get('/me', authenticate, userController.getProfile);
router.put('/me', authenticate, userController.updateProfile);

export default router;
```

### Admin-Only Route
```typescript
router.delete('/users/:id',
    authenticate,
    authorize('admin'),
    userController.deleteUser
);
```

### Public Route with Optional Auth
```typescript
router.get('/posts',
    optionalAuth,
    (req, res) => {
        const userId = req.user?.id;

        if (userId) {
            // Get personalized posts
            const posts = await getPostsForUser(userId);
        } else {
            // Get public posts
            const posts = await getPublicPosts();
        }

        res.json({ posts });
    }
);
```

### Login Endpoint
```typescript
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // Verify credentials
    const user = await verifyCredentials(email, password);

    // Generate tokens
    const accessToken = generateAccessToken({
        userId: user.id,
        email: user.email
    });

    const refreshToken = generateRefreshToken({
        userId: user.id,
        email: user.email
    });

    res.json({
        user,
        accessToken,
        refreshToken
    });
});
```

### Logout Endpoint
```typescript
router.post('/logout', authenticate, async (req, res) => {
    // Get token from header
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
        // Blacklist token for 15 minutes (remaining validity period)
        await blacklistToken(token, 900);
    }

    res.json({ message: 'Logout successful' });
});
```

### Refresh Token Endpoint
```typescript
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;

    try {
        // Verify refresh token
        const payload = verifyRefreshToken(refreshToken);

        // Generate new access token
        const newAccessToken = generateAccessToken({
            userId: payload.userId,
            email: payload.email
        });

        res.json({ accessToken: newAccessToken });
    } catch (error) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid refresh token'
        });
    }
});
```

## Environment Variables

Required environment variables:

```env
# JWT Secrets (use strong random strings)
JWT_ACCESS_SECRET=your-super-secret-access-token-key
JWT_REFRESH_SECRET=your-super-secret-refresh-token-key

# JWT Expiration
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d
```

Generate secrets:
```bash
openssl rand -base64 32
```

## Security Considerations

1. **Token Blacklisting**: Uses Redis to store blacklisted tokens (logout)
2. **Fail Open**: If Redis is unavailable, tokens are still validated (availability over security)
3. **Database Lookup**: User is fetched from database on each request (ensures up-to-date data)
4. **Separate Secrets**: Access and refresh tokens use different secrets
5. **Short Expiration**: Access tokens expire quickly (15m default)
6. **Bearer Format**: Supports both `Bearer <token>` and `<token>` formats

## Error Handling

All middleware functions handle errors gracefully:
- Invalid tokens return 401
- Database errors return 500
- Redis errors are logged but don't fail requests (optional auth)

## Testing

```typescript
import request from 'supertest';
import app from '../app';

describe('Authentication', () => {
    it('should reject request without token', async () => {
        const res = await request(app)
            .get('/api/v1/users/me')
            .expect(401);

        expect(res.body.message).toBe('No authentication token provided');
    });

    it('should accept valid token', async () => {
        const token = generateAccessToken({ userId: '123', email: 'test@example.com' });

        const res = await request(app)
            .get('/api/v1/users/me')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(res.body.user).toBeDefined();
    });
});
```
