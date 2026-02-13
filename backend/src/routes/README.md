# Routes Directory

This directory contains all API route modules for the AI Meeting Assistant application.

## Structure

```
routes/
├── index.ts              # Main router with API versioning
├── auth.routes.ts        # Authentication routes
├── user.routes.ts        # User management routes
├── workspace.routes.ts   # Workspace routes
├── meeting.routes.ts     # Meeting routes
├── task.routes.ts        # Task routes
├── transcription.routes.ts
├── summary.routes.ts
├── action-item.routes.ts
├── integration.routes.ts
├── notification.routes.ts
├── search.routes.ts
├── analytics.routes.ts
└── settings.routes.ts
```

## Creating a New Route Module

### Template

```typescript
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { schema } from '../schemas/example.schema';
// Import your controllers
// import * as exampleController from '../controllers/example.controller';

const router = Router();

/**
 * @route   GET /api/v1/examples
 * @desc    Get all examples
 * @access  Private
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
    // exampleController.getAll(req, res);
    res.json({ message: 'Get all examples' });
});

/**
 * @route   GET /api/v1/examples/:id
 * @desc    Get example by ID
 * @access  Private
 */
router.get('/:id', authenticate, async (req: Request, res: Response) => {
    // exampleController.getById(req, res);
    res.json({ message: `Get example ${req.params.id}` });
});

/**
 * @route   POST /api/v1/examples
 * @desc    Create new example
 * @access  Private
 */
router.post('/', authenticate, validate(schema), async (req: Request, res: Response) => {
    // exampleController.create(req, res);
    res.json({ message: 'Create example' });
});

/**
 * @route   PUT /api/v1/examples/:id
 * @desc    Update example
 * @access  Private
 */
router.put('/:id', authenticate, validate(schema), async (req: Request, res: Response) => {
    // exampleController.update(req, res);
    res.json({ message: `Update example ${req.params.id}` });
});

/**
 * @route   DELETE /api/v1/examples/:id
 * @desc    Delete example
 * @access  Private
 */
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
    // exampleController.delete(req, res);
    res.json({ message: `Delete example ${req.params.id}` });
});

export default router;
```

## After Creating a Route Module

1. **Uncomment the import** in `routes/index.ts`:
   ```typescript
   import exampleRoutes from './example.routes';
   ```

2. **Mount the route** in the `createV1Router` function:
   ```typescript
   router.use('/examples', exampleRoutes);
   ```

3. **Update the endpoints list** in the v1 router info endpoint.

## Route Guidelines

### Naming Convention
- Use kebab-case for route files: `example-route.routes.ts`
- Export default router
- Use descriptive route names

### Authentication
- Use `authenticate` middleware for protected routes
- Public routes should not use authentication middleware
- Apply rate limiting for sensitive routes (auth, password reset, etc.)

### Validation
- Use Zod schemas for request validation
- Validate body, params, and query separately
- Place validation middleware before controller

### Error Handling
- Controllers should throw errors, not send responses
- Let the global error handler catch and format errors
- Use appropriate HTTP status codes

### Documentation
- Add JSDoc comments for each route
- Specify method, path, description, and access level
- Document request/response formats

## API Versioning

All routes are versioned under `/api/v{version}`:
- Current: `/api/v1/...`
- Future versions can be added in `routes/index.ts`

## Example Routes

### Authentication Routes (`auth.routes.ts`)
```
POST   /api/v1/auth/register      - Register new user
POST   /api/v1/auth/login         - Login user
POST   /api/v1/auth/logout        - Logout user
POST   /api/v1/auth/refresh       - Refresh access token
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/auth/me            - Get current user
```

### Meeting Routes (`meeting.routes.ts`)
```
GET    /api/v1/meetings           - List all meetings
POST   /api/v1/meetings           - Create meeting
GET    /api/v1/meetings/:id       - Get meeting details
PUT    /api/v1/meetings/:id       - Update meeting
DELETE /api/v1/meetings/:id       - Delete meeting
POST   /api/v1/meetings/:id/join  - Join meeting
POST   /api/v1/meetings/:id/leave - Leave meeting
POST   /api/v1/meetings/:id/record - Start recording
```

### Transcription Routes (`transcription.routes.ts`)
```
POST   /api/v1/transcriptions                 - Upload & transcribe audio
GET    /api/v1/transcriptions/:id             - Get transcription
PUT    /api/v1/transcriptions/:id             - Update transcription
GET    /api/v1/meetings/:meetingId/transcriptions
POST   /api/v1/transcriptions/:id/export      - Export transcription
```

## Status Codes

Use appropriate HTTP status codes:
- `200` - OK (successful GET, PUT, DELETE)
- `201` - Created (successful POST)
- `204` - No Content (successful DELETE with no response body)
- `400` - Bad Request (validation error)
- `401` - Unauthorized (not authenticated)
- `403` - Forbidden (authenticated but no permission)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `422` - Unprocessable Entity (semantic validation error)
- `500` - Internal Server Error

## Testing Routes

Test your routes using:
```bash
# Development
curl http://localhost:3000/api/v1/examples

# Or use tools like Postman, Insomnia, or Thunder Client
```
