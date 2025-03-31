const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

/**
 * Enhanced PDF processing service
 * - Extracts text from PDFs
 * - Splits content into meaningful chunks
 * - Preserves metadata and structure
 */
class PdfService {
    /**
     * Extract text and metadata from a PDF file
     * @param {string} filePath - Path to the PDF file
     * @returns {Promise<{text: string, metadata: Object}>}
     */
    async extractText(filePath) {
        try {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdf(dataBuffer);
            
            const metadata = {
                fileName: path.basename(filePath),
                numPages: data.numpages,
                info: data.info,
                fileSize: dataBuffer.length,
                creationDate: new Date().toISOString()
            };
            
            return {
                text: data.text,
                metadata
            };
        } catch (error) {
            console.error(`Error extracting text from PDF: ${error.message}`);
            throw new Error(`Failed to extract text from PDF: ${error.message}`);
        }
    }

    /**
     * Split PDF text into semantic chunks for processing
     * @param {string} text - The extracted PDF text
     * @param {Object} metadata - Metadata from the PDF
     * @param {Object} options - Chunking options
     * @returns {Array<{text: string, metadata: Object}>}
     */
    chunkText(text, metadata, options = {}) {
        const {
            maxChunkSize = 2000,
            overlapSize = 200,
            preserveParagraphs = true
        } = options;
        
        const chunks = [];
        
        // Split text into paragraphs or sections
        let paragraphs = [];
        if (preserveParagraphs) {
            // Split by double newlines to preserve paragraph structure
            paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        } else {
            // Split by sentences if paragraphs aren't important
            paragraphs = text.split(/(?<=[.!?])\s+/).filter(p => p.trim().length > 0);
        }
        
        let currentChunk = '';
        let chunkIndex = 0;
        let startPage = 1;
        let currentPosition = 0;
        
        for (const paragraph of paragraphs) {
            // If adding this paragraph would exceed max size, create a new chunk
            if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
                chunks.push({
                    text: currentChunk,
                    metadata: {
                        ...metadata,
                        chunk_index: chunkIndex,
                        page_number: startPage,
                        chunk_position: currentPosition,
                        is_complete_section: false
                    }
                });
                
                // Start new chunk with overlap from the end of the previous chunk
                const overlapText = currentChunk.length > overlapSize 
                    ? currentChunk.slice(-overlapSize) 
                    : currentChunk;
                    
                currentChunk = overlapText + paragraph;
                chunkIndex++;
                currentPosition += currentChunk.length - overlapText.length;
            } else {
                currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + paragraph;
            }
        }
        
        // Add the final chunk
        if (currentChunk.length > 0) {
            chunks.push({
                text: currentChunk,
                metadata: {
                    ...metadata,
                    chunk_index: chunkIndex,
                    page_number: startPage,
                    chunk_position: currentPosition,
                    is_complete_section: true
                }
            });
        }
        
        return chunks;
    }
}

module.exports = new PdfService(); 