/**
 * Query Routes
 * 
 * These routes handle natural language to Cypher translation and
 * execution of Cypher queries against the Neo4j database.
 */
const express = require('express');
const router = express.Router();
const queryTranslationService = require('../services/queryTranslationService');

// Route to handle natural language to Cypher translation
router.post('/translate', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Query is required', 
        message: 'You must provide a natural language query to translate' 
      });
    }
    
    console.log(`Translating natural language query: "${query}"`);
    
    // Translate natural language to Cypher
    const cypherQuery = await queryTranslationService.translateQuery(query);
    
    console.log(`Translated to Cypher: ${cypherQuery}`);
    
    // Return the Cypher query
    res.json({
      originalQuery: query,
      cypherQuery
    });
  } catch (error) {
    console.error('Error translating query:', error);
    res.status(500).json({ 
      error: 'Error translating query', 
      message: error.message 
    });
  }
});

// Route to execute Cypher queries
router.post('/execute', async (req, res) => {
  try {
    const { query, params } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Query is required',
        message: 'You must provide a Cypher query to execute' 
      });
    }
    
    console.log(`Executing Cypher query: ${query}`);
    
    // Execute the Cypher query
    const records = await queryTranslationService.executeQuery(query, params || {});
    
    // Transform Neo4j records to plain JSON
    const results = records.map(record => {
      const obj = {};
      for (const key of record.keys) {
        const value = record.get(key);
        obj[key] = convertNeo4jValueToJson(value);
      }
      return obj;
    });
    
    res.json({
      query,
      results
    });
  } catch (error) {
    console.error('Error executing query:', error);
    res.status(500).json({ 
      error: 'Error executing query', 
      message: error.message 
    });
  }
});

/**
 * Convert Neo4j values to plain JSON
 * @param {any} value The Neo4j value to convert
 * @returns {any} The converted value
 */
function convertNeo4jValueToJson(value) {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null;
  }
  
  // Handle Neo4j Integer (convert to number)
  if (value.constructor && value.constructor.name === 'Integer') {
    return value.toNumber();
  }
  
  // Handle Neo4j Node
  if (value.constructor && value.constructor.name === 'Node') {
    return {
      ...value.properties,
      _id: value.identity.toNumber(),
      _labels: value.labels
    };
  }
  
  // Handle Neo4j Relationship
  if (value.constructor && value.constructor.name === 'Relationship') {
    return {
      ...value.properties,
      _id: value.identity.toNumber(),
      _type: value.type,
      _start: value.start.toNumber(),
      _end: value.end.toNumber()
    };
  }
  
  // Handle Neo4j Path - array of nodes and relationships
  if (value.constructor && value.constructor.name === 'Path') {
    return {
      segments: value.segments.map(segment => ({
        start: convertNeo4jValueToJson(segment.start),
        relationship: convertNeo4jValueToJson(segment.relationship),
        end: convertNeo4jValueToJson(segment.end)
      })),
      start: convertNeo4jValueToJson(value.start),
      end: convertNeo4jValueToJson(value.end),
      length: value.length
    };
  }
  
  // Handle arrays (map values recursively)
  if (Array.isArray(value)) {
    return value.map(convertNeo4jValueToJson);
  }
  
  // Handle objects (map values recursively)
  if (typeof value === 'object') {
    const result = {};
    for (const key in value) {
      result[key] = convertNeo4jValueToJson(value[key]);
    }
    return result;
  }
  
  // Return primitives as-is
  return value;
}

module.exports = router; 