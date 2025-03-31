const OpenAI = require('openai');

// Check if API key is present
if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
}

/**
 * OpenAI Service for NLP operations 
 */
class OpenAIService {
    constructor(config = {}) {
        this.apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
        this.client = new OpenAI({
            apiKey: this.apiKey
        });
        
        // Initialize ontology
        this.ontology = {
            labels: [
                "EnergyTechnology",      // e.g., Solar PV, Wind Turbine
                "EnergyResource",        // e.g., Solar Radiation, Wind
                "EnergyMarket",          // e.g., Electricity Market, Carbon Market
                "EnergyPolicy",          // e.g., Renewable Energy Policy, Carbon Tax
                "EnergyInfrastructure",  // e.g., Power Grid, Transmission Line
                "EnergyConsumer",        // e.g., Industrial Facility, Residential Building
                "EnergyProducer",        // e.g., Power Plant, Solar Farm
                "EnergyStorage",         // e.g., Battery, Pumped Hydro
                "EnergyRegulator",       // e.g., Energy Regulatory Authority
                "EnergyServiceProvider", // e.g., Utility Company, Energy Retailer
                "EnergyLocation",        // e.g., Power Plant Site, Grid Connection Point
                "EnergyProject",         // e.g., Renewable Energy Project, Grid Upgrade
                "EnergyData",            // e.g., Energy Consumption Data, Market Prices
                "EnergySystem",          // e.g., Power System, Microgrid
                "EnergyComponent",       // e.g., Inverter, Transformer
                "BusinessEntity",        // e.g., Company, Organization
                "LegalEntity",           // e.g., HOA, Government Agency
                "Community",             // e.g., Residential Community, Industrial Park
                "Agreement",             // e.g., Contract, Memorandum of Understanding
                "Project",               // e.g., Development Project, Construction Project
                "Location",              // e.g., Property, Site
                "Asset",                 // e.g., Equipment, Facility
                "Document",              // e.g., Report, Study
                "Event"                  // e.g., Meeting, Hearing
            ],
            relationship_descriptor: "Relationships between entities in the energy sector, including technical, economic, regulatory, spatial, and business relationships",
            relationship_types: [
                // Technical Energy Relationships
                "produces",              // EnergyProducer -> EnergyResource
                "consumes",              // EnergyConsumer -> EnergyResource
                "transmits",             // EnergyInfrastructure -> EnergyLocation
                "distributes",           // EnergyInfrastructure -> EnergyConsumer
                "stores",                // EnergyStorage -> EnergyResource
                "generates",             // EnergyTechnology -> EnergyResource
                "connects",              // EnergyInfrastructure -> EnergyInfrastructure
                "composes",              // EnergySystem -> EnergyComponent
                "locatedAt",             // EnergyTechnology -> EnergyLocation

                // Business and Legal Relationships
                "hasAgreementWith",      // Entity -> Entity (with Agreement)
                "isPartyTo",             // Entity -> Agreement
                "owns",                  // Entity -> Asset
                "operates",              // Entity -> Asset/Infrastructure
                "manages",               // Entity -> Project/System
                "providesServiceTo",     // Entity -> Entity
                "receivesServiceFrom",   // Entity -> Entity
                "affects",               // Entity -> Entity
                "influences",            // Entity -> Entity
                "interactsWith",         // Entity -> Entity
                "participatesIn",        // Entity -> Event/Project
                "organizes",             // Entity -> Event
                "attends",               // Entity -> Event
                "submits",               // Entity -> Document
                "reviews",               // Entity -> Document
                "approves",              // Entity -> Document/Project
                "rejects",               // Entity -> Document/Project
                "commentsOn",            // Entity -> Document/Event
                "represents",            // Entity -> Entity
                "advises",               // Entity -> Entity
                "consults",              // Entity -> Entity
                "collaboratesWith",      // Entity -> Entity
                "competesWith",          // Entity -> Entity
                "supports",              // Entity -> Entity/Project
                "opposes",               // Entity -> Entity/Project
                "regulates",             // Entity -> Entity/Market
                "enforces",              // Entity -> Policy/Market
                "monitors",              // Entity -> System/Project
                "reportsTo",             // Entity -> Entity
                "isPartOf",              // Entity -> Entity
                "contains",              // Entity -> Entity
                "belongsTo",             // Entity -> Entity
                "associatesWith",        // Entity -> Entity
                "relatesTo",             // Entity -> Entity
                "impacts",               // Entity -> Entity
                "affectsRevenueOf",      // Entity -> Entity
                "affectsCostOf",         // Entity -> Entity
                "affectsOperationOf",    // Entity -> Entity
                "affectsDevelopmentOf",  // Entity -> Entity
                "affectsMaintenanceOf",  // Entity -> Entity
                "affectsSafetyOf",       // Entity -> Entity
                "affectsReliabilityOf",  // Entity -> Entity
                "affectsEfficiencyOf",   // Entity -> Entity
                "affectsSustainabilityOf" // Entity -> Entity
            ]
        };
    }
    
    /**
     * Extract entities and relationships from text
     * @private
     * @param {string} text - Input text
     * @param {object} metadata - Metadata about the text
     * @returns {Promise<{nodes: Array, relationships: Array}>} - Extracted nodes and relationships
     */
    async extractEntitiesAndRelationships(text, metadata) {
        try {
            if (!text || text.trim().length === 0) {
                throw new Error('Input text is empty');
            }

            // Limit text length to avoid token limits
            const maxTextLength = 4000;
            const truncatedText = text.length > maxTextLength 
                ? text.substring(0, maxTextLength) + '...' 
                : text;

            console.log('Processing text:', truncatedText.substring(0, 100) + '...');
            const prompt = this.createPrompt(truncatedText);
            
            console.log('Sending request to OpenAI...');
            const completion = await this.client.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant that extracts entities and relationships from text. You must always respond with valid JSON. Keep the response concise and focused on the most important entities and relationships."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.0,
                max_tokens: 2000
            });

            console.log('Received response from OpenAI');
            const result = completion.choices[0].message.content;
            console.log('Raw OpenAI response:', result);
            
            const parsed = this.parseResponse(result);

            // Add metadata to relationships
            parsed.relationships = parsed.relationships.map(rel => ({
                ...rel,
                metadata: {
                    ...metadata,
                    ...rel.metadata
                }
            }));

            return parsed;
        } catch (error) {
            console.error('Detailed error in extractEntitiesAndRelationships:', error);
            if (error.response) {
                console.error('OpenAI API Error:', error.response.data);
            }
            throw new Error(`Failed to extract entities and relationships: ${error.message}`);
        }
    }
    
    /**
     * Create a prompt for entity and relationship extraction
     * @private
     * @param {string} text - Input text
     * @returns {string} - Formatted prompt
     */
    createPrompt(text) {
        return `Analyze the following text to extract all entities and their relationships. 
Focus on organizations, people, projects, locations, technologies, regulations, agreements, and concepts.

TEXT:
${text}

Output a JSON object with two arrays: "nodes" and "relationships". 
For each node, provide:
- id (a unique identifier like "n1", "n2", etc.)
- name (exact entity name as it appears in the text)
- label (entity type - choose from: ${this.ontology.labels.join(', ')})
- properties (optional object with additional information)

For each relationship, provide:
- source (id of the source node)
- target (id of the target node)
- type (relationship type - choose from: ${this.ontology.relationship_types.slice(0, 10).join(', ')}, etc.)
- evidence (brief text evidence for this relationship)

Example format:
{
  "nodes": [
    {
      "id": "n1",
      "name": "ERCOT",
      "label": "EnergyRegulator",
      "properties": {
        "fullName": "Electric Reliability Council of Texas"
      }
    },
    {
      "id": "n2",
      "name": "Solar Project",
      "label": "EnergyProject"
    }
  ],
  "relationships": [
    {
      "source": "n1",
      "target": "n2",
      "type": "regulates",
      "evidence": "ERCOT oversees the Solar Project implementation"
    }
  ]
}

Only include entities and relationships that are clearly mentioned in the text. Be precise with entity names and relationships.`;
    }
    
    /**
     * Parse the response from OpenAI into nodes and relationships
     * @private
     * @param {string} response - Raw API response
     * @returns {object} - Parsed nodes and relationships
     */
    parseResponse(response) {
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/{[\s\S]*}/);
            if (!jsonMatch) {
                throw new Error('No valid JSON found in response');
            }
            
            const jsonString = jsonMatch[0];
            const parsed = JSON.parse(jsonString);
            
            if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
                throw new Error('Response does not contain nodes array');
            }
            
            if (!parsed.relationships || !Array.isArray(parsed.relationships)) {
                console.warn('Response does not contain relationships array');
                parsed.relationships = [];
            }
            
            console.log(`Extracted ${parsed.nodes.length} nodes and ${parsed.relationships.length} relationships`);
            return parsed;
        } catch (error) {
            console.error('Error parsing response:', error);
            console.error('Raw response:', response);
            // Return empty structure on error
            return { nodes: [], relationships: [] };
        }
    }
    
    /**
     * Extract entities from text
     * @param {string} text - Input text
     * @returns {Promise<Array>} - Array of extracted entities with types
     */
    async extractEntities(text) {
        try {
            console.log('OpenAIService.extractEntities called - this indicates Gemini may not be properly initialized');
            const result = await this.extractEntitiesAndRelationships(text, { type: 'entity_extraction' });
            return result.nodes.map(node => ({
                id: node.id,
                name: node.name,
                type: node.label,
                confidence: 0.8
            }));
        } catch (error) {
            console.error('Error in extractEntities:', error);
            return [];
        }
    }

    /**
     * Extract relationships between entities in text
     * @param {string} text - Input text
     * @param {Array} entities - Previously extracted entities 
     * @returns {Promise<Array>} - Array of relationships
     */
    async extractRelationships(text, entities) {
        try {
            // If we have no entities or only one entity, we can't extract relationships
            if (!entities || entities.length < 2) {
                return [];
            }
            
            console.log('OpenAIService.extractRelationships called - this indicates Gemini may not be properly initialized');
            const result = await this.extractEntitiesAndRelationships(text, { type: 'relationship_extraction' });
            
            // Map the relationships to use entity names instead of IDs
            return result.relationships.map(rel => {
                // Find the source and target entities in the result nodes
                const sourceNode = result.nodes.find(node => node.id === rel.source);
                const targetNode = result.nodes.find(node => node.id === rel.target);
                
                // If we can't find the nodes, skip this relationship
                if (!sourceNode || !targetNode) {
                    return null;
                }
                
                return {
                    source: sourceNode.name,
                    target: targetNode.name,
                    type: rel.type,
                    confidence: 0.7
                };
            }).filter(Boolean); // Remove null entries
        } catch (error) {
            console.error('Error in extractRelationships:', error);
            return [];
        }
    }

    /**
     * Extract temporal information and sentiment from text
     * @param {string} text - Input text
     * @param {Array} entities - Previously extracted entities
     * @returns {Promise<Object>} - Temporal information and sentiment analysis
     */
    async extractTemporalAndSentiment(text, entities) {
        try {
            console.log('OpenAIService.extractTemporalAndSentiment called - this indicates Gemini may not be properly initialized');
            // Basic implementation - can be enhanced later
            return {
                temporal: [],
                opinions: []
            };
        } catch (error) {
            console.error('Error in extractTemporalAndSentiment:', error);
            return {
                temporal: [],
                opinions: []
            };
        }
    }
    
    // Utility methods from the original file
    calculateStringSimilarity(str1, str2) {
        const s1 = str1.toLowerCase();
        const s2 = str2.toLowerCase();
        
        // If one string contains the other, they're likely the same entity
        if (s1.includes(s2) || s2.includes(s1)) {
            return 0.8;
        }
        
        // Calculate Levenshtein distance
        const matrix = Array(s1.length + 1).fill().map(() => Array(s2.length + 1).fill(0));
        
        for (let i = 0; i <= s1.length; i++) matrix[i][0] = i;
        for (let j = 0; j <= s2.length; j++) matrix[0][j] = j;
        
        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }
        
        const maxLength = Math.max(s1.length, s2.length);
        return 1 - (matrix[s1.length][s2.length] / maxLength);
    }

    normalizeEntityName(name) {
        return name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[.,]/g, '')
            .replace(/\b(l\.?l\.?c\.?|l\.?p\.?|inc\.?|corp\.?|corporation)\b/g, '')
            .replace(/\b(technologies|operations|utility|company|community|association|district|hoa)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    async processChunks(chunks) {
        const graphBuilder = new GraphBuilder();

        for (const chunk of chunks) {
            try {
                const { nodes, relationships } = await this.extractEntitiesAndRelationships(chunk.text, chunk.metadata);
                
                // Process nodes first
                for (const node of nodes) {
                    graphBuilder.findOrCreateNode(node);
                }

                // Then process relationships
                for (const rel of relationships) {
                    graphBuilder.addRelationship(rel);
                }
            } catch (error) {
                console.error(`Error processing chunk ${chunk.metadata.chunk_index}:`, error);
            }
        }

        const graph = graphBuilder.getGraph();
        console.log(`Final graph contains ${graph.nodes.length} nodes and ${graph.relationships.length} relationships`);
        return graph;
    }
}

// Keep GraphBuilder class as is
class GraphBuilder {
    constructor() {
        this.nodes = new Map(); // Map of normalized name to node
        this.nodeVariations = new Map(); // Map of original name to normalized name
        this.relationships = [];
        this.nextNodeId = 1;
        this.idToNode = new Map(); // Map of numeric ID to node
    }

    findOrCreateNode(node) {
        const normalizedName = normalizeEntityName(node.name);
        
        // First try exact match
        if (this.nodes.has(normalizedName)) {
            const existingNode = this.nodes.get(normalizedName);
            this.nodeVariations.set(node.name, normalizedName);
            return existingNode;
        }

        // Try fuzzy matching with existing nodes
        let bestMatch = null;
        let bestSimilarity = 0.7; // Threshold for considering a match

        for (const [existingName, existingNode] of this.nodes) {
            const similarity = calculateStringSimilarity(normalizedName, existingName);
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = existingNode;
            }
        }

        if (bestMatch) {
            console.log(`Fuzzy matched node: "${node.name}" -> "${bestMatch.originalName}" (similarity: ${bestSimilarity})`);
            this.nodeVariations.set(node.name, normalizeEntityName(bestMatch.originalName));
            return bestMatch;
        }

        // Create new node if no match found
        const newNode = {
            id: `node_${this.nextNodeId++}`,
            name: node.name,
            originalName: node.name,
            label: node.label || 'Entity', // Default label if none provided
            properties: node.properties || {},
            normalizedName
        };

        this.nodes.set(normalizedName, newNode);
        this.nodeVariations.set(node.name, normalizedName);
        console.log(`Created new node: "${node.name}" (normalized: "${normalizedName}", label: "${newNode.label}")`);
        return newNode;
    }

    addRelationship(rel) {
        // Find or create source and target nodes
        const sourceNode = this.findOrCreateNode({ 
            name: rel.source, 
            label: rel.source_label || 'Entity' 
        });
        const targetNode = this.findOrCreateNode({ 
            name: rel.target, 
            label: rel.target_label || 'Entity' 
        });

        // Create relationship using node IDs
        const relationship = {
            source: sourceNode.id,
            target: targetNode.id,
            type: rel.type,
            source_label: sourceNode.label,
            target_label: targetNode.label,
            metadata: rel.metadata
        };

        this.relationships.push(relationship);
        console.log(`Created relationship: ${sourceNode.originalName} -[${rel.type}]-> ${targetNode.originalName}`);
    }

    getGraph() {
        return {
            nodes: Array.from(this.nodes.values()),
            relationships: this.relationships
        };
    }
}

// Helper functions needs to be moved to the class or kept for backward compatibility
function calculateStringSimilarity(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    // If one string contains the other, they're likely the same entity
    if (s1.includes(s2) || s2.includes(s1)) {
        return 0.8;
    }
    
    // Calculate Levenshtein distance
    const matrix = Array(s1.length + 1).fill().map(() => Array(s2.length + 1).fill(0));
    
    for (let i = 0; i <= s1.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= s2.length; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= s1.length; i++) {
        for (let j = 1; j <= s2.length; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    
    const maxLength = Math.max(s1.length, s2.length);
    return 1 - (matrix[s1.length][s2.length] / maxLength);
}

function normalizeEntityName(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[.,]/g, '')
        .replace(/\b(l\.?l\.?c\.?|l\.?p\.?|inc\.?|corp\.?|corporation)\b/g, '')
        .replace(/\b(technologies|operations|utility|company|community|association|district|hoa)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Export the OpenAIService class
module.exports = OpenAIService; 