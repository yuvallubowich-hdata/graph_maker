const pdfService = require('./pdfService');
const nlpService = require('./nlpService');
const entityResolutionService = require('./entityResolutionService');
const neo4jService = require('./neo4jService');

/**
 * Graph Processor Service
 * 
 * Orchestrates the entire process of:
 * 1. Extracting text from PDFs
 * 2. Processing text with NLP to extract entities and relationships
 * 3. Resolving and deduplicating entities
 * 4. Saving everything to Neo4j
 */
class GraphProcessorService {
    constructor() {
        this.pdfService = pdfService;
        this.nlpService = nlpService;
        this.entityResolution = entityResolutionService;
        this.neo4jService = neo4jService;
        this.metrics = {
            // Overall timing
            processingStartTime: 0,
            processingEndTime: 0,
            // Detailed metrics
            extractionTime: 0,
            chunkingTime: 0,
            nlpTotalTime: 0,
            entityExtractTime: 0,
            relationshipExtractTime: 0,
            temporalExtractTime: 0,
            entityResolutionTime: 0,
            neo4jSaveTime: 0,
            // Counts
            chunkCount: 0,
            entityCount: 0,
            relationshipCount: 0,
            // DB stats
            dbWrites: 0
        };
    }

    /**
     * Process a PDF file and add its contents to the knowledge graph
     * @param {string} filePath - Path to the PDF file
     * @param {string} originalFilename - Original filename
     * @param {object} options - Processing options
     * @returns {Promise<object>} - Processing results
     */
    async processPDF(filePath, originalFilename, options = {}) {
        console.log(`Processing PDF: ${originalFilename}`);
        // Reset metrics
        this.resetMetrics();
        this.metrics.processingStartTime = Date.now();
        
        try {
            // Step 1: Extract text from PDF
            console.time('pdf-text-extraction');
            const extractStartTime = Date.now();
            const { text, metadata } = await this.pdfService.extractText(filePath);
            this.metrics.extractionTime = Date.now() - extractStartTime;
            console.timeEnd('pdf-text-extraction');
            
            // Step 2: Chunk the text
            console.time('text-chunking');
            const chunkStartTime = Date.now();
            const chunks = this.pdfService.chunkText(text, {
                ...metadata,
                originalFilename
            }, options.chunking);
            this.metrics.chunkingTime = Date.now() - chunkStartTime;
            this.metrics.chunkCount = chunks.length;
            console.timeEnd('text-chunking');
            
            console.log(`Extracted ${chunks.length} chunks from PDF`);
            
            // Step 3: Process each chunk with NLP
            const allRelationships = [];
            const documentNode = {
                id: `doc_${Date.now()}`,
                name: originalFilename,
                type: 'Document',
                description: `Document file: ${originalFilename}`,
                aliases: [],
                content: text.substring(0, 1000) + (text.length > 1000 ? '...' : ''),
                file_path: filePath,
                created_date: new Date().toISOString(),
                metadata: metadata
            };
            
            // Add document to the resolved entities
            this.entityResolution.addEntity(documentNode);
            
            // Process chunks (potentially in parallel)
            console.time('chunk-processing');
            const chunkProcessingStartTime = Date.now();
            
            // Decide whether to process sequentially or in parallel based on options
            if (options.parallelProcessing) {
                // Process chunks in parallel with concurrency limit
                const concurrencyLimit = options.concurrencyLimit || 3;
                console.log(`Processing chunks in parallel with concurrency limit: ${concurrencyLimit}`);
                
                // Use a simple concurrency limiter
                const results = [];
                for (let i = 0; i < chunks.length; i += concurrencyLimit) {
                    const batch = chunks.slice(i, i + concurrencyLimit);
                    const batchPromises = batch.map((chunk, index) => 
                        this._processChunk(chunk, i + index, chunks.length, documentNode, options)
                    );
                    
                    const batchResults = await Promise.all(batchPromises);
                    results.push(...batchResults);
                }
                
                // Collect relationships from all chunks
                results.forEach(result => {
                    if (result && result.relationships) {
                        allRelationships.push(...result.relationships);
                    }
                });
            } else {
                // Process chunks sequentially
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    console.log(`Processing chunk ${i + 1}/${chunks.length}`);
                    
                    // Process the chunk
                    const result = await this._processChunk(chunk, i, chunks.length, documentNode, options);
                    if (result && result.relationships) {
                        allRelationships.push(...result.relationships);
                    }
                }
            }
            
            this.metrics.nlpTotalTime = Date.now() - chunkProcessingStartTime;
            console.timeEnd('chunk-processing');
            
            // Get all unique resolved entities
            console.time('entity-resolution');
            const entityResolutionStartTime = Date.now();
            const finalEntities = this.entityResolution.getAllEntities();
            this.metrics.entityResolutionTime = Date.now() - entityResolutionStartTime;
            console.timeEnd('entity-resolution');
            
            // Create a mapping of entity names to canonical IDs
            const entityNameToIdMap = new Map();
            finalEntities.forEach(entity => {
                entityNameToIdMap.set(entity.name.toLowerCase(), entity.id);
                // Also map aliases
                (entity.aliases || []).forEach(alias => {
                    entityNameToIdMap.set(alias.toLowerCase(), entity.id);
                });
            });
            
            // Update relationships to ensure they use the final canonical entity IDs
            const updatedRelationships = allRelationships.map(rel => {
                // If the IDs are already valid entity IDs, keep them
                if (finalEntities.some(e => e.id === rel.source) && finalEntities.some(e => e.id === rel.target)) {
                    return rel;
                }
                
                // Otherwise, try to find the canonical IDs based on entity names
                const sourceEntity = finalEntities.find(e => e.id === rel.source);
                const targetEntity = finalEntities.find(e => e.id === rel.target);
                
                if (sourceEntity && targetEntity) {
                    return rel; // Both entities exist with valid IDs
                }
                
                // If not found directly, look up entities by name
                if (!sourceEntity || !targetEntity) {
                    console.log(`Relationship may use non-canonical IDs: ${rel.source} -> ${rel.target}`);
                    
                    // First, try to get the source and target names if they're entities that were unresolved
                    let sourceId = rel.source;
                    let targetId = rel.target;
                    
                    // Check if we need to fix the source ID
                    if (!finalEntities.some(e => e.id === sourceId)) {
                        // Try to find the source entity by ID in the original entities
                        const sourceName = rel.sourceName || sourceId;
                        
                        // Try to find a matching canonical entity by name
                        const normalizedSourceName = sourceName.toLowerCase();
                        const canonicalSourceId = entityNameToIdMap.get(normalizedSourceName);
                        
                        if (canonicalSourceId) {
                            console.log(`Fixed relationship source: "${sourceName}" → ID ${canonicalSourceId}`);
                            sourceId = canonicalSourceId;
                        } else {
                            console.log(`Could not find canonical ID for source: "${sourceName}"`);
                            return null; // Skip this relationship
                        }
                    }
                    
                    // Check if we need to fix the target ID
                    if (!finalEntities.some(e => e.id === targetId)) {
                        // Try to find the target entity by ID in the original entities
                        const targetName = rel.targetName || targetId;
                        
                        // Try to find a matching canonical entity by name
                        const normalizedTargetName = targetName.toLowerCase();
                        const canonicalTargetId = entityNameToIdMap.get(normalizedTargetName);
                        
                        if (canonicalTargetId) {
                            console.log(`Fixed relationship target: "${targetName}" → ID ${canonicalTargetId}`);
                            targetId = canonicalTargetId;
                        } else {
                            console.log(`Could not find canonical ID for target: "${targetName}"`);
                            return null; // Skip this relationship
                        }
                    }
                    
                    // Update the relationship with the corrected IDs
                    return {
                        ...rel,
                        source: sourceId,
                        target: targetId,
                        // Keep original data for debugging
                        originalSource: rel.source,
                        originalTarget: rel.target
                    };
                }
                
                return rel;
            }).filter(Boolean); // Remove null entries
            
            // Add debug logging for relationship entity IDs
            console.log('Verifying relationship entity IDs...');
            const entityIdsInRelationships = new Set();
            updatedRelationships.forEach(rel => {
                entityIdsInRelationships.add(rel.source);
                entityIdsInRelationships.add(rel.target);
            });
            console.log(`Unique entity IDs in relationships: ${entityIdsInRelationships.size}`);
            console.log(`Entity IDs in finalEntities: ${finalEntities.length}`);
            
            // Verify that all entity IDs in relationships exist in finalEntities
            const finalEntityIds = new Set(finalEntities.map(e => e.id));
            const missingIds = [...entityIdsInRelationships].filter(id => !finalEntityIds.has(id));
            
            if (missingIds.length > 0) {
                console.log(`Warning: ${missingIds.length} entity IDs in relationships not found in finalEntities`);
                console.log('First 5 missing IDs:', missingIds.slice(0, 5));
            } else {
                console.log('All entity IDs in relationships exist in finalEntities');
            }
            
            // Step 4: Save everything to Neo4j
            console.log(`Saving ${finalEntities.length} entities and ${updatedRelationships.length} relationships to Neo4j`);
            
            console.time('neo4j-save');
            const neo4jSaveStartTime = Date.now();
            
            const entityResults = await this.neo4jService.saveEntities(finalEntities);
            const relationshipResults = await this.neo4jService.saveRelationships(updatedRelationships);
            
            this.metrics.neo4jSaveTime = Date.now() - neo4jSaveStartTime;
            console.timeEnd('neo4j-save');
            
            // Update final metrics
            this.metrics.processingEndTime = Date.now();
            this.metrics.entityCount = finalEntities.length;
            this.metrics.relationshipCount = updatedRelationships.length;
            
            // Print performance metrics
            this._logPerformanceMetrics();
            
            // Step 5: Return results
            return {
                document: documentNode,
                entities: {
                    total: finalEntities.length,
                    created: entityResults.created,
                    merged: entityResults.merged,
                    errors: entityResults.errors
                },
                relationships: {
                    total: updatedRelationships.length,
                    created: relationshipResults.created,
                    merged: relationshipResults.merged || 0,
                    skipped: relationshipResults.skipped || 0,
                    errors: relationshipResults.errors
                },
                performance: this._getPerformanceMetrics()
            };
        } catch (error) {
            console.error(`Error processing PDF ${originalFilename}:`, error);
            this.metrics.processingEndTime = Date.now();
            this._logPerformanceMetrics();
            throw new Error(`Failed to process PDF: ${error.message}`);
        }
    }

    /**
     * Process a single chunk of text
     * @private
     * @param {Object} chunk - Text chunk with metadata
     * @param {number} index - Chunk index
     * @param {number} totalChunks - Total number of chunks
     * @param {Object} documentNode - Document node
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} - Processing results
     */
    async _processChunk(chunk, index, totalChunks, documentNode, options = {}) {
        const chunkStartTime = Date.now();
        const chunkRelationships = [];
        
        try {
            console.log(`Processing chunk ${index + 1}/${totalChunks} (${chunk.text.length} chars) with provider: ${options.llmProvider || 'default'}`);
            
            // Extract entities
            console.time(`chunk-${index + 1}-entity-extraction`);
            const entityStartTime = Date.now();
            const extractedEntities = await this.nlpService.extractEntities(chunk.text, { llmProvider: options.llmProvider });
            const entityTime = Date.now() - entityStartTime;
            this.metrics.entityExtractTime += entityTime;
            console.timeEnd(`chunk-${index + 1}-entity-extraction`);
            console.log(`Extracted ${extractedEntities.length} entities from chunk ${index + 1} in ${entityTime}ms`);
            
            // Add document source to each entity
            const entitiesWithSource = extractedEntities.map(entity => ({
                ...entity,
                sources: [{
                    documentId: documentNode.id,
                    chunk_index: chunk.metadata.chunk_index,
                    confidence: entity.confidence || 0.8
                }]
            }));
            
            // Resolve entities
            const resolveStartTime = Date.now();
            const resolvedEntities = entitiesWithSource.map(entity => 
                this.entityResolution.addEntity(entity)
            );
            const resolveTime = Date.now() - resolveStartTime;
            console.log(`Resolved ${resolvedEntities.length} entities in ${resolveTime}ms`);
            
            // Extract relationships between entities
            console.time(`chunk-${index + 1}-relationship-extraction`);
            const relStartTime = Date.now();
            const extractedRelationships = await this.nlpService.extractRelationships(chunk.text, resolvedEntities, { llmProvider: options.llmProvider });
            const relTime = Date.now() - relStartTime;
            this.metrics.relationshipExtractTime += relTime;
            console.timeEnd(`chunk-${index + 1}-relationship-extraction`);
            console.log(`Extracted ${extractedRelationships.length} relationships from chunk ${index + 1} in ${relTime}ms`);
            
            // Add metadata to relationships and ensure we're using resolved entity IDs
            const relationshipsWithMetadata = extractedRelationships.map(rel => {
                // Find resolved source and target entities by name
                const sourceEntity = resolvedEntities.find(e => e.name === rel.source);
                const targetEntity = resolvedEntities.find(e => e.name === rel.target);
                
                if (!sourceEntity || !targetEntity) {
                    console.log(`Skipping relationship in chunk - can't find entities: ${rel.source} -> ${rel.target}`);
                    return null;
                }
                
                return {
                    ...rel,
                    source: sourceEntity.id,
                    target: targetEntity.id,
                    // Store original names for debugging
                    sourceName: sourceEntity.name,
                    targetName: targetEntity.name,
                    metadata: {
                        ...rel.metadata,
                        documentId: documentNode.id,
                        chunk_index: chunk.metadata.chunk_index,
                        confidence: rel.confidence || 0.7
                    }
                };
            }).filter(Boolean);
            
            // Add document relationships
            for (const entity of resolvedEntities) {
                chunkRelationships.push({
                    source: documentNode.id,
                    target: entity.id,
                    type: 'mentionsEntity',
                    evidence: `Document mentions ${entity.name}`,
                    confidence: 0.9,
                    // Store original names for debugging
                    sourceName: documentNode.name,
                    targetName: entity.name,
                    metadata: {
                        chunk_index: chunk.metadata.chunk_index
                    }
                });
            }
            
            // Extract temporal and sentiment information
            console.time(`chunk-${index + 1}-temporal-extraction`);
            const temporalStartTime = Date.now();
            const temporalSentiment = await this.nlpService.extractTemporalAndSentiment(chunk.text, resolvedEntities, { llmProvider: options.llmProvider });
            const temporalTime = Date.now() - temporalStartTime;
            this.metrics.temporalExtractTime += temporalTime;
            console.timeEnd(`chunk-${index + 1}-temporal-extraction`);
            
            // Process temporal information
            if (temporalSentiment.temporal && temporalSentiment.temporal.length > 0) {
                console.log(`Extracted ${temporalSentiment.temporal.length} temporal expressions in ${temporalTime}ms`);
                for (const temporal of temporalSentiment.temporal) {
                    const entityNode = resolvedEntities.find(e => e.name === temporal.entity);
                    if (entityNode) {
                        // Create a time expression entity
                        const timeEntity = this.entityResolution.addEntity({
                            name: temporal.value,
                            type: 'TimeExpression',
                            description: temporal.evidence,
                            sources: [{
                                documentId: documentNode.id,
                                chunk_index: chunk.metadata.chunk_index
                            }]
                        });
                        
                        // Add a relationship
                        chunkRelationships.push({
                            source: entityNode.id,
                            target: timeEntity.id,
                            type: 'occursAt',
                            evidence: temporal.evidence,
                            confidence: 0.8,
                            // Store original names for debugging
                            sourceName: entityNode.name,
                            targetName: timeEntity.name,
                            metadata: {
                                chunk_index: chunk.metadata.chunk_index
                            }
                        });
                    }
                }
            }
            
            // Process opinions
            if (temporalSentiment.opinions && temporalSentiment.opinions.length > 0) {
                console.log(`Extracted ${temporalSentiment.opinions.length} opinions`);
                for (const opinion of temporalSentiment.opinions) {
                    const entityNode = resolvedEntities.find(e => e.name === opinion.entity);
                    const topicNode = resolvedEntities.find(e => e.name === opinion.topic);
                    
                    if (entityNode && topicNode) {
                        chunkRelationships.push({
                            source: entityNode.id,
                            target: topicNode.id,
                            type: 'hasOpinionOn',
                            evidence: opinion.evidence,
                            confidence: 0.8,
                            value: opinion.value,
                            // Store original names for debugging
                            sourceName: entityNode.name,
                            targetName: topicNode.name,
                            metadata: {
                                chunk_index: chunk.metadata.chunk_index,
                                opinion_value: opinion.value
                            }
                        });
                    }
                }
            }
            
            // Add to the overall collections
            chunkRelationships.push(...relationshipsWithMetadata);
            
            // Log chunk processing time
            const chunkProcessingTime = Date.now() - chunkStartTime;
            console.log(`Finished chunk ${index + 1}/${totalChunks} in ${chunkProcessingTime}ms`);
            
            return { relationships: chunkRelationships };
        } catch (error) {
            console.error(`Error processing chunk ${index + 1}/${totalChunks}:`, error);
            return { relationships: chunkRelationships, error: error.message };
        }
    }

    /**
     * Reset performance metrics
     * @private
     */
    resetMetrics() {
        this.metrics = {
            processingStartTime: 0,
            processingEndTime: 0,
            extractionTime: 0,
            chunkingTime: 0,
            nlpTotalTime: 0,
            entityExtractTime: 0,
            relationshipExtractTime: 0,
            temporalExtractTime: 0,
            entityResolutionTime: 0,
            neo4jSaveTime: 0,
            chunkCount: 0,
            entityCount: 0,
            relationshipCount: 0,
            dbWrites: 0
        };
    }
    
    /**
     * Log performance metrics
     * @private
     */
    _logPerformanceMetrics() {
        const totalTime = this.metrics.processingEndTime - this.metrics.processingStartTime;
        
        console.log('\n=== PERFORMANCE METRICS ===');
        console.log(`Total processing time: ${(totalTime/1000).toFixed(2)}s`);
        console.log(`PDF extraction: ${(this.metrics.extractionTime/1000).toFixed(2)}s (${this._getPercentage(this.metrics.extractionTime, totalTime)}%)`);
        console.log(`Text chunking: ${(this.metrics.chunkingTime/1000).toFixed(2)}s (${this._getPercentage(this.metrics.chunkingTime, totalTime)}%)`);
        console.log(`NLP processing: ${(this.metrics.nlpTotalTime/1000).toFixed(2)}s (${this._getPercentage(this.metrics.nlpTotalTime, totalTime)}%)`);
        console.log(`  - Entity extraction: ${(this.metrics.entityExtractTime/1000).toFixed(2)}s (${this._getPercentage(this.metrics.entityExtractTime, this.metrics.nlpTotalTime)}% of NLP time)`);
        console.log(`  - Relationship extraction: ${(this.metrics.relationshipExtractTime/1000).toFixed(2)}s (${this._getPercentage(this.metrics.relationshipExtractTime, this.metrics.nlpTotalTime)}% of NLP time)`);
        console.log(`  - Temporal extraction: ${(this.metrics.temporalExtractTime/1000).toFixed(2)}s (${this._getPercentage(this.metrics.temporalExtractTime, this.metrics.nlpTotalTime)}% of NLP time)`);
        console.log(`Entity resolution: ${(this.metrics.entityResolutionTime/1000).toFixed(2)}s (${this._getPercentage(this.metrics.entityResolutionTime, totalTime)}%)`);
        console.log(`Neo4j save: ${(this.metrics.neo4jSaveTime/1000).toFixed(2)}s (${this._getPercentage(this.metrics.neo4jSaveTime, totalTime)}%)`);
        console.log('\n=== PROCESSING STATS ===');
        console.log(`Chunks processed: ${this.metrics.chunkCount}`);
        console.log(`Entities: ${this.metrics.entityCount}`);
        console.log(`Relationships: ${this.metrics.relationshipCount}`);
        console.log('============================\n');
    }
    
    /**
     * Get percentage of a value compared to total
     * @private
     * @param {number} value - The value
     * @param {number} total - The total
     * @returns {number} - Percentage
     */
    _getPercentage(value, total) {
        return total > 0 ? Math.round((value / total) * 100) : 0;
    }
    
    /**
     * Get performance metrics as an object
     * @private
     * @returns {Object} - Performance metrics
     */
    _getPerformanceMetrics() {
        const totalTime = this.metrics.processingEndTime - this.metrics.processingStartTime;
        
        return {
            totalTimeMs: totalTime,
            totalTimeSec: totalTime / 1000,
            pdfExtraction: {
                timeMs: this.metrics.extractionTime,
                percentage: this._getPercentage(this.metrics.extractionTime, totalTime)
            },
            textChunking: {
                timeMs: this.metrics.chunkingTime,
                percentage: this._getPercentage(this.metrics.chunkingTime, totalTime)
            },
            nlpProcessing: {
                timeMs: this.metrics.nlpTotalTime,
                percentage: this._getPercentage(this.metrics.nlpTotalTime, totalTime),
                entityExtraction: {
                    timeMs: this.metrics.entityExtractTime,
                    percentage: this._getPercentage(this.metrics.entityExtractTime, this.metrics.nlpTotalTime)
                },
                relationshipExtraction: {
                    timeMs: this.metrics.relationshipExtractTime,
                    percentage: this._getPercentage(this.metrics.relationshipExtractTime, this.metrics.nlpTotalTime)
                },
                temporalExtraction: {
                    timeMs: this.metrics.temporalExtractTime,
                    percentage: this._getPercentage(this.metrics.temporalExtractTime, this.metrics.nlpTotalTime)
                }
            },
            entityResolution: {
                timeMs: this.metrics.entityResolutionTime,
                percentage: this._getPercentage(this.metrics.entityResolutionTime, totalTime)
            },
            neo4jSave: {
                timeMs: this.metrics.neo4jSaveTime,
                percentage: this._getPercentage(this.metrics.neo4jSaveTime, totalTime)
            },
            stats: {
                chunkCount: this.metrics.chunkCount,
                entityCount: this.metrics.entityCount,
                relationshipCount: this.metrics.relationshipCount
            }
        };
    }

    /**
     * Initialize the graph database
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            console.log('Attempting to initialize graph processor...');
            
            // Test connection to Neo4j with retries
            let connected = false;
            let retries = 3;
            let lastError = null;
            
            while (!connected && retries > 0) {
                try {
                    console.log(`Connection attempt ${4-retries}/3...`);
                    connected = await this.neo4jService.testConnection();
                    if (connected) {
                        console.log('Successfully connected to Neo4j database');
                    }
                } catch (error) {
                    lastError = error;
                    console.error(`Connection attempt failed (${4-retries}/3):`, error.message);
                    retries--;
                    
                    if (retries > 0) {
                        console.log(`Retrying in 3 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            }
            
            if (!connected) {
                console.error('All connection attempts failed');
                throw new Error(`Could not connect to Neo4j database: ${lastError?.message || 'Unknown error'}`);
            }
            
            // Initialize database schema
            await this.neo4jService.initializeDatabase();
            console.log('Graph processor initialized successfully');
        } catch (error) {
            console.error('Error initializing graph processor:', error);
            throw error;
        }
    }

    /**
     * Reset the entity resolution service
     */
    resetEntityResolution() {
        this.entityResolution.reset();
        console.log('Entity resolution service reset');
    }

    /**
     * Clean up resources
     * @returns {Promise<void>}
     */
    async cleanup() {
        await this.neo4jService.close();
        console.log('Graph processor resources cleaned up');
    }
}

module.exports = new GraphProcessorService(); 