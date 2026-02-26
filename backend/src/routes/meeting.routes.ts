import { Router } from 'express';
import {
    listMeetings,
    createMeeting,
    getMeetingById,
    updateMeeting,
    deleteMeeting,
    startMeeting,
    endMeeting,
    uploadRecording,
    getTranscript,
    processMeeting,
    reviewMeeting,
    confirmMeetingTasks,
} from '../controllers/meeting.controller';
import { authenticate } from '../middleware/auth.middleware';
import { uploadRecording as uploadRecordingMiddleware } from '../config/upload';

/**
 * Meeting Routes
 * Handles meeting management, scheduling, and AI processing
 */

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/meetings
 * @desc    Get meetings with filters (workspace, status, date range)
 * @access  Private
 */
router.get('/', listMeetings);

/**
 * @route   POST /api/v1/meetings
 * @desc    Create new meeting
 * @access  Private
 */
router.post('/', createMeeting);

/**
 * @route   GET /api/v1/meetings/:id
 * @desc    Get meeting details with participants and minutes
 * @access  Private
 */
router.get('/:id', getMeetingById);

/**
 * @route   PUT /api/v1/meetings/:id
 * @desc    Update meeting details
 * @access  Private
 */
router.put('/:id', updateMeeting);

/**
 * @route   DELETE /api/v1/meetings/:id
 * @desc    Delete meeting
 * @access  Private
 */
router.delete('/:id', deleteMeeting);

/**
 * @route   POST /api/v1/meetings/:id/start
 * @desc    Start meeting (mark as in progress)
 * @access  Private
 */
router.post('/:id/start', startMeeting);

/**
 * @route   POST /api/v1/meetings/:id/end
 * @desc    End meeting (mark as completed)
 * @access  Private
 */
router.post('/:id/end', endMeeting);

/**
 * @route   POST /api/v1/meetings/:id/recording
 * @desc    Upload meeting recording (audio/video)
 * @access  Private
 */
router.post('/:id/recording', uploadRecordingMiddleware.single('recording'), uploadRecording);

/**
 * @route   GET /api/v1/meetings/:id/transcript
 * @desc    Get meeting transcript
 * @access  Private
 */
router.get('/:id/transcript', getTranscript);

/**
 * @route   POST /api/v1/meetings/:id/process
 * @desc    Trigger AI processing (transcription + task extraction + MoM)
 * @access  Private
 */
router.post('/:id/process', processMeeting);

/**
 * @route   GET /api/v1/meetings/:id/review
 * @desc    Get AI-extracted tasks and MoM for admin review/editing
 * @access  Private (creator, organizer, workspace admin)
 */
router.get('/:id/review', reviewMeeting);

/**
 * @route   POST /api/v1/meetings/:id/confirm
 * @desc    Confirm edited tasks and MoM — triggers calendar events + emails
 * @access  Private (creator, organizer, workspace admin)
 */
router.post('/:id/confirm', confirmMeetingTasks);

export default router;
