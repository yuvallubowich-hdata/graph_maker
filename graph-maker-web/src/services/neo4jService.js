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
        if (!entities || entities.length === 0) {
            console.log('No entities to save');
            return { created: 0, merged: 0, errors: 0, ids: [] };
        }

        let session = null;
        let tx = null;
        let created = 0;
        let merged = 0;
        let errors = 0;
        const savedIds = [];

        try {
            console.time('save-entities');
            
            // Process entities in larger batches for better performance
            const batchSize = 100; // Reduced from 200 to 100 for better reliability
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
                
                // Create a new session for each batch
                if (session) {
                    await session.close();
                    session = null;
                }
                
                session = this.driver.session();
                
                try {
                    // Start a new transaction
                    tx = session.beginTransaction();
                    
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
                    
                    // First check if any entities can be merged by name+type
                    const mergeQuery = `
                        UNWIND $entities AS entity
                        OPTIONAL MATCH (existing:Entity)
                        WHERE 
                            existing.name = entity.name AND 
                            existing.type = entity.type AND
                            existing.id <> entity.id
                        RETURN 
                            entity.id AS new_id,
                            existing.id AS existing_id,
                            entity.name AS name,
                            entity.type AS type
                    `;
                    
                    const mergeResult = await tx.run(mergeQuery, batchParams);
                    
                    // Track which entities need to be created vs. merged
                    const toCreate = [];
                    const toMerge = new Map(); // existing_id -> new entity data
                    
                    // Process merge candidates
                    for (const record of mergeResult.records) {
                        const newId = record.get('new_id');
                        const existingId = record.get('existing_id');
                        const name = record.get('name');
                        const type = record.get('type');
                        
                        if (existingId) {
                            console.log(`Found existing entity for merge: "${name}" (${type}), existing ID: ${existingId}`);
                            // Find the full entity data
                            const entityData = batch.find(e => e.id === newId);
                            if (entityData) {
                                toMerge.set(existingId, entityData);
                            }
                        } else {
                            // No matching entity found, need to create
                            const entityData = batch.find(e => e.id === newId);
                            if (entityData) {
                                toCreate.push(entityData);
                            }
                        }
                    }
                    
                    // Create new entities
                    if (toCreate.length > 0) {
                        const createParams = {
                            entities: toCreate.map(entity => ({
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
                        
                        // Simple query without APOC - more reliable
                        const createQuery = `
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
                            RETURN e.id as id, true as created
                        `;
                        
                        const createResult = await tx.run(createQuery, createParams);
                        created += createResult.records.length;
                        createResult.records.forEach(record => {
                            savedIds.push(record.get('id'));
                        });
                    }
                    
                    // Merge with existing entities
                    if (toMerge.size > 0) {
                        // Convert map to array for Cypher
                        const mergeEntities = [];
                        for (const [existingId, entityData] of toMerge.entries()) {
                            mergeEntities.push({
                                existing_id: existingId,
                                new_id: entityData.id,
                                name: entityData.name,
                                type: entityData.type,
                                description: entityData.description || '',
                                aliases: entityData.aliases || [],
                                properties: JSON.stringify(entityData.properties || {}),
                                confidence: entityData.confidence || 0.9,
                                sources: JSON.stringify(entityData.sources || [])
                            });
                        }
                        
                        const mergeFullParams = { entities: mergeEntities };
                        
                        const mergeFullQuery = `
                            UNWIND $entities AS entity
                            MATCH (e:Entity {id: entity.existing_id})
                            SET 
                                e.name = entity.name,
                                e.description = CASE 
                                    WHEN size(entity.description) > size(e.description) 
                                    THEN entity.description ELSE e.description END,
                                e.updated_at = datetime(),
                                e.confidence = CASE 
                                    WHEN entity.confidence > e.confidence 
                                    THEN entity.confidence ELSE e.confidence END,
                                e.merged = true,
                                e.merged_ids = CASE
                                    WHEN e.merged_ids IS NULL THEN [entity.new_id]
                                    ELSE e.merged_ids + entity.new_id END
                            // Add any new aliases that don't already exist
                            FOREACH (alias IN [a IN entity.aliases WHERE NOT a IN e.aliases] |
                                SET e.aliases = CASE
                                    WHEN e.aliases IS NULL THEN [alias]
                                    ELSE e.aliases + alias END
                            )
                            // Merge sources arrays
                            SET e.sources = CASE
                                WHEN e.sources IS NULL THEN entity.sources
                                ELSE e.sources + entity.sources END
                            RETURN e.id as id
                        `;
                        
                        const mergeFullResult = await tx.run(mergeFullQuery, mergeFullParams);
                        merged += mergeFullResult.records.length;
                        mergeFullResult.records.forEach(record => {
                            savedIds.push(record.get('id'));
                        });
                    }
                    
                    // Explicitly commit the transaction if everything worked
                    await tx.commit();
                    tx = null;
                    
                    console.log(`Batch ${batchIndex}/${batches.length}: Processed ${batch.length} entities (created: ${created}, merged: ${merged})`);
                    
                    // Verify entities are visible by querying one with a new session
                    if (batch.length > 0) {
                        const verifySession = this.driver.session();
                        try {
                            const verifyResult = await verifySession.run(
                                'MATCH (e:Entity {id: $id}) RETURN e.id',
                                { id: batch[0].id }
                            );
                            console.log(`Verified entity visibility: ${verifyResult.records.length > 0 ? 'Success' : 'Failed'}`);
                        } catch (verifyErr) {
                            console.error('Error verifying entity visibility:', verifyErr);
                        } finally {
                            await verifySession.close();
                        }
                    }
                    
                } catch (batchError) {
                    console.error(`Error processing entity batch ${batchIndex}:`, batchError);
                    
                    // Roll back the transaction if it exists
                    if (tx) {
                        try {
                            await tx.rollback();
                        } catch (rollbackError) {
                            console.error('Error rolling back transaction:', rollbackError);
                        } finally {
                            tx = null;
                        }
                    }
                    
                    errors += batch.length;
                    
                    // Process entities individually as a fallback
                    console.log('Falling back to individual entity processing...');
                    const individualResults = await this._saveEntitiesIndividually(batch);
                    created += individualResults.created;
                    merged += individualResults.merged;
                    errors -= (individualResults.created + individualResults.merged);
                    savedIds.push(...individualResults.ids);
                } finally {
                    // Always ensure the transaction is closed
                    if (tx) {
                        try {
                            await tx.rollback();
                            tx = null;
                        } catch (finalRollbackError) {
                            console.error('Error in final transaction rollback:', finalRollbackError);
                        }
                    }
                    
                    // Close the session
                    if (session) {
                        try {
                            await session.close();
                            session = null;
                        } catch (sessionCloseError) {
                            console.error('Error closing session:', sessionCloseError);
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
            // Ensure any remaining session is closed
            if (session) {
                try {
                    await session.close();
                } catch (finalCloseError) {
                    console.error('Final session close error:', finalCloseError);
                }
            }
        }
    }

    /**
     * Save entities individually (fallback method)
     * @private
     * @param {Array} entities - Array of entities to save
     * @returns {Promise<object>} - Results with counts
     */
    async _saveEntitiesIndividually(entities) {
        let created = 0;
        let merged = 0;
        let errors = 0;
        const savedIds = [];
        
        // Process each entity individually
        for (const entity of entities) {
            let individualSession = null;
            let individualTx = null;
            
            try {
                // Create a new session for each entity
                individualSession = this.driver.session();
                individualTx = individualSession.beginTransaction();
                
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
                
                const result = await individualTx.run(query, params);
                
                // Commit the transaction
                await individualTx.commit();
                individualTx = null;
                
                if (result.records.length > 0) {
                    savedIds.push(result.records[0].get('id'));
                    if (result.records[0].get('created') === true) {
                        created++;
                    } else {
                        merged++;
                    }
                }
            } catch (err) {
                console.error(`Error saving individual entity ${entity.name}:`, err);
                errors++;
                
                // Roll back transaction if needed
                if (individualTx) {
                    try {
                        await individualTx.rollback();
                    } catch (rollbackErr) {
                        console.error('Error rolling back transaction:', rollbackErr);
                    }
                }
            } finally {
                // Always close the session
                if (individualSession) {
                    try {
                        await individualSession.close();
                    } catch (closeErr) {
                        console.error('Error closing individual session:', closeErr);
                    }
                }
            }
        }
        
        console.log(`Individual processing results: ${created} created, ${merged} merged, ${errors} errors`);
        return { created, merged, errors, ids: savedIds };
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
        if (!relationships || relationships.length === 0) {
            console.log('No relationships to save');
            return { created: 0, merged: 0, errors: 0 };
        }

        let session = null;
        let tx = null;
        let created = 0;
        let merged = 0;
        let errors = 0;

        try {
            console.time('save-relationships');
            
            // Process relationships in batches for better performance
            const batchSize = 100;
            console.log(`Saving ${relationships.length} relationships in batches of ${batchSize}`);
            
            // Prepare batches
            const batches = [];
            for (let i = 0; i < relationships.length; i += batchSize) {
                batches.push(relationships.slice(i, i + batchSize));
            }
            
            // Process each batch
            let batchIndex = 0;
            for (const batch of batches) {
                batchIndex++;
                console.time(`relationship-batch-${batchIndex}`);
                
                // Create a new session for each batch
                if (session) {
                    await session.close();
                    session = null;
                }
                
                session = this.driver.session();
                
                try {
                    // Start a new transaction
                    tx = session.beginTransaction();
                    
                    // Group relationships by type for processing
                    const relationshipsByType = new Map();
                    for (const rel of batch) {
                        const type = rel.type;
                        if (!relationshipsByType.has(type)) {
                            relationshipsByType.set(type, []);
                        }
                        relationshipsByType.get(type).push(rel);
                    }

                    let batchCreated = 0;
                    let batchMerged = 0;

                    // Process each relationship type separately
                    for (const [relType, relationsOfType] of relationshipsByType.entries()) {
                        // Prepare parameters for this relationship type
                        const typeParams = {
                            rels: relationsOfType.map(rel => ({
                                source: rel.source,
                                target: rel.target,
                                type: rel.type,
                                confidence: rel.confidence || 0.7,
                                evidence: rel.evidence || '',
                                sources: JSON.stringify(rel.sources || [])
                            }))
                        };
                        
                        // Use standard Cypher with relationship type in the query
                        const query = `
                            UNWIND $rels AS rel
                            MATCH (source:Entity {id: rel.source})
                            MATCH (target:Entity {id: rel.target})
                            MERGE (source)-[r:\`${relType}\`]->(target)
                            ON CREATE SET 
                                r.created_at = datetime(),
                                r.confidence = rel.confidence,
                                r.evidence = rel.evidence,
                                r.sources = rel.sources,
                                r.created = true
                            ON MATCH SET 
                                r.updated_at = datetime(),
                                r.confidence = CASE WHEN r.confidence < rel.confidence THEN rel.confidence ELSE r.confidence END,
                                r.evidence = rel.evidence,
                                r.sources = rel.sources,
                                r.updated = true
                            RETURN r, rel.source as source, rel.target as target, rel.type as type
                        `;
                        
                        const result = await tx.run(query, typeParams);
                        batchCreated += result.records.length;
                    }

                    // Count relationships
                    created += batchCreated;
                    merged += batchMerged;

                    // Commit the transaction
                    await tx.commit();
                    tx = null;
                    
                    console.log(`Batch ${batchIndex}/${batches.length}: Processed ${batch.length} relationships (${created} created, ${merged} merged)`);
                    
                    // Verify a relationship is visible
                    if (batch.length > 0) {
                        const verifySession = this.driver.session();
                        try {
                            const verifyResult = await verifySession.run(
                                'MATCH (s:Entity {id: $source})-[r]->(t:Entity {id: $target}) RETURN count(r) as count',
                                { source: batch[0].source, target: batch[0].target }
                            );
                            const count = verifyResult.records.length > 0 ? verifyResult.records[0].get('count').toNumber() : 0;
                            console.log(`Verified relationship visibility: ${count > 0 ? 'Success' : 'Failed'}`);
                        } catch (verifyErr) {
                            console.error('Error verifying relationship visibility:', verifyErr);
                        } finally {
                            await verifySession.close();
                        }
                    }
                } catch (batchError) {
                    console.error(`Error processing relationship batch ${batchIndex}:`, batchError);
                    
                    // Roll back the transaction if it exists
                    if (tx) {
                        try {
                            await tx.rollback();
                        } catch (rollbackError) {
                            console.error('Error rolling back transaction:', rollbackError);
                        } finally {
                            tx = null;
                        }
                    }
                    
                    errors += batch.length;
                    
                    // Process relationships individually as a fallback
                    console.log('Falling back to individual relationship processing...');
                    const individualResults = await this._saveRelationshipsIndividually(batch);
                    created += individualResults.created;
                    merged += individualResults.merged;
                    errors -= (individualResults.created + individualResults.merged);
                } finally {
                    // Always ensure the transaction is closed
                    if (tx) {
                        try {
                            await tx.rollback();
                            tx = null;
                        } catch (finalRollbackError) {
                            console.error('Error in final transaction rollback:', finalRollbackError);
                        }
                    }
                    
                    // Close the session
                    if (session) {
                        try {
                            await session.close();
                            session = null;
                        } catch (sessionCloseError) {
                            console.error('Error closing session:', sessionCloseError);
                        }
                    }
                }
                
                console.timeEnd(`relationship-batch-${batchIndex}`);
            }

            console.timeEnd('save-relationships');
            console.log(`Saved ${relationships.length} relationships: ${created} created, ${merged} merged, ${errors} errors`);
            return { created, merged, errors };
        } catch (error) {
            console.error('Error saving relationships to Neo4j:', error);
            throw error;
        } finally {
            // Ensure any remaining session is closed
            if (session) {
                try {
                    await session.close();
                } catch (finalCloseError) {
                    console.error('Final session close error:', finalCloseError);
                }
            }
        }
    }

    /**
     * Save relationships individually (fallback method)
     * @private
     * @param {Array} relationships - Array of relationships to save
     * @returns {Promise<object>} - Results with counts
     */
    async _saveRelationshipsIndividually(relationships) {
        let created = 0;
        let merged = 0;
        let errors = 0;
        
        // Process each relationship individually
        for (const rel of relationships) {
            let individualSession = null;
            let individualTx = null;
            
            try {
                // Create a new session for each relationship
                individualSession = this.driver.session();
                individualTx = individualSession.beginTransaction();
                
                // Format parameters
                const params = {
                    source: rel.source,
                    target: rel.target,
                    type: rel.type,
                    confidence: rel.confidence || 0.7,
                    evidence: rel.evidence || '',
                    sources: JSON.stringify(rel.sources || [])
                };

                // Create Cypher query with direct relationship type
                const query = `
                    MATCH (source:Entity {id: $source})
                    MATCH (target:Entity {id: $target})
                    MERGE (source)-[r:\`${rel.type}\`]->(target)
                    ON CREATE SET 
                        r.created_at = datetime(),
                        r.confidence = $confidence,
                        r.evidence = $evidence,
                        r.sources = $sources,
                        r.created = true
                    ON MATCH SET 
                        r.updated_at = datetime(),
                        r.confidence = CASE WHEN r.confidence < $confidence THEN $confidence ELSE r.confidence END,
                        r.evidence = $evidence,
                        r.sources = $sources,
                        r.updated = true
                    RETURN r
                `;
                
                const result = await individualTx.run(query, params);
                
                // Commit the transaction
                await individualTx.commit();
                individualTx = null;
                
                if (result.records.length > 0) {
                    if (result.records[0].get('r').properties.created === true) {
                        created++;
                    } else {
                        merged++;
                    }
                }
            } catch (err) {
                console.error(`Error saving individual relationship from ${rel.source} to ${rel.target}:`, err);
                errors++;
                
                // Roll back transaction if needed
                if (individualTx) {
                    try {
                        await individualTx.rollback();
                    } catch (rollbackErr) {
                        console.error('Error rolling back transaction:', rollbackErr);
                    }
                }
            } finally {
                // Always close the session
                if (individualSession) {
                    try {
                        await individualSession.close();
                    } catch (closeErr) {
                        console.error('Error closing individual session:', closeErr);
                    }
                }
            }
        }
        
        console.log(`Individual relationship processing results: ${created} created, ${merged} merged, ${errors} errors`);
        return { created, merged, errors };
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