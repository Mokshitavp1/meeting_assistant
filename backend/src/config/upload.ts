import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';

/**
 * Multer Configuration for File Uploads
 * Extracted to its own module to avoid circular dependencies.
 */
const uploadDir = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directories exist
const createUploadDirs = () => {
    const dirs = [
        uploadDir,
        path.join(uploadDir, 'temp'),
        path.join(uploadDir, 'recordings'),
        path.join(uploadDir, 'documents'),
        path.join(uploadDir, 'avatars'),
    ];

    dirs.forEach((dir) => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

createUploadDirs();

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let dest = path.join(uploadDir, 'temp');

        if (file.fieldname === 'recording') {
            dest = path.join(uploadDir, 'recordings');
        } else if (file.fieldname === 'document') {
            dest = path.join(uploadDir, 'documents');
        } else if (file.fieldname === 'avatar') {
            dest = path.join(uploadDir, 'avatars');
        }

        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext);
        cb(null, `${basename}-${uniqueSuffix}${ext}`);
    },
});

// File filter for validation
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [
        '.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.mp3', '.mp4', '.wav', '.m4a'
    ];

    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${ext} not allowed. Allowed types: ${allowedTypes.join(', ')}`));
    }
};

// General upload middleware
export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600'), // 100MB default
        files: 5,
    },
});

// Recording-specific upload with larger size limit
export const uploadRecording = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowedAudioTypes = process.env.ALLOWED_AUDIO_TYPES?.split(',') || [
            '.mp3', '.wav', '.m4a', '.webm', '.ogg'
        ];
        const ext = path.extname(file.originalname).toLowerCase();

        if (allowedAudioTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Audio file type ${ext} not allowed`));
        }
    },
    limits: {
        fileSize: parseInt(process.env.MAX_RECORDING_SIZE || '524288000'), // 500MB default
        files: 1,
    },
});
