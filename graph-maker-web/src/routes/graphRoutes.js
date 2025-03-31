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
        
        const result = await neo4jService.query(query, { type, limit, offset });
        
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
        
        const params = { searchQuery, typeArray: types ? types.split(',') : [], limit };
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
            MATCH (e:Entity {id: $id})
            OPTIONAL MATCH (e)-[r]->(target:Entity)
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
            OPTIONAL MATCH (source:Entity)-[r]->(e)
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
        
        const query = `
            MATCH path = (e:Entity {id: $entityId})-[*1..$depth]-(connected)
            WITH e, path, connected
            LIMIT $limit
            WITH collect(e) + collect(connected) AS nodes, collect(relationships(path)) AS rels
            RETURN 
                [n IN nodes | {
                    id: n.id,
                    label: head(labels(n)),
                    name: n.name,
                    group: head(labels(n))
                }] AS nodes,
                [r IN REDUCE(s = [], rel IN rels | s + rel) | {
                    id: r.id,
                    source: startNode(r).id,
                    target: endNode(r).id,
                    type: type(r),
                    label: type(r)
                }] AS relationships
        `;
        
        const result = await neo4jService.query(query, { 
            entityId, 
            depth: parseInt(depth), 
            limit: parseInt(limit) 
        });
        
        if (result.length === 0) {
            return res.status(404).json({ error: 'Entity not found or no connections available' });
        }
        
        // Deduplicate nodes and relationships (they might appear multiple times in different paths)
        const nodesMap = new Map();
        for (const node of result[0].get('nodes')) {
            if (!nodesMap.has(node.id)) {
                nodesMap.set(node.id, node);
            }
        }
        
        const relsMap = new Map();
        for (const rel of result[0].get('relationships')) {
            const relKey = `${rel.source}-${rel.type}-${rel.target}`;
            if (!relsMap.has(relKey)) {
                relsMap.set(relKey, rel);
            }
        }
        
        const graph = {
            nodes: Array.from(nodesMap.values()),
            links: Array.from(relsMap.values())
        };
        
        res.status(200).json(graph);
    } catch (error) {
        console.error('Error getting visualization data:', error);
        res.status(500).json({ error: `Failed to get visualization data: ${error.message}` });
    }
});

module.exports = router; 