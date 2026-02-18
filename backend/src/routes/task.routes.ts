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
 * All routes require authentication.
 */

const router = Router();

router.use(authenticate);

/**
 * @route   GET /api/v1/tasks
 * @desc    List tasks with filters — admins see all, members see own
 * @access  Private
 */
router.get('/', listTasks);

/**
 * @route   POST /api/v1/tasks
 * @desc    Manually create a task
 * @access  Private
 */
router.post('/', createTask);

/**
 * @route   POST /api/v1/tasks/bulk-confirm
 * @desc    Confirm multiple AI-extracted tasks at once
 * @access  Private (workspace admin or meeting organizer)
 *
 * NOTE: must be declared before /:id to avoid Express treating
 * "bulk-confirm" as an :id parameter.
 */
router.post('/bulk-confirm', bulkConfirmTasks);

/**
 * @route   GET /api/v1/tasks/:id
 * @desc    Get task details including recent comments
 * @access  Private
 */
router.get('/:id', getTaskById);

/**
 * @route   PUT /api/v1/tasks/:id
 * @desc    Update task title, description, assignee, priority, or due date
 * @access  Private (assignee or workspace admin)
 */
router.put('/:id', updateTask);

/**
 * @route   DELETE /api/v1/tasks/:id
 * @desc    Delete task
 * @access  Private (workspace admin)
 */
router.delete('/:id', deleteTask);

/**
 * @route   PATCH /api/v1/tasks/:id/status
 * @desc    Update task status (pending → in_progress → completed)
 * @access  Private (assignee or workspace admin)
 */
router.patch('/:id/status', updateTaskStatus);

/**
 * @route   GET /api/v1/tasks/:id/comments
 * @desc    Get paginated comments for a task
 * @access  Private
 */
router.get('/:id/comments', getComments);

/**
 * @route   POST /api/v1/tasks/:id/comments
 * @desc    Add a comment to a task
 * @access  Private
 */
router.post('/:id/comments', addComment);

export default router;
