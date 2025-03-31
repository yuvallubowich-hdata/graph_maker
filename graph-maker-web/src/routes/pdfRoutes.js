const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const graphProcessorService = require('../services/graphProcessorService');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadsDir = path.join(__dirname, '../../uploads');
        
        // Create uploads directory if it doesn't exist
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Create unique filename with timestamp
        const uniqueName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
        cb(null, uniqueName);
    }
});

// File filter for PDF files only
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF files are allowed'), false);
    }
};

const upload = multer({ 
    storage, 
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB file size limit
    }
});

// Initialize graph processor
router.get('/initialize', async (req, res) => {
    try {
        await graphProcessorService.initialize();
        res.status(200).json({ message: 'Graph processor initialized successfully' });
    } catch (error) {
        console.error('Error initializing graph processor:', error);
        res.status(500).json({ error: `Failed to initialize graph processor: ${error.message}` });
    }
});

// Upload and process PDF - accept both 'file' and 'pdf' field names
const fileFields = upload.fields([
    { name: 'file', maxCount: 10 },
    { name: 'pdf', maxCount: 10 }
]);

router.post('/upload', fileFields, async (req, res) => {
    try {
        // Get files from either the 'file' or 'pdf' field
        const files = req.files && ([].concat(req.files.file || [], req.files.pdf || []));
        
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files uploaded' });
        }

        // Get processing options from request
        const options = {
            parallelProcessing: req.body.parallelProcessing === 'true',
            concurrencyLimit: parseInt(req.body.concurrencyLimit || '3'),
            llmProvider: req.body.llmProvider || process.env.LLM_PROVIDER || 'openai'
        };

        console.log(`PDF Upload: ${files.length} files`);
        console.log(`Processing options: ${JSON.stringify(options)}`);

        // Process the PDFs sequentially
        const results = [];
        for (const file of files) {
            console.log(`Processing file: ${file.originalname}, Size: ${file.size} bytes`);
            try {
                const result = await graphProcessorService.processPDF(file.path, file.originalname, options);
                results.push({
                    file: {
                        name: file.originalname,
                        path: file.path,
                        size: file.size
                    },
                    results: result,
                    success: true
                });
            } catch (error) {
                console.error(`Error processing file ${file.originalname}:`, error);
                results.push({
                    file: {
                        name: file.originalname,
                        path: file.path,
                        size: file.size
                    },
                    error: error.message,
                    success: false
                });
            }
        }

        // Return results
        res.json({
            success: true,
            message: `Processed ${results.filter(r => r.success).length} of ${files.length} files successfully`,
            files: results,
            totalFiles: files.length,
            successCount: results.filter(r => r.success).length,
            failureCount: results.filter(r => !r.success).length
        });
    } catch (error) {
        console.error('Error processing PDF uploads:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Reset entity resolution
router.post('/reset', async (req, res) => {
    try {
        graphProcessorService.resetEntityResolution();
        res.status(200).json({ message: 'Entity resolution reset successfully' });
    } catch (error) {
        console.error('Error resetting entity resolution:', error);
        res.status(500).json({ error: `Failed to reset entity resolution: ${error.message}` });
    }
});

module.exports = router; 