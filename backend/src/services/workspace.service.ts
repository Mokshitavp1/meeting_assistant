import crypto from 'crypto';
import { prisma } from '../config/database';
import {
    NotFoundError,
    AuthorizationError,
    ConflictError,
    BadRequestError,
} from '../middleware/error.middleware';

/**
 * Workspace Service
 * Handles all workspace-related business logic
 */

/**
 * Interfaces
 */

export interface CreateWorkspaceData {
    name: string;
    description?: string;
    creatorId: string;
}

export interface UpdateWorkspaceData {
    name?: string;
    description?: string;
}

export interface AddMemberData {
    workspaceId: string;
    userId: string;
    role?: 'admin' | 'member';
}

export interface WorkspaceWithMembers {
    id: string;
    name: string;
    description: string | null;
    inviteCode: string;
    createdAt: Date;
    updatedAt: Date;
    members: Array<{
        id: string;
        role: string;
        user: {
            id: string;
            name: string | null;
            email: string;
        };
        joinedAt: Date;
    }>;
    _count?: {
        members: number;
    };
}

export interface WorkspaceMember {
    id: string;
    role: string;
    user: {
        id: string;
        name: string | null;
        email: string;
    };
    joinedAt: Date;
}

/**
 * Generate Unique Invite Code
 * Creates a cryptographically secure random invite code
 */
export function generateInviteCode(): string {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Ensure Unique Invite Code
 * Generates invite codes until a unique one is found
 */
async function ensureUniqueInviteCode(): Promise<string> {
    let inviteCode: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
        inviteCode = generateInviteCode();

        const existing = await prisma.workspace.findUnique({
            where: { inviteCode },
        });

        if (!existing) {
            isUnique = true;
            return inviteCode;
        }

        attempts++;
    }

    throw new Error('Failed to generate unique invite code after multiple attempts');
}

/**
 * Create Workspace
 * Creates a new workspace with the creator as admin
 */
export async function createWorkspace(data: CreateWorkspaceData): Promise<WorkspaceWithMembers> {
    const { name, description, creatorId } = data;

    // Generate unique invite code
    const inviteCode = await ensureUniqueInviteCode();

    // Create workspace with creator as admin member
    const workspace = await prisma.workspace.create({
        data: {
            name,
            description,
            inviteCode,
            members: {
                create: {
                    userId: creatorId,
                    role: 'admin',
                },
            },
        },
        include: {
            members: {
                select: {
                    id: true,
                    role: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    joinedAt: true,
                },
            },
            _count: {
                select: {
                    members: true,
                },
            },
        },
    });

    return workspace;
}

/**
 * Get Workspace by ID
 * Retrieves workspace with member details
 */
export async function getWorkspaceById(workspaceId: string): Promise<WorkspaceWithMembers | null> {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: {
            members: {
                select: {
                    id: true,
                    role: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    joinedAt: true,
                },
                orderBy: {
                    joinedAt: 'asc',
                },
            },
            _count: {
                select: {
                    members: true,
                },
            },
        },
    });

    return workspace;
}

/**
 * Get User Workspaces
 * Retrieves all workspaces where user is a member
 */
export async function getUserWorkspaces(userId: string): Promise<WorkspaceWithMembers[]> {
    const workspaces = await prisma.workspace.findMany({
        where: {
            members: {
                some: {
                    userId,
                },
            },
        },
        include: {
            members: {
                select: {
                    id: true,
                    role: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    joinedAt: true,
                },
            },
            _count: {
                select: {
                    members: true,
                },
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    return workspaces;
}

/**
 * Update Workspace
 * Updates workspace details (admin only)
 */
export async function updateWorkspace(
    workspaceId: string,
    data: UpdateWorkspaceData,
    userId: string
): Promise<WorkspaceWithMembers> {
    // Check if user is admin
    const isAdmin = await isWorkspaceAdmin(workspaceId, userId);

    if (!isAdmin) {
        throw new AuthorizationError('Only workspace admins can update workspace details');
    }

    // Check if workspace exists
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
    });

    if (!workspace) {
        throw new NotFoundError('Workspace');
    }

    // Update workspace
    const updatedWorkspace = await prisma.workspace.update({
        where: { id: workspaceId },
        data,
        include: {
            members: {
                select: {
                    id: true,
                    role: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    joinedAt: true,
                },
            },
            _count: {
                select: {
                    members: true,
                },
            },
        },
    });

    return updatedWorkspace;
}

/**
 * Delete Workspace
 * Deletes workspace and all related data (cascade delete)
 */
export async function deleteWorkspace(workspaceId: string, userId: string): Promise<void> {
    // Check if user is admin
    const isAdmin = await isWorkspaceAdmin(workspaceId, userId);

    if (!isAdmin) {
        throw new AuthorizationError('Only workspace admins can delete the workspace');
    }

    // Check if workspace exists
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
    });

    if (!workspace) {
        throw new NotFoundError('Workspace');
    }

    // Delete workspace (cascade will delete members and related data)
    await prisma.workspace.delete({
        where: { id: workspaceId },
    });
}

/**
 * Generate New Invite Code
 * Generates and updates workspace with new invite code
 */
export async function regenerateInviteCode(workspaceId: string, userId: string): Promise<string> {
    // Check if user is admin
    const isAdmin = await isWorkspaceAdmin(workspaceId, userId);

    if (!isAdmin) {
        throw new AuthorizationError('Only workspace admins can generate invite codes');
    }

    // Check if workspace exists
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
    });

    if (!workspace) {
        throw new NotFoundError('Workspace');
    }

    // Generate new unique invite code
    const inviteCode = await ensureUniqueInviteCode();

    // Update workspace
    await prisma.workspace.update({
        where: { id: workspaceId },
        data: { inviteCode },
    });

    return inviteCode;
}

/**
 * Validate Invite Code
 * Checks if invite code is valid and returns workspace
 */
export async function validateInviteCode(inviteCode: string): Promise<WorkspaceWithMembers> {
    const workspace = await prisma.workspace.findUnique({
        where: { inviteCode },
        include: {
            members: {
                select: {
                    id: true,
                    role: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    joinedAt: true,
                },
            },
            _count: {
                select: {
                    members: true,
                },
            },
        },
    });

    if (!workspace) {
        throw new NotFoundError('Workspace', 'Invalid invite code');
    }

    return workspace;
}

/**
 * Join Workspace
 * Adds user to workspace using invite code
 */
export async function joinWorkspace(inviteCode: string, userId: string): Promise<WorkspaceWithMembers> {
    // Validate invite code and get workspace
    const workspace = await validateInviteCode(inviteCode);

    // Check if user is already a member
    const existingMember = await prisma.workspaceMember.findUnique({
        where: {
            workspaceId_userId: {
                workspaceId: workspace.id,
                userId,
            },
        },
    });

    if (existingMember) {
        throw new ConflictError('You are already a member of this workspace');
    }

    // Add user as member
    await prisma.workspaceMember.create({
        data: {
            workspaceId: workspace.id,
            userId,
            role: 'member',
        },
    });

    // Return updated workspace
    return getWorkspaceById(workspace.id) as Promise<WorkspaceWithMembers>;
}

/**
 * Check if User is Workspace Admin
 */
export async function isWorkspaceAdmin(workspaceId: string, userId: string): Promise<boolean> {
    const member = await prisma.workspaceMember.findUnique({
        where: {
            workspaceId_userId: {
                workspaceId,
                userId,
            },
        },
    });

    return member?.role === 'admin';
}

/**
 * Check if User is Workspace Member
 */
export async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    const member = await prisma.workspaceMember.findUnique({
        where: {
            workspaceId_userId: {
                workspaceId,
                userId,
            },
        },
    });

    return member !== null;
}

/**
 * Get Workspace Members
 * Retrieves all members of a workspace
 */
export async function getWorkspaceMembers(
    workspaceId: string,
    userId: string
): Promise<WorkspaceMember[]> {
    // Check if user is member
    const isMember = await isWorkspaceMember(workspaceId, userId);

    if (!isMember) {
        throw new AuthorizationError('You are not a member of this workspace');
    }

    const members = await prisma.workspaceMember.findMany({
        where: {
            workspaceId,
        },
        select: {
            id: true,
            role: true,
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
            joinedAt: true,
        },
        orderBy: {
            joinedAt: 'asc',
        },
    });

    return members;
}

/**
 * Add Member to Workspace
 * Adds a user to workspace with specified role (admin only)
 */
export async function addMember(data: AddMemberData, requesterId: string): Promise<WorkspaceMember> {
    const { workspaceId, userId, role = 'member' } = data;

    // Check if requester is admin
    const isAdmin = await isWorkspaceAdmin(workspaceId, requesterId);

    if (!isAdmin) {
        throw new AuthorizationError('Only workspace admins can add members');
    }

    // Check if workspace exists
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
    });

    if (!workspace) {
        throw new NotFoundError('Workspace');
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        throw new NotFoundError('User');
    }

    // Check if user is already a member
    const existingMember = await prisma.workspaceMember.findUnique({
        where: {
            workspaceId_userId: {
                workspaceId,
                userId,
            },
        },
    });

    if (existingMember) {
        throw new ConflictError('User is already a member of this workspace');
    }

    // Add member
    const member = await prisma.workspaceMember.create({
        data: {
            workspaceId,
            userId,
            role,
        },
        select: {
            id: true,
            role: true,
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
            joinedAt: true,
        },
    });

    return member;
}

/**
 * Update Member Role
 * Promotes or demotes a workspace member (admin only)
 */
export async function updateMemberRole(
    workspaceId: string,
    memberId: string,
    newRole: 'admin' | 'member',
    requesterId: string
): Promise<WorkspaceMember> {
    // Check if requester is admin
    const isAdmin = await isWorkspaceAdmin(workspaceId, requesterId);

    if (!isAdmin) {
        throw new AuthorizationError('Only workspace admins can update member roles');
    }

    // Get member to update
    const member = await prisma.workspaceMember.findUnique({
        where: { id: memberId },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
        },
    });

    if (!member || member.workspaceId !== workspaceId) {
        throw new NotFoundError('Member');
    }

    // Prevent removing last admin
    if (member.role === 'admin' && newRole === 'member') {
        const adminCount = await getAdminCount(workspaceId);

        if (adminCount <= 1) {
            throw new BadRequestError('Cannot demote the last admin. Promote another member first.');
        }
    }

    // Update member role
    const updatedMember = await prisma.workspaceMember.update({
        where: { id: memberId },
        data: { role: newRole },
        select: {
            id: true,
            role: true,
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
            joinedAt: true,
        },
    });

    return updatedMember;
}

/**
 * Remove Member from Workspace
 * Removes a user from workspace (admin only)
 */
export async function removeMember(
    workspaceId: string,
    memberId: string,
    requesterId: string
): Promise<void> {
    // Check if requester is admin
    const isAdmin = await isWorkspaceAdmin(workspaceId, requesterId);

    if (!isAdmin) {
        throw new AuthorizationError('Only workspace admins can remove members');
    }

    // Get member to remove
    const member = await prisma.workspaceMember.findUnique({
        where: { id: memberId },
    });

    if (!member || member.workspaceId !== workspaceId) {
        throw new NotFoundError('Member');
    }

    // Prevent removing last admin
    if (member.role === 'admin') {
        const adminCount = await getAdminCount(workspaceId);

        if (adminCount <= 1) {
            throw new BadRequestError('Cannot remove the last admin from the workspace');
        }
    }

    // Remove member
    await prisma.workspaceMember.delete({
        where: { id: memberId },
    });
}

/**
 * Leave Workspace
 * Allows a user to leave a workspace
 */
export async function leaveWorkspace(workspaceId: string, userId: string): Promise<void> {
    // Get member record
    const member = await prisma.workspaceMember.findUnique({
        where: {
            workspaceId_userId: {
                workspaceId,
                userId,
            },
        },
    });

    if (!member) {
        throw new NotFoundError('You are not a member of this workspace');
    }

    // Prevent last admin from leaving
    if (member.role === 'admin') {
        const adminCount = await getAdminCount(workspaceId);

        if (adminCount <= 1) {
            throw new BadRequestError(
                'You are the last admin. Promote another member to admin before leaving.'
            );
        }
    }

    // Remove member
    await prisma.workspaceMember.delete({
        where: { id: member.id },
    });
}

/**
 * Get Admin Count
 * Returns the number of admins in a workspace
 */
export async function getAdminCount(workspaceId: string): Promise<number> {
    const count = await prisma.workspaceMember.count({
        where: {
            workspaceId,
            role: 'admin',
        },
    });

    return count;
}

/**
 * Get Member Count
 * Returns the total number of members in a workspace
 */
export async function getMemberCount(workspaceId: string): Promise<number> {
    const count = await prisma.workspaceMember.count({
        where: {
            workspaceId,
        },
    });

    return count;
}

/**
 * Get User Role in Workspace
 * Returns the user's role in a workspace or null if not a member
 */
export async function getUserRole(
    workspaceId: string,
    userId: string
): Promise<'admin' | 'member' | null> {
    const member = await prisma.workspaceMember.findUnique({
        where: {
            workspaceId_userId: {
                workspaceId,
                userId,
            },
        },
    });

    if (!member) {
        return null;
    }

    return member.role as 'admin' | 'member';
}

/**
 * Verify Workspace Access
 * Throws error if user is not a member of workspace
 */
export async function verifyWorkspaceAccess(workspaceId: string, userId: string): Promise<void> {
    const isMember = await isWorkspaceMember(workspaceId, userId);

    if (!isMember) {
        throw new AuthorizationError('You do not have access to this workspace');
    }
}

/**
 * Verify Admin Access
 * Throws error if user is not an admin of workspace
 */
export async function verifyAdminAccess(workspaceId: string, userId: string): Promise<void> {
    const isAdmin = await isWorkspaceAdmin(workspaceId, userId);

    if (!isAdmin) {
        throw new AuthorizationError('Only workspace admins can perform this action');
    }
}
