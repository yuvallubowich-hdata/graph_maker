const express = require('express');
const neo4jService = require('../services/neo4jService');

const router = express.Router();

// Get graph statistics
router.get('/stats', async (req, res) => {
    try {
        const query = `
            MATCH (n)
            WITH count(n) AS nodeCount
            MATCH ()-[r]->()
            RETURN nodeCount, count(r) AS relationshipCount
        `;
        
        const result = await neo4jService.query(query);
        
        if (result.length === 0) {
            return res.status(200).json({
                nodes: 0,
                relationships: 0
            });
        }
        
        // Get values safely, handling both integer and regular number formats
        const nodeCount = result[0].get('nodeCount');
        const relationshipCount = result[0].get('relationshipCount');
        
        const stats = {
            nodes: typeof nodeCount.toNumber === 'function' ? nodeCount.toNumber() : Number(nodeCount),
            relationships: typeof relationshipCount.toNumber === 'function' ? relationshipCount.toNumber() : Number(relationshipCount)
        };
        
        res.status(200).json(stats);
    } catch (error) {
        console.error('Error getting graph statistics:', error);
        res.status(500).json({ error: `Failed to get graph statistics: ${error.message}` });
    }
});

// Get entity types
router.get('/entity-types', async (req, res) => {
    try {
        const query = `
            MATCH (n)
            WITH labels(n) AS labels
            UNWIND labels AS label
            RETURN DISTINCT label, count(*) AS count
            ORDER BY count DESC
        `;
        
        const result = await neo4jService.query(query);
        
        const entityTypes = result.map(record => {
            const count = record.get('count');
            return {
                type: record.get('label'),
                count: typeof count.toNumber === 'function' ? count.toNumber() : Number(count)
            };
        });
        
        res.status(200).json(entityTypes);
    } catch (error) {
        console.error('Error getting entity types:', error);
        res.status(500).json({ error: `Failed to get entity types: ${error.message}` });
    }
});

// Get relationship types
router.get('/relationship-types', async (req, res) => {
    try {
        const query = `
            MATCH ()-[r]->()
            RETURN DISTINCT type(r) AS type, count(*) AS count
            ORDER BY count DESC
        `;
        
        const result = await neo4jService.query(query);
        
        const relationshipTypes = result.map(record => {
            const count = record.get('count');
            return {
                type: record.get('type'),
                count: typeof count.toNumber === 'function' ? count.toNumber() : Number(count)
            };
        });
        
        res.status(200).json(relationshipTypes);
    } catch (error) {
        console.error('Error getting relationship types:', error);
        res.status(500).json({ error: `Failed to get relationship types: ${error.message}` });
    }
});

// Get entities by type
router.get('/entities/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { limit = 100, offset = 0 } = req.query;
        
        const query = `
            MATCH (n:${type})
            RETURN n.id AS id, n.name AS name, labels(n) AS labels, n.description AS description, n.aliases AS aliases
            ORDER BY n.name
            SKIP toInteger($offset)
            LIMIT toInteger($limit)
        `;
        
        const result = await neo4jService.query(query, { 
            type, 
            limit: Number.parseInt(limit, 10), 
            offset: Number.parseInt(offset, 10) 
        });
        
        const entities = result.map(record => ({
            id: record.get('id'),
            name: record.get('name'),
            labels: record.get('labels'),
            description: record.get('description'),
            aliases: record.get('aliases')
        }));
        
        res.status(200).json(entities);
    } catch (error) {
        console.error(`Error getting entities of type ${req.params.type}:`, error);
        res.status(500).json({ error: `Failed to get entities: ${error.message}` });
    }
});

// Search entities
router.get('/search', async (req, res) => {
    try {
        const { query: searchQuery, types, limit = 50 } = req.query;
        
        if (!searchQuery) {
            return res.status(400).json({ error: 'Search query is required' });
        }
        
        let typeFilter = '';
        if (types) {
            const typeArray = types.split(',');
            typeFilter = `WHERE ANY(label IN labels(n) WHERE label IN $typeArray)`;
        }
        
        const query = `
            MATCH (n)
            ${typeFilter}
            WHERE toLower(n.name) CONTAINS toLower($searchQuery) OR 
                  ANY(alias IN n.aliases WHERE toLower(alias) CONTAINS toLower($searchQuery))
            RETURN n.id AS id, n.name AS name, labels(n) AS labels, n.description AS description
            ORDER BY n.name
            LIMIT toInteger($limit)
        `;
        
        const params = { 
            searchQuery, 
            typeArray: types ? types.split(',') : [], 
            limit: Number.parseInt(limit, 10)
        };
        const result = await neo4jService.query(query, params);
        
        const entities = result.map(record => ({
            id: record.get('id'),
            name: record.get('name'),
            labels: record.get('labels'),
            description: record.get('description')
        }));
        
        res.status(200).json(entities);
    } catch (error) {
        console.error('Error searching entities:', error);
        res.status(500).json({ error: `Failed to search entities: ${error.message}` });
    }
});

// Get entity details with relationships
router.get('/entity/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            MATCH (e {id: $id})
            OPTIONAL MATCH (e)-[r]->(target)
            WHERE target.id IS NOT NULL
            WITH e, collect({
                id: r.id,
                type: type(r),
                target: {
                    id: target.id,
                    name: target.name,
                    labels: labels(target)
                },
                evidence: r.evidence,
                confidence: r.confidence
            }) AS outgoing
            OPTIONAL MATCH (source)-[r]->(e)
            WHERE source.id IS NOT NULL
            WITH e, outgoing, collect({
                id: r.id,
                type: type(r),
                source: {
                    id: source.id,
                    name: source.name,
                    labels: labels(source)
                },
                evidence: r.evidence,
                confidence: r.confidence
            }) AS incoming
            RETURN {
                id: e.id,
                name: e.name,
                labels: labels(e),
                description: e.description,
                aliases: e.aliases,
                properties: e.properties,
                outgoing: outgoing,
                incoming: incoming
            } AS entity
        `;
        
        const result = await neo4jService.query(query, { id });
        
        if (result.length === 0) {
            return res.status(404).json({ error: 'Entity not found' });
        }
        
        const entity = result[0].get('entity');
        
        res.status(200).json(entity);
    } catch (error) {
        console.error(`Error getting entity ${req.params.id}:`, error);
        res.status(500).json({ error: `Failed to get entity: ${error.message}` });
    }
});

// Get a subgraph for visualization
router.get('/visualization', async (req, res) => {
    try {
        const { entityId, depth = 1, limit = 100 } = req.query;
        
        if (!entityId) {
            return res.status(400).json({ error: 'Entity ID is required' });
        }
        
        console.log(`Visualization request for entity ${entityId} with depth ${depth} and limit ${limit}`);
        
        // Use a simpler query that just gets direct relationships
        // This avoids the complexity of variable-length paths that might be causing issues
        const query = `
            // First get the entity
            MATCH (e) WHERE e.id = $entityId
            
            // Get direct relationships (depth 1)
            OPTIONAL MATCH (e)-[r1]->(n1)
            WHERE n1.id IS NOT NULL
            WITH e, collect({
                source: e,
                rel: r1,
                target: n1,
                direction: 'outgoing'
            }) as outgoing
            
            // Get incoming relationships
            OPTIONAL MATCH (n2)-[r2]->(e)
            WHERE n2.id IS NOT NULL
            WITH e, outgoing, collect({
                source: n2,
                rel: r2,
                target: e,
                direction: 'incoming'
            }) as incoming
            
            // Combine all nodes and relationships
            WITH e, outgoing + incoming as rels
            
            // Create nodes and links collections
            WITH
                [e] + [rel IN rels | 
                    CASE rel.direction
                        WHEN 'outgoing' THEN rel.target
                        ELSE rel.source
                    END
                ] as allNodes,
                rels
            
            RETURN
                // Process nodes
                [n IN allNodes | {
                    id: n.id,
                    label: head(labels(n)),
                    name: n.name,
                    group: head(labels(n))
                }] as nodes,
                
                // Process relationships - simplified to avoid NULL issues
                [r IN rels WHERE r.rel IS NOT NULL | {
                    id: COALESCE(r.rel.id, toString(id(r.rel))),
                    source: r.source.id,
                    target: r.target.id,
                    type: type(r.rel),
                    label: type(r.rel)
                }] as relationships
        `;
        
        console.log("Executing simplified visualization query");
        
        const result = await neo4jService.query(query, { 
            entityId
        });
        
        console.log(`Query execution complete. Got ${result.length} result records`);
        
        if (result.length === 0) {
            console.log("No results returned from visualization query");
            return res.status(404).json({ error: 'Entity not found or no connections available' });
        }
        
        // Create a simpler graph structure from the results
        const nodes = result[0].get('nodes');
        const relationships = result[0].get('relationships');
        
        // Validate all nodes exist in the database before adding them to the graph
        const nodeIds = nodes.map(node => node.id);
        const validationQuery = `
            UNWIND $nodeIds AS nodeId
            MATCH (n {id: nodeId})
            RETURN n.id AS id
        `;
        const validatedNodes = await neo4jService.query(validationQuery, { nodeIds });
        const validNodeIds = new Set(validatedNodes.map(record => record.get('id')));
        
        // Filter out any invalid nodes
        const validNodes = nodes.filter(node => validNodeIds.has(node.id));
        
        // Filter out any relationships with null source or target or with invalid nodes
        const validRelationships = relationships.filter(rel => 
            rel && rel.source && rel.target && 
            typeof rel.source === 'string' && 
            typeof rel.target === 'string' &&
            validNodeIds.has(rel.source) &&
            validNodeIds.has(rel.target)
        );
        
        // Deduplicate nodes by ID
        const uniqueNodes = Array.from(
            new Map(validNodes.map(node => [node.id, node])).values()
        );
        
        // Convert to D3 format
        const graph = {
            nodes: uniqueNodes,
            links: validRelationships
        };
        
        console.log(`Returning graph with ${graph.nodes.length} nodes and ${graph.links.length} links`);
        
        // Check for empty data
        if (graph.nodes.length === 0) {
            console.log("Warning: No nodes in the graph");
            return res.status(404).json({ error: 'No nodes available for visualization' });
        }
        
        if (graph.links.length === 0) {
            console.log("Warning: Entity exists but has no relationships");
            // Still return the single node for visualization
            console.log("Returning just the entity node for visualization");
        }
        
        res.status(200).json(graph);
    } catch (error) {
        console.error('Error getting visualization data:', error);
        res.status(500).json({ error: `Failed to get visualization data: ${error.message}` });
    }
});

module.exports = router; 