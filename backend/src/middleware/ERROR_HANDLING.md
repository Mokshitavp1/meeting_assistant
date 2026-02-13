# Error Handling System

Comprehensive error handling middleware for the AI Meeting Assistant API.

## Overview

The error handling system provides:
- **Consistent error responses** across all endpoints
- **Custom error classes** for different error types
- **Automatic error type detection** (Prisma, Zod, JWT, Multer, etc.)
- **Detailed logging** with request context
- **Development/Production modes** (detailed vs sanitized errors)
- **Type safety** with TypeScript

## Custom Error Classes

### Base Class: `AppError`

All custom errors extend from `AppError`:

```typescript
class AppError extends Error {
    statusCode: number;
    isOperational: boolean;
    code?: string;
    details?: any;
}
```

### Specific Error Classes

#### ValidationError - 400
```typescript
import { ValidationError } from '../middleware/error.middleware';

throw new ValidationError('Invalid email format', {
    field: 'email',
    value: 'invalid-email'
});
```

#### AuthenticationError - 401
```typescript
import { AuthenticationError } from '../middleware/error.middleware';

throw new AuthenticationError('Invalid credentials', 'INVALID_CREDENTIALS');
```

#### AuthorizationError - 403
```typescript
import { AuthorizationError } from '../middleware/error.middleware';

throw new AuthorizationError('You do not have permission to access this resource');
```

#### NotFoundError - 404
```typescript
import { NotFoundError } from '../middleware/error.middleware';

throw new NotFoundError('User', userId);
// Output: "User with id 123 not found"
```

#### ConflictError - 409
```typescript
import { ConflictError } from '../middleware/error.middleware';

throw new ConflictError('Email already registered');
```

#### BadRequestError - 400
```typescript
import { BadRequestError } from '../middleware/error.middleware';

throw new BadRequestError('Missing required field: name');
```

#### DatabaseError - 500
```typescript
import { DatabaseError } from '../middleware/error.middleware';

throw new DatabaseError('Failed to execute database query');
```

#### ExternalServiceError - 503
```typescript
import { ExternalServiceError } from '../middleware/error.middleware';

throw new ExternalServiceError('OpenAI', 'API request timeout');
```

## Usage in Routes

### Basic Error Throwing

```typescript
import { Router } from 'express';
import { NotFoundError, ConflictError } from '../middleware/error.middleware';

router.get('/users/:id', async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.params.id }
    });

    if (!user) {
        throw new NotFoundError('User', req.params.id);
    }

    res.json({ user });
});
```

### With Async Handler Wrapper

The `asyncHandler` wrapper automatically catches errors in async functions:

```typescript
import { asyncHandler } from '../middleware/error.middleware';

router.get('/users/:id', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.params.id }
    });

    if (!user) {
        throw new NotFoundError('User', req.params.id);
    }

    res.json({ user });
}));
```

### Validation with Zod

```typescript
import { z } from 'zod';
import { validateRequest } from '../middleware/error.middleware';

const createUserSchema = z.object({
    body: z.object({
        email: z.string().email(),
        name: z.string().min(2),
        password: z.string().min(8)
    })
});

router.post('/users',
    validateRequest(createUserSchema),
    async (req, res) => {
        // Request is validated
        const user = await createUser(req.body);
        res.status(201).json({ user });
    }
);
```

## Error Response Format

All errors follow a consistent format:

```json
{
    "success": false,
    "error": "ValidationError",
    "message": "Request validation failed",
    "code": "VALIDATION_ERROR",
    "details": [
        {
            "field": "email",
            "message": "Invalid email",
            "code": "invalid_string"
        }
    ],
    "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Development vs Production

**Development Mode:**
- Includes error stack traces
- Shows detailed error messages
- Includes error details

**Production Mode:**
- Hides stack traces
- Generic messages for programming errors
- Sanitizes sensitive information

## Automatic Error Handling

The middleware automatically handles common error types:

### Prisma Errors

```typescript
// P2002: Unique constraint violation
// Automatically converted to ConflictError

await prisma.user.create({
    data: { email: 'existing@example.com' }
});
// Response: 409 "A record with this email already exists"
```

### Zod Validation Errors

```typescript
// Automatic validation error formatting
const schema = z.object({
    email: z.string().email()
});

schema.parse({ email: 'invalid' });
// Response: 400 with formatted validation errors
```

### JWT Errors

```typescript
jwt.verify(token, secret);
// TokenExpiredError → 401 "Token has expired"
// JsonWebTokenError → 401 "Invalid token"
```

### Multer Upload Errors

```typescript
upload.single('file')(req, res, next);
// LIMIT_FILE_SIZE → 400 "File size exceeds maximum allowed size"
// LIMIT_FILE_COUNT → 400 "Too many files uploaded"
```

## Error Logging

Errors are automatically logged with request context:

```json
{
    "timestamp": "2024-01-15T10:30:00.000Z",
    "error": {
        "name": "NotFoundError",
        "message": "User with id 123 not found",
        "stack": "..."
    },
    "request": {
        "method": "GET",
        "url": "/api/v1/users/123",
        "params": { "id": "123" },
        "query": {},
        "body": {},
        "ip": "::1",
        "userAgent": "...",
        "userId": "456"
    }
}
```

**Note:** Sensitive fields (password, token, etc.) are automatically redacted from logs.

## Operational vs Programming Errors

### Operational Errors (Expected)
- User input validation errors
- Authentication failures
- Resource not found
- External service failures

**Logged as warnings**, business as usual.

### Programming Errors (Unexpected)
- Unhandled exceptions
- Type errors
- Null reference errors
- Database connection failures

**Logged as errors**, may trigger alerts.

## Complete Example

```typescript
import { Router } from 'express';
import { z } from 'zod';
import {
    asyncHandler,
    validateRequest,
    NotFoundError,
    ConflictError,
    BadRequestError
} from '../middleware/error.middleware';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Validation schema
const createMeetingSchema = z.object({
    body: z.object({
        title: z.string().min(1).max(255),
        startTime: z.string().datetime(),
        duration: z.number().int().min(1).max(480)
    })
});

// Create meeting endpoint
router.post('/meetings',
    authenticate,
    validateRequest(createMeetingSchema),
    asyncHandler(async (req, res) => {
        const { title, startTime, duration } = req.body;
        const userId = req.user!.id;

        // Check for conflicts
        const conflict = await checkMeetingConflict(userId, startTime);
        if (conflict) {
            throw new ConflictError('You have another meeting at this time');
        }

        // Create meeting
        const meeting = await prisma.meeting.create({
            data: {
                title,
                startTime: new Date(startTime),
                duration,
                userId
            }
        });

        res.status(201).json({
            success: true,
            data: { meeting }
        });
    })
);

// Get meeting endpoint
router.get('/meetings/:id',
    authenticate,
    asyncHandler(async (req, res) => {
        const meeting = await prisma.meeting.findUnique({
            where: { id: req.params.id }
        });

        if (!meeting) {
            throw new NotFoundError('Meeting', req.params.id);
        }

        // Check authorization
        if (meeting.userId !== req.user!.id) {
            throw new AuthorizationError('You do not have access to this meeting');
        }

        res.json({
            success: true,
            data: { meeting }
        });
    })
);

export default router;
```

## HTTP Status Codes

The error system uses appropriate HTTP status codes:

| Code | Error Class | Description |
|------|-------------|-------------|
| 400  | ValidationError | Invalid request data |
| 400  | BadRequestError | Malformed request |
| 401  | AuthenticationError | Not authenticated |
| 403  | AuthorizationError | Insufficient permissions |
| 404  | NotFoundError | Resource not found |
| 409  | ConflictError | Resource conflict |
| 413  | - | File too large (Multer) |
| 422  | ValidationError | Semantic validation error |
| 500  | DatabaseError | Database failure |
| 500  | AppError (default) | Internal server error |
| 503  | ExternalServiceError | External service unavailable |

## Best Practices

### 1. Use Specific Error Classes
```typescript
// Good
throw new NotFoundError('User', userId);

// Avoid
throw new Error('User not found');
```

### 2. Provide Context
```typescript
// Good
throw new ValidationError('Invalid date range', {
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    reason: 'End date must be after start date'
});

// Less helpful
throw new ValidationError('Invalid dates');
```

### 3. Use AsyncHandler
```typescript
// Good
router.get('/users', asyncHandler(async (req, res) => {
    // async code
}));

// Avoid (easy to forget error handling)
router.get('/users', async (req, res) => {
    try {
        // async code
    } catch (error) {
        // manual error handling
    }
});
```

### 4. Let Errors Bubble Up
```typescript
// Good
async function getUser(id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
        throw new NotFoundError('User', id);
    }
    return user;
}

// Avoid (loses error context)
async function getUser(id: string) {
    try {
        return await prisma.user.findUnique({ where: { id } });
    } catch (error) {
        return null; // Silent failure
    }
}
```

## Testing Error Handling

```typescript
import request from 'supertest';
import app from '../app';

describe('Error Handling', () => {
    it('should return 404 for non-existent route', async () => {
        const res = await request(app)
            .get('/api/v1/nonexistent')
            .expect(404);

        expect(res.body).toMatchObject({
            success: false,
            error: 'NotFoundError',
            code: 'NOT_FOUND'
        });
    });

    it('should return 400 for validation error', async () => {
        const res = await request(app)
            .post('/api/v1/users')
            .send({ email: 'invalid-email' })
            .expect(400);

        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details).toBeDefined();
    });

    it('should return 401 for unauthorized access', async () => {
        const res = await request(app)
            .get('/api/v1/meetings')
            .expect(401);

        expect(res.body.message).toContain('authentication');
    });
});
```

## Integration with Monitoring

For production environments, integrate with error monitoring services:

```typescript
// In errorHandler function
if (process.env.NODE_ENV === 'production' && !error.isOperational) {
    // Send to Sentry, DataDog, etc.
    Sentry.captureException(error, {
        contexts: {
            request: {
                method: req.method,
                url: req.originalUrl,
                headers: req.headers
            }
        }
    });
}
```
