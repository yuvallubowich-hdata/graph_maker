/**
 * Query Translation Service
 * 
 * This service translates natural language queries into Cypher queries
 * by using the Google Gemini API. It includes:
 * - Schema extraction from Neo4j
 * - Natural language to Cypher translation
 * - Query execution
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

class QueryTranslationService {
  constructor() {
    this.neo4jService = require('./neo4jService');
    this.schemaInfo = null;
    this.initPromise = null;
    
    // Initialize LLM
    if (process.env.GEMINI_API_KEY) {
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = this.genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.2,
          topP: 0.8,
          maxOutputTokens: 2048,
        }
      });
      console.log(`Initialized Gemini model for query translation: ${process.env.GEMINI_MODEL || 'gemini-1.5-flash'}`);
    } else {
      console.warn('GEMINI_API_KEY not set. Query translation will not work.');
    }
    
    // Initialize schema info
    this.initPromise = this.initializeSchemaInfo();
  }
  
  /**
   * Initialize schema information from Neo4j
   */
  async initializeSchemaInfo() {
    try {
      console.log('Initializing Neo4j schema information for query translation...');
      this.schemaInfo = await this.fetchGraphSchema();
      console.log('Neo4j schema info loaded successfully');
      return this.schemaInfo;
    } catch (error) {
      console.error('Error initializing Neo4j schema info:', error);
      this.schemaInfo = { nodes: [], relationships: [] };
      throw error;
    }
  }
  
  /**
   * Fetch the graph schema from Neo4j
   * @returns {Promise<Object>} Schema information
   */
  async fetchGraphSchema() {
    const driver = this.neo4jService.driver;
    const session = driver.session();
    
    try {
      // Get node labels and properties
      const nodesResult = await session.run(`
        CALL db.schema.nodeTypeProperties() 
        YIELD nodeType, propertyName
        RETURN nodeType, collect(propertyName) as properties
      `);
      
      // Get relationship types and properties
      const relsResult = await session.run(`
        CALL db.schema.relTypeProperties()
        YIELD relType, propertyName
        RETURN relType, collect(propertyName) as properties
      `);
      
      // Get node counts for each label
      const nodeCounts = await session.run(`
        MATCH (n)
        WITH labels(n) AS labels, count(n) AS count
        UNWIND labels AS label
        RETURN label, sum(count) AS count
        ORDER BY count DESC
      `);
      
      // Process node and relationship data
      const nodes = nodesResult.records.map(record => {
        const label = record.get('nodeType');
        const properties = record.get('properties');
        
        // Find count for this label
        const countRecord = nodeCounts.records.find(r => r.get('label') === label);
        const count = countRecord ? countRecord.get('count').toNumber() : 0;
        
        return {
          label,
          properties,
          count
        };
      });
      
      const relationships = relsResult.records.map(record => ({
        type: record.get('relType'),
        properties: record.get('properties')
      }));
      
      return { nodes, relationships };
    } catch (error) {
      console.error('Error fetching Neo4j schema:', error);
      return { nodes: [], relationships: [] };
    } finally {
      await session.close();
    }
  }
  
  /**
   * Ensure the service is initialized
   */
  async ensureInitialized() {
    if (!this.schemaInfo) {
      await this.initPromise;
    }
    return this.schemaInfo;
  }
  
  /**
   * Translate a natural language query to Cypher
   * @param {string} naturalLanguageQuery The query in natural language
   * @returns {Promise<string>} The translated Cypher query
   */
  async translateQuery(naturalLanguageQuery) {
    if (!this.model) {
      throw new Error('Gemini model not initialized. Please check your API key.');
    }
    
    await this.ensureInitialized();
    
    // Create a prompt that includes the graph schema and the query
    const prompt = this.createTranslationPrompt(naturalLanguageQuery);
    
    try {
      // Call Gemini to translate
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const responseText = response.text();
      
      // Extract the Cypher query from the response
      return this.extractCypherQuery(responseText);
    } catch (error) {
      console.error('Error translating query:', error);
      throw new Error(`Translation error: ${error.message}`);
    }
  }
  
  /**
   * Create the prompt for the Gemini model
   * @param {string} query The natural language query
   * @returns {string} The prompt for Gemini
   */
  createTranslationPrompt(query) {
    // Format node information
    const nodeLabels = this.schemaInfo.nodes.map(n => n.label).join(', ');
    const nodePropertiesText = this.schemaInfo.nodes
      .map(n => `${n.label} (${n.count} nodes): ${n.properties.join(', ')}`)
      .join('\n');
    
    // Format relationship information
    const relationshipTypes = this.schemaInfo.relationships.map(r => r.type).join(', ');
    const relationshipPropertiesText = this.schemaInfo.relationships
      .map(r => `${r.type}: ${r.properties.join(', ')}`)
      .join('\n');
    
    return `
You are a Neo4j Cypher query generator. Convert the following natural language question into a valid Cypher query that can be run against a Neo4j graph database.

GRAPH SCHEMA:
Node Labels: ${nodeLabels}

Node Properties by Label:
${nodePropertiesText}

Relationship Types: ${relationshipTypes}

Relationship Properties by Type:
${relationshipPropertiesText}

RULES:
1. Always use appropriate labels and relationship types from the schema
2. Use appropriate properties from the schema
3. Only return specific properties that are requested in the query, not entire nodes
4. If no specific properties are requested, return node names, types, or the most relevant properties
5. Use case-insensitive matching when searching text properties
6. For name matching, use CONTAINS or =~ for partial matching
7. Provide a Cypher query that would run in Neo4j
8. Respond ONLY with the Cypher query, nothing else

NATURAL LANGUAGE QUERY:
${query}

CYPHER QUERY:
`;
  }
  
  /**
   * Extract the Cypher query from the LLM response
   * @param {string} response The LLM response
   * @returns {string} The extracted Cypher query
   */
  extractCypherQuery(response) {
    // Clean up the response to extract just the Cypher query
    let query = response.trim();
    
    // Remove markdown code blocks if present
    if (query.startsWith("```cypher")) {
      query = query.replace(/```cypher\n/, "").replace(/```$/, "");
    } else if (query.startsWith("```")) {
      query = query.replace(/```\n/, "").replace(/```$/, "");
    }
    
    return query.trim();
  }
  
  /**
   * Execute a Cypher query
   * @param {string} cypherQuery The Cypher query to execute
   * @param {Object} params Parameters for the query
   * @returns {Promise<Array>} The query results
   */
  async executeQuery(cypherQuery, params = {}) {
    const driver = this.neo4jService.driver;
    const session = driver.session();
    
    try {
      console.log(`Executing Cypher query: ${cypherQuery}`);
      const result = await session.run(cypherQuery, params);
      return result.records;
    } catch (error) {
      console.error('Error executing Cypher query:', error);
      throw error;
    } finally {
      await session.close();
    }
  }
}

module.exports = new QueryTranslationService(); 