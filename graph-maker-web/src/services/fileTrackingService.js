const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FileTrackingService {
    constructor() {
        this.dbPath = path.join(__dirname, '../../data/file-tracking.json');
        this.processedFiles = {};
        this.initialize();
    }

    /**
     * Initialize the file tracking service
     */
    initialize() {
        try {
            // Create the data directory if it doesn't exist
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Load existing file records
            if (fs.existsSync(this.dbPath)) {
                const data = fs.readFileSync(this.dbPath, 'utf8');
                this.processedFiles = JSON.parse(data);
                console.log(`Loaded ${Object.keys(this.processedFiles).length} processed file records`);
            } else {
                this.processedFiles = {};
                // Create an empty tracking file
                this.saveTrackingData();
                console.log('Initialized new file tracking database');
            }
        } catch (error) {
            console.error('Error initializing file tracking service:', error);
            this.processedFiles = {};
        }
    }

    /**
     * Save the tracking data to disk
     */
    saveTrackingData() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.processedFiles, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving file tracking data:', error);
        }
    }

    /**
     * Generate a unique identifier for a file based on its path and contents
     * @param {string} filePath - Path to the file
     * @returns {string} - Unique file identifier
     */
    generateFileId(filePath) {
        try {
            // Use path as a primary identifier
            const fileStats = fs.statSync(filePath);
            const fileSize = fileStats.size;
            const modTime = fileStats.mtime.toISOString();

            // Create a unique ID based on file path, size and modification time
            const idSource = `${filePath}:${fileSize}:${modTime}`;
            return crypto.createHash('md5').update(idSource).digest('hex');
        } catch (error) {
            console.error('Error generating file ID:', error);
            // If cannot generate ID, use the file path itself
            return crypto.createHash('md5').update(filePath).digest('hex');
        }
    }

    /**
     * Check if a file has been processed before
     * @param {string} filePath - Path to the file
     * @returns {boolean} - True if file has been processed successfully
     */
    isFileProcessed(filePath) {
        const fileId = this.generateFileId(filePath);
        return this.processedFiles[fileId]?.status === 'processed';
    }

    /**
     * Get all processed files
     * @returns {Object} - Dictionary of processed files
     */
    getAllProcessedFiles() {
        return this.processedFiles;
    }

    /**
     * Get files by folder path
     * @param {string} folderPath - Path to the folder
     * @returns {Array} - Array of file records in the folder
     */
    getFilesByFolder(folderPath) {
        const normalizedFolderPath = path.normalize(folderPath);
        return Object.values(this.processedFiles).filter(file => 
            file.folderPath && path.normalize(file.folderPath) === normalizedFolderPath
        );
    }

    /**
     * Record a file as being processed
     * @param {string} filePath - Path to the file
     * @param {string} folderPath - Path to the parent folder (if part of folder upload)
     * @param {string} originalName - Original name of the file
     * @param {boolean} success - Whether processing was successful
     * @param {Object} metadata - Additional metadata about the file
     */
    recordFile(filePath, folderPath, originalName, success, metadata = {}) {
        const fileId = this.generateFileId(filePath);
        
        this.processedFiles[fileId] = {
            id: fileId,
            filePath: filePath,
            folderPath: folderPath,
            originalName: originalName,
            status: success ? 'processed' : 'failed',
            processedAt: new Date().toISOString(),
            metadata: metadata
        };

        this.saveTrackingData();
        return fileId;
    }

    /**
     * Clear all record of processed files
     */
    clearAllRecords() {
        this.processedFiles = {};
        this.saveTrackingData();
        console.log('Cleared all file tracking records');
    }

    /**
     * Clear records for a specific folder
     * @param {string} folderPath - Path to the folder
     */
    clearFolderRecords(folderPath) {
        const normalizedFolderPath = path.normalize(folderPath);
        const filesToRemove = [];
        
        // Identify files to remove
        for (const [id, file] of Object.entries(this.processedFiles)) {
            if (file.folderPath && path.normalize(file.folderPath) === normalizedFolderPath) {
                filesToRemove.push(id);
            }
        }
        
        // Remove the files
        filesToRemove.forEach(id => delete this.processedFiles[id]);
        
        this.saveTrackingData();
        console.log(`Cleared ${filesToRemove.length} records for folder: ${normalizedFolderPath}`);
        return filesToRemove.length;
    }
}

module.exports = new FileTrackingService(); 