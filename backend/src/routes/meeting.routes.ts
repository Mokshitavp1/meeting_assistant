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
} from '../controllers/meeting.controller';
import { authenticate } from '../middleware/auth.middleware';
import { uploadRecording as uploadRecordingMiddleware } from '../app';

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

export default router;
