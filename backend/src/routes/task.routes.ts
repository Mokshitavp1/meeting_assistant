import { Router } from 'express';
import {
    listTasks,
    createTask,
    getTaskById,
    updateTask,
    deleteTask,
    updateTaskStatus,
    bulkConfirmTasks,
    addComment,
    getComments,
} from '../controllers/task.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * Task Routes
 * Handles task CRUD, status transitions, comments, and bulk operations
 */

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/tasks
 * @desc    List tasks with filters (status, assignee, workspace, deadline)
 * @access  Private
 */
router.get('/', listTasks);

/**
 * @route   POST /api/v1/tasks
 * @desc    Create a new task
 * @access  Private
 */
router.post('/', createTask);

/**
 * @route   POST /api/v1/tasks/bulk-confirm
 * @desc    Bulk confirm AI-extracted tasks
 * @access  Private
 */
router.post('/bulk-confirm', bulkConfirmTasks);

/**
 * @route   GET /api/v1/tasks/:id
 * @desc    Get task details with comments
 * @access  Private
 */
router.get('/:id', getTaskById);

/**
 * @route   PUT /api/v1/tasks/:id
 * @desc    Update task details
 * @access  Private
 */
router.put('/:id', updateTask);

/**
 * @route   DELETE /api/v1/tasks/:id
 * @desc    Delete a task
 * @access  Private
 */
router.delete('/:id', deleteTask);

/**
 * @route   PATCH /api/v1/tasks/:id/status
 * @desc    Update task status with transition validation
 * @access  Private
 */
router.patch('/:id/status', updateTaskStatus);

/**
 * @route   POST /api/v1/tasks/:id/comments
 * @desc    Add comment to a task
 * @access  Private
 */
router.post('/:id/comments', addComment);

/**
 * @route   GET /api/v1/tasks/:id/comments
 * @desc    Get task comments
 * @access  Private
 */
router.get('/:id/comments', getComments);

export default router;
