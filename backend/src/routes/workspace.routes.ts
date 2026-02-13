import { Router } from 'express';
import {
    listWorkspaces,
    createWorkspace,
    getWorkspaceById,
    updateWorkspace,
    deleteWorkspace,
    generateInviteCodeEndpoint,
    joinWorkspace,
    listMembers,
    addMember,
    updateMemberRole,
    removeMember,
} from '../controllers/workspace.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * Workspace Routes
 * All routes require authentication
 */

const router = Router();

// Apply authentication to all workspace routes
router.use(authenticate);

/**
 * @route   GET /api/v1/workspaces
 * @desc    Get all workspaces for current user
 * @access  Private
 */
router.get('/', listWorkspaces);

/**
 * @route   POST /api/v1/workspaces
 * @desc    Create new workspace
 * @access  Private
 */
router.post('/', createWorkspace);

/**
 * @route   POST /api/v1/workspaces/join
 * @desc    Join workspace using invite code
 * @access  Private
 */
router.post('/join', joinWorkspace);

/**
 * @route   GET /api/v1/workspaces/:id
 * @desc    Get workspace details with members
 * @access  Private (Members only)
 */
router.get('/:id', getWorkspaceById);

/**
 * @route   PUT /api/v1/workspaces/:id
 * @desc    Update workspace details
 * @access  Private (Admin only)
 */
router.put('/:id', updateWorkspace);

/**
 * @route   DELETE /api/v1/workspaces/:id
 * @desc    Delete workspace
 * @access  Private (Admin only)
 */
router.delete('/:id', deleteWorkspace);

/**
 * @route   POST /api/v1/workspaces/:id/invite-code
 * @desc    Generate new invite code
 * @access  Private (Admin only)
 */
router.post('/:id/invite-code', generateInviteCodeEndpoint);

/**
 * @route   GET /api/v1/workspaces/:id/members
 * @desc    Get workspace members
 * @access  Private (Members only)
 */
router.get('/:id/members', listMembers);

/**
 * @route   POST /api/v1/workspaces/:id/members
 * @desc    Add member to workspace
 * @access  Private (Admin only)
 */
router.post('/:id/members', addMember);

/**
 * @route   PUT /api/v1/workspaces/:id/members/:memberId
 * @desc    Update member role
 * @access  Private (Admin only)
 */
router.put('/:id/members/:memberId', updateMemberRole);

/**
 * @route   DELETE /api/v1/workspaces/:id/members/:memberId
 * @desc    Remove member from workspace
 * @access  Private (Admin only)
 */
router.delete('/:id/members/:memberId', removeMember);

export default router;
