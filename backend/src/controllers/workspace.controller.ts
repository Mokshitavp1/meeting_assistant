import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
    asyncHandler,
    AuthorizationError,
} from '../middleware/error.middleware';
import * as workspaceService from '../services/workspace.service';

/**
 * Workspace Controller
 * Handles workspace management, members, and invitations
 */

/**
 * Validation Schemas
 */

const createWorkspaceSchema = z.object({
    name: z.string().min(2, 'Workspace name must be at least 2 characters').max(100),
    description: z.string().max(500).optional(),
});

const updateWorkspaceSchema = z.object({
    name: z.string().min(2).max(100).optional(),
    description: z.string().max(500).optional(),
});

const joinWorkspaceSchema = z.object({
    inviteCode: z.string().min(1, 'Invite code is required'),
});

const addMemberSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
    role: z.enum(['admin', 'member']).optional().default('member'),
});

const updateMemberRoleSchema = z.object({
    role: z.enum(['admin', 'member']),
});

const getRouteParam = (value: string | string[] | undefined, paramName: string): string => {
    if (typeof value === 'string' && value.trim()) {
        return value;
    }

    throw new AuthorizationError(`Invalid or missing route parameter: ${paramName}`);
};

/**
 * List Workspaces - Get all workspaces for current user
 * GET /api/v1/workspaces
 */
export const listWorkspaces = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const workspaces = await workspaceService.getUserWorkspaces(req.user.id);

        res.status(200).json({
            success: true,
            data: {
                workspaces,
                count: workspaces.length,
            },
        });
    }
);

/**
 * Create Workspace - Create new workspace
 * POST /api/v1/workspaces
 */
export const createWorkspace = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        // Validate input
        const validatedData = createWorkspaceSchema.parse(req.body);

        const { name, description } = validatedData;

        // Create workspace using service
        const workspace = await workspaceService.createWorkspace({
            name,
            description,
            creatorId: req.user.id,
        });

        res.status(201).json({
            success: true,
            message: 'Workspace created successfully',
            data: {
                workspace,
            },
        });
    }
);

/**
 * Get Workspace By ID - Get workspace details with members
 * GET /api/v1/workspaces/:id
 */
export const getWorkspaceById = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getRouteParam(req.params.id, 'id');

        // Verify user has access to workspace
        await workspaceService.verifyWorkspaceAccess(id, req.user.id);

        const workspace = await workspaceService.getWorkspaceById(id);

        res.status(200).json({
            success: true,
            data: {
                workspace,
            },
        });
    }
);

/**
 * Update Workspace - Update workspace details (admin only)
 * PUT /api/v1/workspaces/:id
 */
export const updateWorkspace = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getRouteParam(req.params.id, 'id');

        // Validate input
        const validatedData = updateWorkspaceSchema.parse(req.body);

        // Update workspace (service checks admin permission)
        const workspace = await workspaceService.updateWorkspace(id, validatedData, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Workspace updated successfully',
            data: {
                workspace,
            },
        });
    }
);

/**
 * Delete Workspace - Delete workspace (admin only)
 * DELETE /api/v1/workspaces/:id
 */
export const deleteWorkspace = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getRouteParam(req.params.id, 'id');

        // Delete workspace (service checks admin permission)
        await workspaceService.deleteWorkspace(id, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Workspace deleted successfully',
        });
    }
);

/**
 * Generate Invite Code - Generate new unique invite code (admin only)
 * POST /api/v1/workspaces/:id/invite-code
 */
export const generateInviteCodeEndpoint = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getRouteParam(req.params.id, 'id');

        // Generate new invite code (service checks admin permission)
        const inviteCode = await workspaceService.regenerateInviteCode(id, req.user.id);

        const workspace = await workspaceService.getWorkspaceById(id);

        res.status(200).json({
            success: true,
            message: 'Invite code generated successfully',
            data: {
                inviteCode,
                workspaceId: id,
                workspaceName: workspace?.name,
            },
        });
    }
);

/**
 * Join Workspace - Join workspace using invite code
 * POST /api/v1/workspaces/join
 */
export const joinWorkspace = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        // Validate input
        const validatedData = joinWorkspaceSchema.parse(req.body);

        const { inviteCode } = validatedData;

        // Join workspace using service
        const workspace = await workspaceService.joinWorkspace(inviteCode, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Successfully joined workspace',
            data: {
                workspace,
            },
        });
    }
);

/**
 * List Members - Get workspace members
 * GET /api/v1/workspaces/:id/members
 */
export const listMembers = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getRouteParam(req.params.id, 'id');

        // Get members (service checks membership)
        const members = await workspaceService.getWorkspaceMembers(id, req.user.id);

        res.status(200).json({
            success: true,
            data: {
                members,
                count: members.length,
            },
        });
    }
);

/**
 * Add Member - Add member to workspace (admin only)
 * POST /api/v1/workspaces/:id/members
 */
export const addMember = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getRouteParam(req.params.id, 'id');

        // Validate input
        const validatedData = addMemberSchema.parse(req.body);

        const { userId, role } = validatedData;

        // Add member (service checks admin permission)
        const member = await workspaceService.addMember(
            {
                workspaceId: id,
                userId,
                role,
            },
            req.user.id
        );

        res.status(201).json({
            success: true,
            message: 'Member added successfully',
            data: {
                member,
            },
        });
    }
);

/**
 * Update Member Role - Update member role (admin only)
 * PUT /api/v1/workspaces/:id/members/:memberId
 */
export const updateMemberRole = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getRouteParam(req.params.id, 'id');
        const memberId = getRouteParam(req.params.memberId, 'memberId');

        // Validate input
        const validatedData = updateMemberRoleSchema.parse(req.body);

        const { role } = validatedData;

        // Update member role (service checks admin permission and last admin protection)
        const member = await workspaceService.updateMemberRole(id, memberId, role, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Member role updated successfully',
            data: {
                member,
            },
        });
    }
);

/**
 * Remove Member - Remove member from workspace (admin only)
 * DELETE /api/v1/workspaces/:id/members/:memberId
 */
export const removeMember = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getRouteParam(req.params.id, 'id');
        const memberId = getRouteParam(req.params.memberId, 'memberId');

        // Remove member (service checks admin permission and last admin protection)
        await workspaceService.removeMember(id, memberId, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Member removed successfully',
        });
    }
);
