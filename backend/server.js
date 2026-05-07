// backend/server.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// Middleware
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security & timeout
const execPromise = util.promisify(exec);
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/ig_reel_downloads';

// Ensure temp directory exists
(async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch (err) { console.error('Temp dir error', err); }
})();

// Cleanup function: delete job folder after 30 minutes
const cleanupJobs = new Map();

function scheduleCleanup(jobId) {
    if (cleanupJobs.has(jobId)) clearTimeout(cleanupJobs.get(jobId));
    const timeout = setTimeout(async () => {
        const jobPath = path.join(TEMP_DIR, jobId);
        try {
            await fs.rm(jobPath, { recursive: true, force: true });
            console.log(`Cleaned up ${jobId}`);
        } catch (err) { console.error(`Cleanup error ${jobId}`, err); }
        cleanupJobs.delete(jobId);
    }, 30 * 60 * 1000);
    cleanupJobs.set(jobId, timeout);
}

// Instagram URL validation
function isValidInstagramReelUrl(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(reel|p)\/([a-zA-Z0-9_-]+)/;
    return regex.test(url);
}

// POST /download endpoint
app.post('/download', async (req, res) => {
    const { url } = req.body;
    if (!url || !isValidInstagramReelUrl(url)) {
        return res.status(400).json({ success: false, error: 'Invalid Instagram Reel URL' });
    }
    const jobId = uuidv4();
    const jobDir = path.join(TEMP_DIR, jobId);
    const videoOutputPath = path.join(jobDir, 'video.mp4');
    const thumbnailPath = path.join(jobDir, 'thumb.jpg');
    
    try {
        await fs.mkdir(jobDir, { recursive: true });
        
        // Step 1: Download video using yt-dlp
        console.log(`[${jobId}] Downloading: ${url}`);
        const ytCommand = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${videoOutputPath}" "${url}"`;
        await execPromise(ytCommand, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
        
        // Check if video exists
        await fs.access(videoOutputPath);
        
        // Step 2: Generate thumbnail using FFmpeg (frame at 1 sec)
        const ffmpegThumb = `ffmpeg -i "${videoOutputPath}" -ss 00:00:01 -vframes 1 -f image2 "${thumbnailPath}" -y`;
        await execPromise(ffmpegThumb, { timeout: 10000 }).catch(() => console.warn('Thumbnail generation failed'));
        
        // Get title from metadata (optional)
        let videoTitle = 'Instagram Reel';
        try {
            const infoCommand = `yt-dlp --get-filename -o "%(title)s" "${url}"`;
            const { stdout } = await execPromise(infoCommand, { timeout: 5000 });
            if (stdout.trim()) videoTitle = stdout.trim().substring(0, 60);
        } catch(e) {}
        
        scheduleCleanup(jobId);
        // Return relative endpoints
        const thumbnailUrl = `${req.protocol}://${req.get('host')}/thumb/${jobId}`;
        return res.json({
            success: true,
            downloadId: jobId,
            title: videoTitle,
            thumbnailUrl: thumbnailUrl
        });
    } catch (error) {
        console.error(`[${jobId}] Error:`, error.message);
        // Cleanup on failure
        await fs.rm(jobDir, { recursive: true, force: true }).catch(()=>{});
        return res.status(500).json({ success: false, error: 'Failed to process reel. Check URL or server dependencies.' });
    }
});

// GET /video/:id - serve video file
app.get('/video/:id', async (req, res) => {
    const jobId = req.params.id;
    const videoPath = path.join(TEMP_DIR, jobId, 'video.mp4');
    try {
        await fs.access(videoPath);
        res.setHeader('Content-Disposition', `attachment; filename="reel_${jobId}.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');
        res.sendFile(videoPath, (err) => {
            if (err) console.error('Send error:', err);
            // Do not delete immediately; schedule cleanup already set
        });
    } catch (err) {
        res.status(404).json({ error: 'Video not found or expired' });
    }
});

// GET /thumb/:id - serve thumbnail
app.get('/thumb/:id', async (req, res) => {
    const jobId = req.params.id;
    const thumbPath = path.join(TEMP_DIR, jobId, 'thumb.jpg');
    try {
        await fs.access(thumbPath);
        res.sendFile(thumbPath);
    } catch (err) {
        res.status(404).send('Thumbnail not found');
    }
});

// Health endpoint
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Global error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
