const neo4j = require('neo4j-driver');
const { v4: uuidv4 } = require('uuid');

class Neo4jService {
    constructor() {
        // Initialize connection to Neo4j
        if (!process.env.NEO4J_URI || !process.env.NEO4J_USER || !process.env.NEO4J_PASSWORD) {
            throw new Error('Neo4j environment variables are not configured correctly');
        }

        try {
            console.log(`Connecting to Neo4j at ${process.env.NEO4J_URI} with user ${process.env.NEO4J_USER}`);
            
            // Configure the driver with extended timeout and encryption disabled for local connections
            this.driver = neo4j.driver(
                process.env.NEO4J_URI,
                neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
                {
                    maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
                    maxConnectionPoolSize: 50,
                    connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
                    connectionTimeout: 30 * 1000, // 30 seconds
                    disableLosslessIntegers: true,
                    encrypted: process.env.NEO4J_URI.includes('neo4j+s') ? 'ENCRYPTION_ON' : 'ENCRYPTION_OFF'
                }
            );
            console.log('Neo4j driver initialized');
        } catch (error) {
            console.error('Failed to initialize Neo4j driver:', error);
            throw error;
        }
    }

    /**
     * Test the connection to Neo4j
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        const session = this.driver.session();
        try {
            console.log('Testing Neo4j connection to:', process.env.NEO4J_URI);
            console.log('Using credentials:', process.env.NEO4J_USER, '(password hidden)');
            
            const result = await session.run('RETURN 1 as n');
            console.log('Neo4j connection successful:', result.records[0].get('n'));
            return result.records.length > 0 && result.records[0].get('n') === 1;
        } catch (error) {
            console.error('Neo4j connection test failed with error:', error.message);
            console.error('Error code:', error.code);
            console.error('Error name:', error.name);
            
            if (error.code === 'Neo.ClientError.Security.Unauthorized') {
                console.error('Authentication failed. Check your Neo4j username and password.');
            } else if (error.code === 'ServiceUnavailable') {
                console.error('Neo4j service is unavailable. Make sure Neo4j is running and accessible at', process.env.NEO4J_URI);
            }
            
            throw error;
        } finally {
            await session.close();
        }
    }

    /**
     * Initialize the graph database with constraints and indexes
     * @returns {Promise<void>}
     */
    async initializeDatabase() {
        const session = this.driver.session();
        try {
            // Create constraints to ensure uniqueness of canonical entities by ID
            await session.run(`
                CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE
            `);

            // Create indexes for common entity types for faster queries
            const entityTypes = [
                'Person', 'Organization', 'EnergyCompany', 'RegulatoryBody',
                'Project', 'LegalCase', 'Document', 'Topic', 'Location', 'Facility'
            ];

            for (const type of entityTypes) {
                await session.run(`
                    CREATE INDEX IF NOT EXISTS FOR (n:${type}) ON (n.name)
                `);
            }

            // Create index on Document nodes for full text search 
            // Using correct syntax for Neo4j versions
            try {
                // Try Neo4j 4.3+ syntax first
                await session.run(`
                    CALL db.index.fulltext.createIfNotExists(
                        "document_search",
                        ["Document"],
                        ["name", "content"]
                    )
                `);
                console.log('Created full-text index using Neo4j 4.3+ syntax');
            } catch (error) {
                console.log('Failed to create full-text index using Neo4j 4.3+ syntax, trying alternative...');
                
                try {
                    // Try Neo4j 4.0 syntax
                    await session.run(`
                        CALL db.index.fulltext.create(
                            "document_search", 
                            ["Document"], 
                            ["name", "content"]
                        )
                    `);
                    console.log('Created full-text index using Neo4j 4.0 syntax');
                } catch (innerError) {
                    console.error('Unable to create full-text index with either syntax, skipping.', innerError.message);
                    // Continue with initialization process without full-text index
                }
            }

            // Create index on relationship properties for temporal queries
            await session.run(`
                CREATE INDEX IF NOT EXISTS FOR ()-[r:OCCURRED_AT]-() ON (r.date)
            `);

            console.log('Neo4j database initialized with constraints and indexes');
        } catch (error) {
            console.error('Error initializing Neo4j database:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    /**
     * Convert a JavaScript object to a Neo4j-compatible format
     * @param {object} obj - The object to convert
     * @returns {object} - Neo4j-compatible object
     */
    _toNeo4jFormat(obj) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value === null || value === undefined) {
                result[key] = null;
            } else if (Array.isArray(value)) {
                result[key] = value.map(item => 
                    typeof item === 'object' && item !== null ? 
                        JSON.stringify(item) : item);
            } else if (typeof value === 'object') {
                result[key] = JSON.stringify(value);
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * Save entities to Neo4j
     * @param {Array} entities - Array of canonical entities
     * @returns {Promise<object>} - Results with counts of nodes created
     */
    async saveEntities(entities) {
        const session = this.driver.session();
        try {
            console.time('save-entities');
            let created = 0;
            let merged = 0;
            let errors = 0;
            const savedIds = [];

            // Process entities in larger batches for better performance
            const batchSize = 200; // Increased from 50 to 200
            console.log(`Saving ${entities.length} entities in batches of ${batchSize}`);
            
            // Prepare batches
            const batches = [];
            for (let i = 0; i < entities.length; i += batchSize) {
                batches.push(entities.slice(i, i + batchSize));
            }
            
            // Process each batch
            let batchIndex = 0;
            for (const batch of batches) {
                batchIndex++;
                console.time(`entity-batch-${batchIndex}`);
                
                try {
                    // Prepare parameters for the batch
                    const batchParams = {
                        entities: batch.map(entity => ({
                            id: entity.id,
                            name: entity.name,
                            type: entity.type,
                            description: entity.description || '',
                            aliases: entity.aliases || [],
                            properties: JSON.stringify(entity.properties || {}),
                            confidence: entity.confidence || 0.9,
                            sources: JSON.stringify(entity.sources || [])
                        }))
                    };
                    
                    // Create a single transaction for the entire batch using UNWIND
                    const query = `
                        UNWIND $entities AS entity
                        MERGE (e:Entity {id: entity.id})
                        ON CREATE SET 
                            e.name = entity.name,
                            e.description = entity.description,
                            e.aliases = entity.aliases,
                            e.created_at = datetime(),
                            e.properties = entity.properties,
                            e.confidence = entity.confidence,
                            e.sources = entity.sources,
                            e.created = true,
                            e.type = entity.type
                        ON MATCH SET 
                            e.name = entity.name,
                            e.description = entity.description,
                            e.aliases = entity.aliases,
                            e.updated_at = datetime(),
                            e.properties = entity.properties,
                            e.confidence = entity.confidence,
                            e.sources = entity.sources,
                            e.updated = true,
                            e.type = entity.type
                        RETURN e.id as id, e.created as created
                    `;
                    
                    const result = await session.run(query, batchParams);
                    
                    // Count created vs merged entities
                    result.records.forEach(record => {
                        savedIds.push(record.get('id'));
                        if (record.get('created') === true) {
                            created++;
                        } else {
                            merged++;
                        }
                    });
                    
                    console.log(`Batch ${batchIndex}/${batches.length}: Processed ${batch.length} entities (${created} created, ${merged} merged)`);
                } catch (error) {
                    console.error(`Error processing entity batch ${batchIndex}:`, error);
                    errors += batch.length;
                    
                    // Fall back to individual entity processing if batch fails
                    console.log('Falling back to individual entity processing...');
                    for (const entity of batch) {
                        try {
                            // Create Cypher parameters with Neo4j-compatible format
                            const params = this._toNeo4jFormat({
                                id: entity.id,
                                name: entity.name,
                                type: entity.type,
                                description: entity.description || '',
                                aliases: entity.aliases || [],
                                properties: entity.properties || {},
                                confidence: entity.confidence || 0.9,
                                sources: entity.sources || []
                            });

                            // Create Cypher query
                            const query = `
                                MERGE (e:Entity {id: $id})
                                ON CREATE SET 
                                    e.name = $name,
                                    e.description = $description,
                                    e.aliases = $aliases,
                                    e.created_at = datetime(),
                                    e.properties = $properties,
                                    e.confidence = $confidence,
                                    e.sources = $sources,
                                    e.created = true,
                                    e.type = $type
                                ON MATCH SET 
                                    e.name = $name,
                                    e.description = $description,
                                    e.aliases = $aliases,
                                    e.updated_at = datetime(),
                                    e.properties = $properties,
                                    e.confidence = $confidence,
                                    e.sources = $sources,
                                    e.updated = true,
                                    e.type = $type
                                RETURN e.created as created, e.id as id
                            `;
                            
                            const result = await session.run(query, params);
                            
                            if (result.records.length > 0) {
                                savedIds.push(result.records[0].get('id'));
                                if (result.records[0].get('created') === true) {
                                    created++;
                                } else {
                                    merged++;
                                }
                            }
                        } catch (innerError) {
                            console.error(`Error saving entity ${entity.name}:`, innerError);
                            errors++;
                        }
                    }
                }
                
                console.timeEnd(`entity-batch-${batchIndex}`);
            }

            console.timeEnd('save-entities');
            console.log(`Saved ${entities.length} entities: ${created} created, ${merged} merged, ${errors} errors`);
            return { created, merged, errors, ids: savedIds };
        } catch (error) {
            console.error('Error saving entities to Neo4j:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    /**
     * Check which entity IDs exist in the database
     * @param {Array<string>} entityIds - Array of entity IDs to check
     * @returns {Promise<Set<string>>} - Set of entity IDs that exist in the database
     */
    async checkEntityIdsExist(entityIds) {
        if (!entityIds || entityIds.length === 0) {
            return new Set();
        }
        
        const session = this.driver.session();
        try {
            console.log(`Checking existence of ${entityIds.length} entity IDs in the database...`);
            
            // Process in batches to avoid large parameter lists
            const batchSize = 100;
            const existingIds = new Set();
            
            for (let i = 0; i < entityIds.length; i += batchSize) {
                const batch = entityIds.slice(i, i + batchSize);
                
                const query = `
                    MATCH (e:Entity)
                    WHERE e.id IN $ids
                    RETURN e.id as id, e.name as name, labels(e) as types
                `;
                
                const result = await session.run(query, { ids: batch });
                
                result.records.forEach(record => {
                    existingIds.add(record.get('id'));
                });
            }
            
            const missingIds = entityIds.filter(id => !existingIds.has(id));
            console.log(`Found ${existingIds.size} out of ${entityIds.length} entity IDs in database`);
            
            if (missingIds.length > 0) {
                console.log(`Missing ${missingIds.length} entity IDs in database`);
                console.log(`First 10 missing IDs: ${missingIds.slice(0, 10).join(', ')}`);
            }
            
            return existingIds;
        } catch (error) {
            console.error('Error checking entity IDs in Neo4j:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    /**
     * Save relationships to Neo4j
     * @param {Array} relationships - Array of relationships
     * @returns {Promise<object>} - Results with counts of relationships created
     */
    async saveRelationships(relationships) {
        const session = this.driver.session();
        try {
            console.time('save-relationships');
            let created = 0;
            let merged = 0;
            let skipped = 0;
            let errors = 0;

            // Log summary statistics
            console.log(`Processing ${relationships.length} relationships`);
            
            // Step 1: Verify that all entity IDs exist in the database first
            console.time('verify-entity-ids');
            console.log('Verifying entity IDs exist in database...');
            const entityIds = new Set();
            
            // Track source and target entities separately for better debugging
            const sourceIds = new Set();
            const targetIds = new Set();
            
            for (const rel of relationships) {
                entityIds.add(rel.source);
                entityIds.add(rel.target);
                sourceIds.add(rel.source);
                targetIds.add(rel.target);
            }
            
            console.log(`Total unique entity IDs: ${entityIds.size}`);
            console.log(`Unique source IDs: ${sourceIds.size}`);
            console.log(`Unique target IDs: ${targetIds.size}`);
            
            const entityIdArray = Array.from(entityIds);
            const validEntityIds = await this.checkEntityIdsExist(entityIdArray);
            console.timeEnd('verify-entity-ids');
            
            // Pre-filter relationships to only those with valid entity IDs
            console.time('filter-relationships');
            const validRelationships = relationships.filter(rel => {
                if (!validEntityIds.has(rel.source)) {
                    console.log(`Skipping relationship: source entity ID "${rel.source}" (${rel.sourceName || 'unknown'}) not found in database`);
                    skipped++;
                    return false;
                }
                
                if (!validEntityIds.has(rel.target)) {
                    console.log(`Skipping relationship: target entity ID "${rel.target}" (${rel.targetName || 'unknown'}) not found in database`);
                    skipped++;
                    return false;
                }
                
                return true;
            });
            console.timeEnd('filter-relationships');
            
            console.log(`After filtering: ${validRelationships.length} valid relationships, ${skipped} skipped`);
            
            // Step 2: Process relationships in larger batches for better performance
            const batchSize = 200; // Increased from 50 to 200
            console.log(`Processing relationships in batches of ${batchSize}`);
            
            // Prepare batches
            const batches = [];
            for (let i = 0; i < validRelationships.length; i += batchSize) {
                batches.push(validRelationships.slice(i, i + batchSize));
            }
            
            // Process each batch
            let batchIndex = 0;
            for (const batch of batches) {
                batchIndex++;
                console.time(`relationship-batch-${batchIndex}`);
                console.log(`Processing relationship batch ${batchIndex}/${batches.length} (${batch.length} relationships)`);
                
                try {
                    // Prepare batch parameters
                    const batchParams = {
                        relationships: batch.map(rel => {
                            // Generate a unique ID for the relationship if not present
                            const relId = rel.id || uuidv4();
                            
                            // Create the parameter object
                            const params = {
                                sourceId: rel.source,
                                targetId: rel.target,
                                type: rel.type.toUpperCase(),
                                relId,
                                evidence: rel.evidence || '',
                                confidence: rel.confidence || 0.8,
                                metadata: JSON.stringify(rel.metadata || {})
                            };
                            
                            // Add date properties if present
                            if (rel.date) params.date = rel.date;
                            if (rel.start_date) params.start_date = rel.start_date;
                            if (rel.end_date) params.end_date = rel.end_date;
                            
                            return params;
                        })
                    };
                    
                    // Create a single transaction for the entire batch using UNWIND
                    const query = `
                        UNWIND $relationships AS rel
                        MATCH (source:Entity {id: rel.sourceId})
                        MATCH (target:Entity {id: rel.targetId})
                        CALL apoc.merge.relationship(
                            source, 
                            rel.type, 
                            {id: rel.relId}, 
                            {
                                evidence: rel.evidence,
                                confidence: rel.confidence,
                                metadata: rel.metadata,
                                created_at: datetime()
                            },
                            target,
                            {
                                evidence: rel.evidence,
                                confidence: rel.confidence,
                                metadata: rel.metadata,
                                updated_at: datetime()
                            }
                        )
                        YIELD rel as r
                        RETURN r.id as id, r.created as created
                    `;
                    
                    // If APOC is not available, use a fallback query
                    let result;
                    try {
                        result = await session.run(query, batchParams);
                    } catch (apocError) {
                        console.log('APOC might not be available, using fallback query');
                        
                        // Process each relationship type separately
                        const relationshipTypes = new Set(batch.map(rel => rel.type.toUpperCase()));
                        const typeBatchResults = [];
                        
                        for (const type of relationshipTypes) {
                            const typeRelationships = batch.filter(rel => rel.type.toUpperCase() === type);
                            
                            // Fallback query without APOC for this specific type
                            const fallbackQuery = `
                                UNWIND $relationships AS rel
                                MATCH (source:Entity {id: rel.sourceId})
                                MATCH (target:Entity {id: rel.targetId})
                                MERGE (source)-[r:${type} {id: rel.relId}]->(target)
                                ON CREATE SET 
                                    r.created_at = datetime(),
                                    r.evidence = rel.evidence,
                                    r.confidence = rel.confidence,
                                    r.metadata = rel.metadata,
                                    r.created = true
                                ON MATCH SET 
                                    r.evidence = rel.evidence,
                                    r.confidence = rel.confidence,
                                    r.metadata = rel.metadata,
                                    r.updated_at = datetime(),
                                    r.updated = true
                                RETURN r.id as id, r.created as created
                            `;
                            
                            const typeParams = {
                                relationships: typeRelationships.map(rel => ({
                                    sourceId: rel.source,
                                    targetId: rel.target,
                                    relId: rel.id || uuidv4(),
                                    evidence: rel.evidence || '',
                                    confidence: rel.confidence || 0.8,
                                    metadata: JSON.stringify(rel.metadata || {})
                                }))
                            };
                            
                            try {
                                const typeResult = await session.run(fallbackQuery, typeParams);
                                typeBatchResults.push(...typeResult.records);
                            } catch (typeError) {
                                console.error(`Error processing relationships of type ${type}:`, typeError);
                                errors += typeRelationships.length;
                            }
                        }
                        
                        result = { records: typeBatchResults };
                    }
                    
                    // Count created vs merged relationships
                    result.records.forEach(record => {
                        if (record.get('created') === true) {
                            created++;
                        } else {
                            merged++;
                        }
                    });
                    
                    console.log(`Batch ${batchIndex}: Processed ${batch.length} relationships (${created} created, ${merged} merged)`);
                } catch (error) {
                    console.error(`Error processing relationship batch ${batchIndex}:`, error);
                    
                    // Fall back to individual relationship processing if batch fails
                    console.log('Falling back to individual relationship processing...');
                    
                    for (const rel of batch) {
                        try {
                            // Generate a unique ID for the relationship if not present
                            const relId = rel.id || uuidv4();
                            
                            // Handle potential date properties for temporal relationships
                            let dateProperties = {};
                            if (rel.date) {
                                dateProperties.date = rel.date;
                            }
                            if (rel.start_date) {
                                dateProperties.start_date = rel.start_date;
                            }
                            if (rel.end_date) {
                                dateProperties.end_date = rel.end_date;
                            }
                            
                            // Create Cypher parameters with Neo4j-compatible format
                            const params = this._toNeo4jFormat({
                                sourceId: rel.source,
                                targetId: rel.target,
                                type: rel.type.toUpperCase(),
                                relId,
                                evidence: rel.evidence || '',
                                confidence: rel.confidence || 0.8,
                                metadata: rel.metadata || {},
                                ...dateProperties
                            });

                            // Build property string for relationship creation
                            const createProperties = [
                                'id: $relId',
                                'created_at: datetime()',
                                'evidence: $evidence',
                                'confidence: $confidence',
                                'metadata: $metadata'
                            ];
                            
                            // Build property string for relationship updates (merging)
                            const updateProperties = [
                                'evidence: $evidence',
                                'confidence: $confidence',
                                'metadata: $metadata',
                                'updated_at: datetime()'
                            ];
                            
                            // Add date properties if present
                            if (rel.date) {
                                createProperties.push('date: $date');
                                updateProperties.push('date: $date');
                            }
                            if (rel.start_date) {
                                createProperties.push('start_date: $start_date');
                                updateProperties.push('start_date: $start_date');
                            }
                            if (rel.end_date) {
                                createProperties.push('end_date: $end_date');
                                updateProperties.push('end_date: $end_date');
                            }
                            
                            const createPropertiesString = createProperties.join(', ');
                            const updatePropertiesString = updateProperties.join(', ');

                            // Use MERGE instead of CREATE to avoid duplicating relationships
                            const query = `
                                MATCH (source:Entity {id: $sourceId})
                                MATCH (target:Entity {id: $targetId})
                                MERGE (source)-[r:${params.type}]->(target)
                                ON CREATE SET r = {${createPropertiesString}}
                                ON MATCH SET r = {${updatePropertiesString}}
                                RETURN r, r.id as relId
                            `;
                            
                            const result = await session.run(query, params);
                            if (result.records.length > 0) {
                                // Check if the relationship already existed
                                if (result.records[0].get('relId') === relId) {
                                    created++;
                                } else {
                                    merged++;
                                }
                            }
                        } catch (innerError) {
                            console.error(`Error saving relationship from ${rel.source} to ${rel.target}:`, innerError);
                            errors++;
                        }
                    }
                }
                
                console.timeEnd(`relationship-batch-${batchIndex}`);
            }

            console.timeEnd('save-relationships');
            console.log(`Relationship processing results:
- Total: ${relationships.length}
- Created: ${created}
- Merged: ${merged}
- Skipped: ${skipped}
- Errors: ${errors}`);
            
            return { created, merged, skipped, errors };
        } catch (error) {
            console.error('Error saving relationships to Neo4j:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    /**
     * Save document nodes with content and metadata
     * @param {Array} documents - Array of document objects with content and metadata
     * @returns {Promise<object>} - Results with counts of documents created
     */
    async saveDocuments(documents) {
        const session = this.driver.session();
        try {
            let created = 0;
            let merged = 0;
            let errors = 0;

            for (const doc of documents) {
                try {
                    // Create Cypher parameters
                    const params = {
                        id: doc.id || `doc_${uuidv4()}`,
                        name: doc.name,
                        content: doc.content || '',
                        file_path: doc.file_path || '',
                        mime_type: doc.mime_type || '',
                        file_size: doc.file_size || 0,
                        created_date: doc.created_date || null,
                        metadata: doc.metadata || {}
                    };

                    // Create Cypher query
                    const query = `
                        MERGE (d:Document {id: $id})
                        ON CREATE SET 
                            d.name = $name,
                            d.content = $content,
                            d.file_path = $file_path,
                            d.mime_type = $mime_type,
                            d.file_size = $file_size,
                            d.created_date = $created_date,
                            d.metadata = $metadata,
                            d.indexed_at = datetime(),
                            d.created = true
                        ON MATCH SET 
                            d.name = $name,
                            d.content = $content,
                            d.file_path = $file_path,
                            d.mime_type = $mime_type,
                            d.file_size = $file_size,
                            d.created_date = $created_date,
                            d.metadata = $metadata,
                            d.updated_at = datetime(),
                            d.updated = true
                        RETURN d.created as created
                    `;
                    
                    const result = await session.run(query, params);
                    
                    if (result.records[0].get('created') === true) {
                        created++;
                    } else {
                        merged++;
                    }
                } catch (error) {
                    console.error(`Error saving document ${doc.name}:`, error);
                    errors++;
                }
            }

            console.log(`Saved ${documents.length} documents: ${created} created, ${merged} merged, ${errors} errors`);
            return { created, merged, errors };
        } catch (error) {
            console.error('Error saving documents to Neo4j:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    /**
     * Query the graph database
     * @param {string} query - Cypher query
     * @param {object} params - Parameters for the query
     * @returns {Promise<Array>} - Query results
     */
    async query(query, params = {}) {
        const session = this.driver.session();
        try {
            // Convert any numeric parameters to Neo4j integers
            const convertedParams = {};
            
            for (const [key, value] of Object.entries(params)) {
                // If the value is a number and not NaN, convert to Neo4j integer
                if (typeof value === 'number' && !isNaN(value)) {
                    convertedParams[key] = neo4j.int(Math.floor(value));
                } else {
                    convertedParams[key] = value;
                }
            }
            
            const result = await session.run(query, convertedParams);
            return result.records;
        } catch (error) {
            console.error('Error executing Neo4j query:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    /**
     * Close the Neo4j driver
     * @returns {Promise<void>}
     */
    async close() {
        if (this.driver) {
            await this.driver.close();
            console.log('Neo4j driver closed');
        }
    }
}

module.exports = new Neo4jService(); 