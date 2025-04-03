const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const graphProcessorService = require('../services/graphProcessorService');
const fileTrackingService = require('../services/fileTrackingService');

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

// File filter for PDF and Word document files only
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'application/pdf',                    // PDF
        'application/msword',                 // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'  // .docx
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only PDF and Word documents are allowed'), false);
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
    { name: 'file', maxCount: 20 },
    { name: 'pdf', maxCount: 20 }
]);

// Global tracking for active processing jobs
const activeProcessingJobs = new Map();

// Add this function for cancelling a processing job
function cancelProcessingJob(clientId) {
    console.log(`Cancelling processing job for client ${clientId}`);
    
    const job = activeProcessingJobs.get(clientId);
    if (!job) {
        console.log(`No active job found for client ${clientId}`);
        return { success: false, message: 'No active processing job found' };
    }
    
    // Set the cancelled flag
    job.cancelled = true;
    console.log(`Set cancelled flag for job ${clientId}`);
    
    // Update the processing status
    saveProcessingStatus(clientId, {
        status: 'cancelled',
        message: 'Processing cancelled by user',
        timestamp: Date.now()
    });
    
    // Try to complete the progress if there's an active SSE connection
    try {
        completeProgress(clientId, {
            success: false,
            error: 'Processing cancelled by user',
            message: 'Upload process was cancelled'
        });
    } catch (err) {
        console.error(`Error completing progress for cancelled job ${clientId}:`, err);
    }
    
    return { success: true, message: 'Processing job cancelled' };
}

// Modify the processFolderFiles function to check for cancellation
async function processFolderFiles(folderPath, options) {
    // Create job tracking object
    const jobId = options.clientId || `job-${Date.now()}`;
    const job = { 
        id: jobId,
        folderPath,
        startTime: Date.now(),
        cancelled: false
    };
    
    // Register job
    activeProcessingJobs.set(jobId, job);
    
    try {
        console.log(`Starting processFolderFiles with folder: ${folderPath}`);
        console.log(`Options:`, JSON.stringify(options, (key, value) => 
            key === 'progressCallback' ? 'function exists' : value));
        
        // Send initial progress update
        if (options.progressCallback) {
            console.log(`Sending initial progress update for folder scanning`);
            options.progressCallback({
                currentFile: 0,
                totalFiles: 0,
                status: 'Scanning folder for files...'
            });
        } else {
            console.warn(`No progressCallback function provided in options`);
        }
        
        // Get all PDF and Word document files in the folder
        console.log(`Reading directory: ${folderPath}`);
        let folderContents;
        try {
            folderContents = fs.readdirSync(folderPath);
            console.log(`Found ${folderContents.length} items in folder`);
            console.log(`Folder contents: ${folderContents.join(', ')}`);
        } catch (readError) {
            console.error(`Error reading directory ${folderPath}:`, readError);
            throw new Error(`Failed to read directory: ${readError.message}`);
        }
        
        // Filter for PDF and Word documents
        const files = folderContents
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ext === '.pdf' || ext === '.doc' || ext === '.docx';
            })
            .map(file => path.join(folderPath, file));
        
        console.log(`Found ${files.length} PDF/Word files in folder`);
        if (files.length > 0) {
            console.log(`First few files: ${files.slice(0, 3).join(', ')}`);
        }
        
        // Verify files actually exist and are readable
        for (let i = 0; i < Math.min(files.length, 3); i++) {
            try {
                const stats = fs.statSync(files[i]);
                console.log(`File ${files[i]} exists, size: ${stats.size} bytes`);
            } catch (err) {
                console.error(`Error accessing file ${files[i]}:`, err);
            }
        }
        
        // Check for cancellation after file discovery
        if (job.cancelled) {
            console.log(`Job ${jobId} was cancelled after file discovery`);
            return {
                success: false,
                message: 'Processing cancelled by user',
                files: []
            };
        }
        
        // Send file count update immediately
        if (options.progressCallback) {
            console.log(`Sending file count progress update: ${files.length} files found`);
            options.progressCallback({
                currentFile: 0,
                totalFiles: files.length,
                status: `Found ${files.length} PDF/Word files to process`,
                filesFound: files.length,
                processingStarted: true
            });
        }
        
        if (files.length === 0) {
            console.log(`No PDF or Word files found in folder, returning early`);
            // Clean up job tracking
            activeProcessingJobs.delete(jobId);
            
            return {
                success: true,
                message: 'No PDF or Word document files found in folder',
                files: []
            };
        }
        
        // Process each file
        const results = [];
        let skippedCount = 0;
        let processedCount = 0;
        let errorCount = 0;
        let tooSmallCount = 0;
        let currentFileNumber = 0;
        const totalFileCount = files.length;
        
        for (const filePath of files) {
            // Check for cancellation before processing each file
            if (job.cancelled) {
                console.log(`Job ${jobId} was cancelled during file processing`);
                
                // Clean up job tracking
                activeProcessingJobs.delete(jobId);
                
                return {
                    success: false,
                    message: 'Processing cancelled by user',
                    files: results,
                    totalFiles: totalFileCount,
                    processedFiles: currentFileNumber,
                    skippedCount,
                    errorCount
                };
            }
            
            currentFileNumber++;
            const fileName = path.basename(filePath);
            
            console.log(`Processing file ${currentFileNumber}/${totalFileCount}: ${fileName}`);
            
            // Update progress
            if (options.progressCallback) {
                console.log(`Sending progress update for file ${currentFileNumber}/${totalFileCount}`);
                try {
                    options.progressCallback({
                        currentFile: currentFileNumber,
                        totalFiles: totalFileCount,
                        status: `Processing file ${currentFileNumber}/${totalFileCount}: ${fileName}`,
                        fileName: fileName,
                        filesFound: totalFileCount,
                        percentComplete: Math.floor((currentFileNumber / totalFileCount) * 100)
                    });
                } catch (progressError) {
                    console.error(`Error sending progress update:`, progressError);
                }
            }
            
            // Check file size - skip if smaller than 10KB
            const fileStats = fs.statSync(filePath);
            if (fileStats.size < 10 * 1024) {
                console.log(`Skipping file smaller than 10KB: ${fileName} (${fileStats.size} bytes)`);
                tooSmallCount++;
                results.push({
                    file: {
                        name: fileName,
                        path: filePath,
                        size: fileStats.size
                    },
                    skipped: true,
                    success: true,
                    message: 'File too small (< 10KB)'
                });
                continue;
            }
            
            // Check if file has already been processed
            if (fileTrackingService.isFileProcessed(filePath)) {
                console.log(`Skipping already processed file: ${fileName}`);
                skippedCount++;
                results.push({
                    file: {
                        name: fileName,
                        path: filePath,
                        size: fileStats.size
                    },
                    skipped: true,
                    success: true,
                    message: 'File was already processed'
                });
                continue;
            }
            
            try {
                console.log(`Processing file: ${fileName}`);
                const result = await graphProcessorService.processPDF(filePath, fileName, options);
                
                // Record successful processing
                fileTrackingService.recordFile(
                    filePath, 
                    folderPath, 
                    fileName, 
                    true, 
                    { processingTime: result.processingTime }
                );
                
                processedCount++;
                results.push({
                    file: {
                        name: fileName,
                        path: filePath,
                        size: fs.statSync(filePath).size
                    },
                    results: result,
                    success: true
                });
            } catch (error) {
                console.error(`Error processing file ${fileName}:`, error);
                
                // Record failed processing
                fileTrackingService.recordFile(
                    filePath, 
                    folderPath, 
                    fileName, 
                    false, 
                    { error: error.message }
                );
                
                errorCount++;
                results.push({
                    file: {
                        name: fileName,
                        path: filePath,
                        size: fs.statSync(filePath).size
                    },
                    error: error.message,
                    success: false
                });
            }
        }
        
        // Clean up job tracking
        activeProcessingJobs.delete(jobId);
        
        return {
            success: true,
            message: `Processed ${processedCount} files, skipped ${skippedCount}, errors ${errorCount}`,
            files: results,
            totalFiles: totalFileCount,
            processedFiles: processedCount,
            skippedCount: skippedCount,
            errorCount: errorCount,
            tooSmallCount: tooSmallCount
        };
    } catch (error) {
        console.error(`Error processing folder ${folderPath}:`, error);
        
        // Clean up job tracking
        activeProcessingJobs.delete(jobId);
        
        throw error;
    }
}

router.post('/upload', fileFields, async (req, res) => {
    // Create a function to handle fatal errors in a consistent way
    const handleFatalError = (error, progressId = null) => {
        console.error('Fatal error in upload process:', error);
        
        // If we have a progress ID, try to send the error through the SSE channel
        if (progressId && uploadProgressMap.has(progressId)) {
            try {
                completeProgress(progressId, {
                    success: false,
                    error: error.message || 'Unknown server error'
                });
            } catch (progressError) {
                console.error('Failed to send error through progress channel:', progressError);
            }
        }
        
        // Always respond with a standard JSON error too
        return res.status(500).json({
            success: false,
            error: error.message || 'Unknown server error'
        });
    };

    try {
        // Get the progress tracking ID if provided
        const progressId = req.query.progressId || req.body.progressId;
        console.log(`Upload request received with progressId: ${progressId || 'none'}`);
        console.log(`Request body keys: ${Object.keys(req.body).join(', ')}`);
        console.log(`Request body folderPath: ${req.body.folderPath || 'not provided'}`);
        
        let progressCallback = null;
        
        // Create progress callback if we have a progress ID
        if (progressId && uploadProgressMap.has(progressId)) {
            console.log(`Setting up progress callback for ID: ${progressId}`);
            progressCallback = (progress) => {
                try {
                    console.log(`Progress callback called with:`, JSON.stringify(progress));
                    updateProgress(progressId, progress);
                } catch (progressError) {
                    console.error(`Error in progress callback:`, progressError);
                }
            };
            
            // Send initial update to confirm the callback is working
            try {
                updateProgress(progressId, {
                    currentFile: 0,
                    totalFiles: 0,
                    status: 'Upload received, preparing to process'
                });
            } catch (initialUpdateError) {
                console.error(`Error sending initial progress update:`, initialUpdateError);
                // Continue despite this error, as it's not fatal
            }
        } else if (progressId) {
            console.warn(`Progress ID ${progressId} provided but no active connection found in uploadProgressMap`);
            console.log(`Current progress IDs in map: ${Array.from(uploadProgressMap.keys()).join(', ')}`);
        }
        
        // Get processing options from request
        const options = {
            parallelProcessing: req.body.parallelProcessing === 'true',
            concurrencyLimit: parseInt(req.body.concurrencyLimit || '3'),
            llmProvider: req.body.llmProvider || process.env.LLM_PROVIDER || 'openai',
            progressCallback
        };
        
        console.log(`Processing options: ${JSON.stringify(options, (key, value) => 
            key === 'progressCallback' ? 'function exists' : value)}`);
        
        // Check if a folder path was provided
        if (req.body.folderPath) {
            let folderPath = req.body.folderPath.trim();
            console.log(`Processing folder (raw path): ${folderPath}`);
            
            // Fix common path issues
            // Remove any quotes that might have been added
            folderPath = folderPath.replace(/^["']|["']$/g, '');
            // Normalize path separators
            folderPath = path.normalize(folderPath);
            
            // Handle ~ in path (Unix home directory)
            if (folderPath.startsWith('~')) {
                folderPath = folderPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
            }
            
            // Convert to lowercase on Windows for case insensitivity
            if (process.platform === 'win32') {
                folderPath = folderPath.toLowerCase();
            }
            
            console.log(`Processing folder (normalized): ${folderPath}`);
            
            // Try to resolve the path to absolute
            try {
                const resolvedPath = path.resolve(folderPath);
                console.log(`Resolved path: ${resolvedPath}`);
                if (resolvedPath !== folderPath) {
                    folderPath = resolvedPath;
                }
            } catch (resolveError) {
                console.warn(`Could not resolve path: ${resolveError.message}`);
                // Continue with original path
            }
            
            // Try to stat the folder to check if it exists and is accessible
            let folderStats;
            try {
                folderStats = fs.statSync(folderPath);
                console.log(`Folder stats:`, JSON.stringify({
                    isDirectory: folderStats.isDirectory(),
                    size: folderStats.size,
                    mode: folderStats.mode.toString(8),
                    uid: folderStats.uid,
                    gid: folderStats.gid
                }));
            } catch (statError) {
                const errorMsg = `Folder path access error: ${statError.message}`;
                console.error(errorMsg);
                
                // Send an appropriate error response
                if (progressId) {
                    completeProgress(progressId, {
                        success: false,
                        error: errorMsg
                    });
                    
                    return res.status(200).json({ 
                        success: false, 
                        error: errorMsg,
                        progressId
                    });
                } else {
                    return res.status(400).json({ 
                        success: false, 
                        error: errorMsg
                    });
                }
            }
            
            // Folder must be a directory
            if (!folderStats.isDirectory()) {
                const errorMsg = `Path exists but is not a directory: ${folderPath}`;
                console.error(errorMsg);
                
                if (progressId) {
                    completeProgress(progressId, {
                        success: false,
                        error: errorMsg
                    });
                    
                    return res.status(200).json({ 
                        success: false, 
                        error: errorMsg,
                        progressId
                    });
                } else {
                    return res.status(400).json({ 
                        success: false, 
                        error: errorMsg
                    });
                }
            }
            
            // Check if directory is readable
            try {
                const testRead = fs.readdirSync(folderPath, { withFileTypes: false });
                console.log(`Successfully read directory, found ${testRead.length} entries`);
            } catch (readError) {
                const errorMsg = `Cannot read folder contents: ${readError.message}`;
                console.error(errorMsg);
                
                if (progressId) {
                    completeProgress(progressId, {
                        success: false,
                        error: errorMsg
                    });
                    
                    return res.status(200).json({ 
                        success: false, 
                        error: errorMsg,
                        progressId
                    });
                } else {
                    return res.status(400).json({ 
                        success: false, 
                        error: errorMsg
                    });
                }
            }
            
            // Process the folder
            try {
                const results = await processFolderFiles(folderPath, options);
                
                // Send completion through progress channel
                if (progressId) {
                    try {
                        completeProgress(progressId, results);
                    } catch (completeError) {
                        console.error(`Error completing progress:`, completeError);
                    }
                    
                    // Still send a standard response to close the request
                    return res.status(200).json({ 
                        success: true, 
                        message: 'Processing completed and sent via progress channel',
                        progressId
                    });
                } else {
                    res.json(results);
                }
            } catch (processingError) {
                console.error(`Error processing folder ${folderPath}:`, processingError);
                
                const errorMsg = `Error processing folder: ${processingError.message}`;
                
                if (progressId) {
                    try {
                        completeProgress(progressId, {
                            success: false,
                            error: errorMsg
                        });
                    } catch (completeError) {
                        console.error(`Error sending completion error:`, completeError);
                    }
                    
                    return res.status(200).json({ 
                        success: false, 
                        error: errorMsg,
                        progressId
                    });
                } else {
                    return res.status(500).json({ 
                        success: false, 
                        error: errorMsg
                    });
                }
            }
            return;
        }
        
        // If not a folder, process individual files
        const files = req.files && ([].concat(req.files.file || [], req.files.pdf || []));
        
        if (!files || files.length === 0) {
            if (progressId) {
                // Send error through progress channel
                completeProgress(progressId, {
                    success: false,
                    error: 'No files uploaded'
                });
                
                // Still need to send a standard response to close the request
                return res.status(200).json({ 
                    success: false, 
                    error: 'No files uploaded',
                    progressId
                });
            } else {
                return res.status(400).json({ success: false, error: 'No files uploaded' });
            }
        }

        // Use the existing options object that was already defined above
        // We don't need to redeclare it
        console.log(`PDF Upload: ${files.length} files`);
        console.log(`Processing options: ${JSON.stringify(options)}`);

        // Process the PDFs 
        const results = [];
        let skippedCount = 0;
        let tooSmallCount = 0;
        let currentFileNumber = 0;
        const totalFileCount = files.length;
        
        // Send initial progress update
        if (progressCallback) {
            progressCallback({
                currentFile: 0,
                totalFiles: totalFileCount,
                status: 'Starting upload processing'
            });
        }
        
        for (const file of files) {
            currentFileNumber++;
            console.log(`Processing file: ${file.originalname}, Size: ${file.size} bytes`);
            
            // Update progress
            if (progressCallback) {
                progressCallback({
                    currentFile: currentFileNumber,
                    totalFiles: totalFileCount,
                    status: `Processing file ${currentFileNumber}/${totalFileCount}: ${file.originalname}`,
                    fileName: file.originalname,
                    filesFound: totalFileCount,
                    percentComplete: Math.floor((currentFileNumber / totalFileCount) * 100)
                });
            }
            
            // Skip files smaller than 10KB
            if (file.size < 10 * 1024) {
                console.log(`Skipping file smaller than 10KB: ${file.originalname} (${file.size} bytes)`);
                tooSmallCount++;
                results.push({
                    file: {
                        name: file.originalname,
                        path: file.path,
                        size: file.size
                    },
                    skipped: true,
                    success: true,
                    message: 'File too small (< 10KB)'
                });
                continue;
            }
            
            // Check if file has already been processed
            if (fileTrackingService.isFileProcessed(file.path)) {
                console.log(`Skipping already processed file: ${file.originalname}`);
                skippedCount++;
                results.push({
                    file: {
                        name: file.originalname,
                        path: file.path,
                        size: file.size
                    },
                    skipped: true,
                    success: true,
                    message: 'File was already processed'
                });
                continue;
            }
            
            try {
                const result = await graphProcessorService.processPDF(file.path, file.originalname, options);
                
                // Record successful processing
                fileTrackingService.recordFile(
                    file.path,
                    null, // No folder for direct upload
                    file.originalname, 
                    true, 
                    { processingTime: result.processingTime }
                );
                
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
                
                // Record failed processing
                fileTrackingService.recordFile(
                    file.path,
                    null, // No folder for direct upload
                    file.originalname, 
                    false, 
                    { error: error.message }
                );
                
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
        const finalResults = {
            success: true,
            message: `Processed ${results.filter(r => r.success && !r.skipped).length} of ${files.length} files successfully. Skipped ${skippedCount} previously processed files. ${tooSmallCount} files were too small (< 10KB).`,
            files: results,
            totalFiles: files.length,
            successCount: results.filter(r => r.success).length,
            failureCount: results.filter(r => !r.success).length,
            skippedCount,
            tooSmallCount
        };

        // Send completion through progress channel
        if (progressId) {
            completeProgress(progressId, finalResults);
            
            // Still send a standard response to close the request
            return res.status(200).json({ 
                success: true, 
                message: 'Processing completed and sent via progress channel',
                progressId
            });
        } else {
            res.json(finalResults);
        }
    } catch (error) {
        handleFatalError(error);
    }
});

// Process endpoint for folder upload
router.post('/upload/folder', async (req, res) => {
    const { folderPath, clientId } = req.body;
    console.log(`Received folder upload request for path: ${folderPath}, clientId: ${clientId}`);
    
    // Validate folder path
    if (!folderPath) {
        console.error('No folder path provided');
        return res.status(400).json({
            success: false,
            error: 'No folder path provided'
        });
    }
    
    try {
        // Check if folder exists and is readable
        if (!fs.existsSync(folderPath)) {
            console.error(`Folder does not exist: ${folderPath}`);
            return res.status(400).json({
                success: false,
                error: `Folder does not exist: ${folderPath}`
            });
        }
        
        const stats = fs.statSync(folderPath);
        if (!stats.isDirectory()) {
            console.error(`Path is not a directory: ${folderPath}`);
            return res.status(400).json({
                success: false,
                error: `Path is not a directory: ${folderPath}`
            });
        }
        
        // Send initial response to client
        res.status(200).json({
            success: true,
            message: 'Folder processing started',
            clientId: clientId
        });
        
        // Set up progress callback
        const progressCallback = (progressData) => {
            sendProgressUpdate(clientId, progressData);
        };
        
        // Process folder files in background
        processFolderFiles(folderPath, { 
            progressCallback, 
            clientId, // Pass the clientId to track the job
            llmProvider: req.body.llmProvider || 'gemini',
            parallelProcessing: req.body.parallelProcessing === 'true',
            concurrencyLimit: parseInt(req.body.concurrencyLimit || '3', 10)
        }).then(result => {
            // Check if the job was cancelled
            if (result.success === false && result.message === 'Processing cancelled by user') {
                console.log(`Not sending completion for cancelled job ${clientId}`);
                return;
            }
            
            completeProgress(clientId, {
                success: true,
                message: `Processed ${result.files.filter(f => f.success && !f.skipped).length} of ${result.files.length} files`,
                files: result.files,
                totalFiles: result.files.length,
                successCount: result.files.filter(f => f.success && !f.skipped).length,
                skippedCount: result.files.filter(f => f.skipped).length,
                errorCount: result.files.filter(f => !f.success).length
            });
        }).catch(error => {
            console.error('Error processing folder:', error);
            completeProgress(clientId, {
                success: false,
                error: `Error processing folder: ${error.message}`,
                message: `Failed to process folder: ${error.message}`
            });
        });
    } catch (error) {
        console.error('Error handling folder upload:', error);
        return res.status(500).json({
            success: false,
            error: `Error handling folder upload: ${error.message}`
        });
    }
});

// Get list of processed files
router.get('/processed-files', (req, res) => {
    try {
        const files = fileTrackingService.getAllProcessedFiles();
        res.json({
            success: true,
            files: Object.values(files)
        });
    } catch (error) {
        console.error('Error getting processed files:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get list of processed files in a folder
router.get('/processed-files/folder', (req, res) => {
    try {
        const { folderPath } = req.query;
        
        if (!folderPath) {
            return res.status(400).json({ 
                success: false, 
                error: 'Folder path is required'
            });
        }
        
        const files = fileTrackingService.getFilesByFolder(folderPath);
        res.json({
            success: true,
            folderPath,
            files
        });
    } catch (error) {
        console.error('Error getting processed files by folder:', error);
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

// Map to store active upload progress data
const uploadProgressMap = new Map();

// Progress tracking endpoint using Server-Sent Events
router.get('/progress', (req, res) => {
    // Get a unique ID for this upload session
    const requestId = req.query.id;
    if (!requestId) {
        return res.status(400).json({ error: 'No progress ID provided' });
    }
    
    console.log(`Setting up SSE progress connection for client ID: ${requestId}`);
    
    // Set up SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    // Send initial connection message
    res.write(`event: connected\ndata: {"requestId":"${requestId}"}\n\n`);
    
    // Store the response object so we can send updates to it
    uploadProgressMap.set(requestId, {
        res,
        lastUpdate: Date.now(),
        progress: {
            currentFile: 0,
            totalFiles: 0,
            status: 'Connected, waiting for upload to start'
        }
    });
    
    console.log(`SSE connection established for client ID: ${requestId}`);
    
    // Handle client disconnect
    req.on('close', () => {
        console.log(`Client disconnected from progress updates for ID: ${requestId}`);
        uploadProgressMap.delete(requestId);
    });
    
    // Keep the connection alive with a ping every 15 seconds
    const pingInterval = setInterval(() => {
        if (uploadProgressMap.has(requestId)) {
            try {
                console.log(`Sending ping to client ${requestId}`);
                res.write(`:ping ${Date.now()}\n\n`);
            } catch (error) {
                console.error(`Error sending ping to client ${requestId}:`, error);
                clearInterval(pingInterval);
                uploadProgressMap.delete(requestId);
            }
        } else {
            clearInterval(pingInterval);
        }
    }, 15000);
});

// Function to update progress for a specific request
function updateProgress(requestId, progress) {
    if (uploadProgressMap.has(requestId)) {
        const session = uploadProgressMap.get(requestId);
        session.progress = progress;
        session.lastUpdate = Date.now();
        
        console.log(`Sending progress update to client ${requestId}:`, JSON.stringify(progress));
        
        try {
            session.res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
            // Send a flush to ensure data is sent immediately
            if (typeof session.res.flush === 'function') {
                session.res.flush();
            }
        } catch (error) {
            console.error(`Error sending progress update to client ${requestId}:`, error);
            // Clean up the connection if we can't write to it
            uploadProgressMap.delete(requestId);
        }
    } else {
        console.warn(`Can't update progress: client ${requestId} not found`);
    }
}

// Global progress tracking
const processingStatus = {};

// Add this function for the status endpoint
function saveProcessingStatus(clientId, status) {
    processingStatus[clientId] = {
        ...status,
        timestamp: Date.now()
    };
    
    // Clean up old status objects (older than 1 hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    Object.keys(processingStatus).forEach(id => {
        if (processingStatus[id].timestamp < oneHourAgo || 
            (processingStatus[id].status === 'complete' && processingStatus[id].timestamp < Date.now() - (5 * 60 * 1000))) {
            delete processingStatus[id];
        }
    });
}

// Update the completeProgress function to save status
function completeProgress(clientId, data) {
    if (uploadProgressMap.has(clientId)) {
        const session = uploadProgressMap.get(clientId);
        
        try {
            // Format data properly before sending
            let eventType = 'complete';
            
            // If there's an error, send an error event instead of complete
            if (data && data.success === false && data.error) {
                eventType = 'error';
                console.log(`Sending error event to client ${clientId}: ${data.error}`);
            } else {
                console.log(`Sending completion event to client ${clientId}`);
            }

            // Ensure data is properly JSON-serializable
            let safeData;
            try {
                safeData = JSON.stringify(data, (key, value) => {
                    // Handle circular references and functions
                    if (typeof value === 'function') {
                        return 'function';
                    }
                    return value;
                });
            } catch (jsonError) {
                console.error(`Error stringifying data for client ${clientId}:`, jsonError);
                safeData = JSON.stringify({
                    success: false,
                    error: "Failed to serialize response data: " + jsonError.message
                });
                eventType = 'error';
            }

            // Send the event
            session.res.write(`event: ${eventType}\ndata: ${safeData}\n\n`);

            // Always give a little time before closing the connection
            setTimeout(() => {
                try {
                    session.res.end();
                    console.log(`Closed SSE connection for client ${clientId}`);
                } catch (endError) {
                    console.error(`Error ending response for ${clientId}:`, endError);
                }
                
                // Remove from the map
                uploadProgressMap.delete(clientId);
            }, 500);

            // Save status before sending to client
            saveProcessingStatus(clientId, {
                status: data.error ? 'error' : 'complete',
                message: data.message || (data.error ? 'Error processing files' : 'Processing complete'),
                error: data.error,
                filesProcessed: data.filesProcessed,
                totalFiles: data.totalFiles
            });
        } catch (completeError) {
            console.error(`Error completing progress:`, completeError);
        }
    } else {
        console.warn(`Can't complete progress: client ${clientId} not found`);
    }
}

// Send progress update
function sendProgressUpdate(clientId, data) {
    if (uploadProgressMap.has(clientId)) {
        const session = uploadProgressMap.get(clientId);
        
        try {
            // Save status even if client connection is gone
            saveProcessingStatus(clientId, {
                status: 'processing',
                ...data,
                timestamp: Date.now()
            });
            
            if (!session) {
                console.log(`Can't send progress update: client ${clientId} not found`);
                return;
            }
            
            // Send progress update
            session.res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
            console.error('Error sending progress update:', err);
        }
    } else {
        console.warn(`Can't send progress update: client ${clientId} not found`);
    }
}

// Add a new status endpoint
router.get('/status/:clientId', (req, res) => {
    const { clientId } = req.params;
    
    if (!processingStatus[clientId]) {
        return res.json({
            status: 'unknown',
            message: 'No processing information found for this ID'
        });
    }
    
    res.json(processingStatus[clientId]);
});

// Clear all file tracking records
router.post('/clear-tracking', (req, res) => {
    try {
        fileTrackingService.clearAllRecords();
        res.json({
            success: true,
            message: 'All file tracking records cleared'
        });
    } catch (error) {
        console.error('Error clearing file tracking records:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear file tracking records for a specific folder
router.post('/clear-tracking/folder', (req, res) => {
    try {
        const { folderPath } = req.body;
        
        if (!folderPath) {
            return res.status(400).json({ 
                success: false, 
                error: 'Folder path is required'
            });
        }
        
        const count = fileTrackingService.clearFolderRecords(folderPath);
        res.json({
            success: true,
            message: `Cleared ${count} file tracking records for folder: ${folderPath}`,
            count
        });
    } catch (error) {
        console.error('Error clearing folder tracking records:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add endpoint for cancelling an upload
router.post('/cancel/:clientId', (req, res) => {
    const { clientId } = req.params;
    console.log(`Received cancel request for client ID: ${clientId}`);
    
    if (!clientId) {
        return res.status(400).json({ success: false, message: 'Client ID is required' });
    }
    
    const result = cancelProcessingJob(clientId);
    
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(404).json(result);
    }
});

// Export the router
module.exports = router;