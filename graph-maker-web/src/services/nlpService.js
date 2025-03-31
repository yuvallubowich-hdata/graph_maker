const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAIService = require('./openaiService');

// Check if API key is present
if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
}

/**
 * Service for NLP operations including Named Entity Recognition,
 * Relationship Extraction, and Temporal/Sentiment Analysis
 */
class NlpService {
    constructor() {
        this.entityTypes = [
            // People and Organizations
            "Person",               // Individual people (e.g., expert witnesses, regulators)
            "Organization",         // Companies, regulatory bodies, agencies
            
            // Domain-specific entities
            "EnergyCompany",        // Energy producers, utilities, service providers
            "RegulatoryBody",       // Government or regulatory agencies
            "LegalEntity",          // Legal entities like HOAs
            
            // Projects and Cases
            "Project",              // Energy projects, development initiatives
            "LegalCase",            // Legal or regulatory cases (e.g., "CenterPoint rate case")
            "Agreement",            // Contracts, agreements, MOUs
            
            // Places and Locations
            "Location",             // Physical locations, facilities, regions
            "Facility",             // Energy facilities, infrastructure
            
            // Concepts and Topics
            "Topic",                // Subject matters, issues, regulatory topics
            "Concept",              // Abstract concepts in energy domain
            "Policy",               // Energy policies, regulatory frameworks
            "Technology",           // Energy technologies
            
            // Time and Documents
            "TimeExpression",       // Dates, time periods, timelines
            "Document",             // Reports, filings, testimonies
            "Event"                 // Meetings, hearings, proceedings
        ];
        
        this.relationshipTypes = [
            // Person/Organization Relationships
            "isEmployedBy",         // Person -> Organization
            "representsInterestsOf", // Person/Organization -> Organization/Person
            "affiliatedWith",       // Person -> Organization
            "collaboratesWith",     // Person/Organization -> Person/Organization
            
            // Document Relationships
            "authoredBy",           // Document -> Person
            "publishedBy",          // Document -> Organization
            "mentionsEntity",       // Document -> Any Entity
            "citesDocument",        // Document -> Document
            "refersTo",             // Document -> Topic/Concept/Event
            
            // Case/Project Relationships
            "participatesIn",       // Person/Organization -> Project/LegalCase/Event
            "testifiedIn",          // Person -> LegalCase
            "ruledOn",              // RegulatoryBody -> LegalCase/Project
            "regulatesEntity",      // RegulatoryBody -> Organization/Facility
            
            // Opinion and Temporal Relationships
            "hasOpinionOn",         // Person -> Topic/Concept
            "changedOpinionAbout",  // Person -> Topic/Concept (with temporal aspect)
            "advocatesFor",         // Person/Organization -> Policy/Project/Concept
            "opposesPosition",      // Person/Organization -> Policy/Project/Concept
            
            // Asset and Location Relationships
            "locatedIn",            // Organization/Facility -> Location
            "operates",             // Organization -> Facility
            "owns",                 // Organization -> Facility/Project
            "affectsArea",          // Project/Policy -> Location
            
            // Temporal Relationships
            "occursAt",             // Event -> TimeExpression
            "implementedDuring",    // Project/Policy -> TimeExpression
            "validDuring",          // Agreement/Policy -> TimeExpression
            
            // Semantic/Business Relationships
            "hasAgreementWith",     // Organization -> Organization
            "providesServiceTo",    // Organization -> Organization/Person
            "impactsOperationsOf",  // Policy/Project -> Organization
            "influencesDecisionOf", // Document/Person -> RegulatoryBody
            "approves",             // RegulatoryBody -> Project/Agreement
            "monitors",             // RegulatoryBody/Organization -> Facility/Project
            "reportsTo",            // Person/Organization -> Person/Organization
            "fundedBy",             // Project -> Organization
            
            // General relationships
            "relatedTo",            // Generic relationship between entities
            "partOf",               // Hierarchical relationship
            "hasMember"             // Membership relationship
        ];

        // Initialize OpenAI service using the class
        this.openaiService = new OpenAIService({
            openaiApiKey: process.env.OPENAI_API_KEY
        });
        
        // Default LLM provider
        this.llmProvider = process.env.LLM_PROVIDER || 'openai';
        
        // Initialize Google's Generative AI if configured
        if (this.llmProvider === 'gemini' && process.env.GEMINI_API_KEY) {
            this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            this.geminiModel = this.genAI.getGenerativeModel({
                model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
                generationConfig: {
                    temperature: 0.2,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 8192,
                }
            });
            console.log(`Initialized Google Gemini model: ${process.env.GEMINI_MODEL || 'gemini-1.5-flash'}`);
        } else {
            console.log(`Using OpenAI as LLM provider`);
        }
    }

    /**
     * Extract named entities from text
     * @param {string} text - Input text
     * @param {object} options - Processing options
     * @returns {Promise<Array>} - Array of extracted entities with types and metadata
     */
    async extractEntities(text, options = {}) {
        try {
            // Use llmProvider from options if provided, otherwise use the default
            const llmProvider = options.llmProvider || this.llmProvider;
            console.log(`Extracting entities using ${llmProvider} provider`);
            
            // Check if we need to initialize Gemini on-demand when selected from UI
            if (llmProvider === 'gemini' && !this.geminiModel && process.env.GEMINI_API_KEY) {
                console.log('Initializing Gemini model on-demand...');
                this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                this.geminiModel = this.genAI.getGenerativeModel({
                    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
                    generationConfig: {
                        temperature: 0.2,
                        topP: 0.8,
                        topK: 40,
                        maxOutputTokens: 8192,
                    }
                });
                console.log(`On-demand initialization of Google Gemini model: ${process.env.GEMINI_MODEL || 'gemini-1.5-flash'}`);
            }
            
            // Debug info about providers
            if (llmProvider === 'gemini') {
                if (this.geminiModel) {
                    console.log('Using Gemini model for entity extraction');
                } else {
                    console.log('WARNING: Gemini selected but model not initialized - falling back to OpenAI');
                }
            }
            
            if (llmProvider === 'gemini' && this.geminiModel) {
                return await this._extractEntitiesWithGemini(text);
            } else {
                return await this.openaiService.extractEntities(text);
            }
        } catch (error) {
            console.error('Error extracting entities:', error);
            throw error;
        }
    }

    /**
     * Extract relationships between entities in text
     * @param {string} text - Input text
     * @param {Array} entities - Previously extracted entities 
     * @param {object} options - Processing options
     * @returns {Promise<Array>} - Array of relationships
     */
    async extractRelationships(text, entities, options = {}) {
        try {
            // Use llmProvider from options if provided, otherwise use the default
            const llmProvider = options.llmProvider || this.llmProvider;
            console.log(`Extracting relationships using ${llmProvider} provider`);
            
            // Check if we need to initialize Gemini on-demand when selected from UI
            if (llmProvider === 'gemini' && !this.geminiModel && process.env.GEMINI_API_KEY) {
                console.log('Initializing Gemini model on-demand...');
                this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                this.geminiModel = this.genAI.getGenerativeModel({
                    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
                    generationConfig: {
                        temperature: 0.2,
                        topP: 0.8,
                        topK: 40,
                        maxOutputTokens: 8192,
                    }
                });
                console.log(`On-demand initialization of Google Gemini model: ${process.env.GEMINI_MODEL || 'gemini-1.5-flash'}`);
            }
            
            if (llmProvider === 'gemini' && this.geminiModel) {
                return await this._extractRelationshipsWithGemini(text, entities);
            } else {
                return await this.openaiService.extractRelationships(text, entities);
            }
        } catch (error) {
            console.error('Error extracting relationships:', error);
            throw error;
        }
    }

    /**
     * Extract temporal information and sentiment from text
     * @param {string} text - Input text
     * @param {Array} entities - Previously extracted entities
     * @param {object} options - Processing options
     * @returns {Promise<Object>} - Temporal information and sentiment analysis
     */
    async extractTemporalAndSentiment(text, entities, options = {}) {
        try {
            // Use llmProvider from options if provided, otherwise use the default
            const llmProvider = options.llmProvider || this.llmProvider;
            console.log(`Extracting temporal and sentiment using ${llmProvider} provider`);
            
            // Check if we need to initialize Gemini on-demand when selected from UI
            if (llmProvider === 'gemini' && !this.geminiModel && process.env.GEMINI_API_KEY) {
                console.log('Initializing Gemini model on-demand...');
                this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                this.geminiModel = this.genAI.getGenerativeModel({
                    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
                    generationConfig: {
                        temperature: 0.2,
                        topP: 0.8,
                        topK: 40,
                        maxOutputTokens: 8192,
                    }
                });
                console.log(`On-demand initialization of Google Gemini model: ${process.env.GEMINI_MODEL || 'gemini-1.5-flash'}`);
            }
            
            if (llmProvider === 'gemini' && this.geminiModel) {
                return await this._extractTemporalAndSentimentWithGemini(text, entities);
            } else {
                return await this.openaiService.extractTemporalAndSentiment(text, entities);
            }
        } catch (error) {
            console.error('Error extracting temporal and sentiment info:', error);
            throw error;
        }
    }

    /**
     * Extract entities from text using Google's Gemini model
     * @private
     * @param {string} text - The text to extract entities from
     * @returns {Promise<Array>} - Array of entities
     */
    async _extractEntitiesWithGemini(text) {
        try {
            console.time('gemini-entity-extraction');
            
            // Define entity types for extraction
            const entityTypes = [
                "Person", "Organization", "EnergyCompany", "RegulatoryBody", 
                "Project", "LegalCase", "Document", "Location", "Facility"
            ];
            
            const prompt = `
            Extract all entities from the following text. Only include entities that are definitely mentioned in the text.
            For each entity, determine its type, a brief description, and any aliases or alternative names.
            
            Entity types to extract:
            ${entityTypes.join(', ')}
            
            Output the results in valid JSON format with the following structure:
            {
              "entities": [
                {
                  "name": "entity name",
                  "type": "entity type from the list",
                  "description": "brief description based on the text",
                  "aliases": ["alias1", "alias2"]
                }
              ]
            }
            
            Only include entities that are clearly identifiable in the text. Ensure JSON is perfectly valid.
            If no entities are found, return an empty array: {"entities": []}
            
            TEXT:
            ${text}
            `;
            
            const result = await this.geminiModel.generateContent(prompt);
            const response = await result.response;
            const responseText = response.text();
            
            try {
                // Extract JSON from the response
                const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                                 responseText.match(/```\n([\s\S]*?)\n```/) ||
                                 responseText.match(/{[\s\S]*}/);
                
                let jsonString = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
                
                // Clean the JSON string
                jsonString = jsonString.replace(/^```json\s*|\s*```$/g, '');
                jsonString = jsonString.replace(/^```\s*|\s*```$/g, '');
                
                // Parse the JSON
                const parsedData = JSON.parse(jsonString);
                
                // Add confidence scores and IDs to entities
                const entities = (parsedData.entities || []).map(entity => ({
                    ...entity,
                    id: `entity_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    confidence: 0.9,
                    aliases: entity.aliases || []
                }));
                
                console.timeEnd('gemini-entity-extraction');
                console.log(`Extracted ${entities.length} entities with Gemini`);
                
                return entities;
            } catch (parseError) {
                console.error('Error parsing Gemini entity response:', parseError);
                console.error('Raw response:', responseText);
                return [];
            }
        } catch (error) {
            console.error('Error extracting entities with Gemini:', error);
            return [];
        }
    }

    /**
     * Extract relationships from text using Google's Gemini model
     * @private
     * @param {string} text - The text to extract relationships from
     * @param {Array} entities - The entities to extract relationships for
     * @returns {Promise<Array>} - Array of relationships
     */
    async _extractRelationshipsWithGemini(text, entities) {
        if (!entities || entities.length < 2) {
            return [];
        }
        
        try {
            console.time('gemini-relationship-extraction');
            
            // Get entity names
            const entityNames = entities.map(entity => entity.name);
            
            // Define relationship types
            const relationshipTypes = [
                "owns", "operatedBy", "contractsWith", "regulatedBy", "supplies", 
                "hasSubsidiary", "investsIn", "competitorOf", "partneredWith", 
                "memberOf", "locatedIn", "developedBy", "employeeOf", "customerOf"
            ];
            
            const prompt = `
            Extract relationships between the entities in the following text. Only include relationships that are explicitly mentioned.
            
            Entities:
            ${entityNames.join(', ')}
            
            Relationship types to extract:
            ${relationshipTypes.join(', ')}
            
            For each relationship, identify:
            1. Source entity (from the provided list)
            2. Target entity (from the provided list)
            3. Relationship type (from the list above)
            4. Evidence - quote from the text that supports this relationship
            
            Output in valid JSON format with the following structure:
            {
              "relationships": [
                {
                  "source": "source entity name",
                  "target": "target entity name",
                  "type": "relationship type",
                  "evidence": "text evidence for this relationship"
                }
              ]
            }
            
            Only include relationships explicitly mentioned in the text. Ensure JSON is perfectly valid.
            If no relationships are found, return an empty array: {"relationships": []}
            
            TEXT:
            ${text}
            `;
            
            const result = await this.geminiModel.generateContent(prompt);
            const response = await result.response;
            const responseText = response.text();
            
            try {
                // Extract JSON from the response
                const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                                 responseText.match(/```\n([\s\S]*?)\n```/) ||
                                 responseText.match(/{[\s\S]*}/);
                
                let jsonString = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
                
                // Clean the JSON string
                jsonString = jsonString.replace(/^```json\s*|\s*```$/g, '');
                jsonString = jsonString.replace(/^```\s*|\s*```$/g, '');
                
                // Parse the JSON
                const parsedData = JSON.parse(jsonString);
                
                // Add confidence scores to relationships
                const relationships = (parsedData.relationships || []).map(rel => ({
                    ...rel,
                    confidence: 0.8
                }));
                
                console.timeEnd('gemini-relationship-extraction');
                console.log(`Extracted ${relationships.length} relationships with Gemini`);
                
                return relationships;
            } catch (parseError) {
                console.error('Error parsing Gemini relationship response:', parseError);
                console.error('Raw response:', responseText);
                return [];
            }
        } catch (error) {
            console.error('Error extracting relationships with Gemini:', error);
            return [];
        }
    }

    /**
     * Extract temporal and sentiment information using Google's Gemini model
     * @private
     * @param {string} text - The text to extract temporal and sentiment from
     * @param {Array} entities - The entities to extract temporal and sentiment for
     * @returns {Promise<Object>} - Object with temporal and sentiment information
     */
    async _extractTemporalAndSentimentWithGemini(text, entities) {
        if (!entities || entities.length === 0) {
            return { temporal: [], opinions: [] };
        }
        
        try {
            console.time('gemini-temporal-sentiment-extraction');
            
            // Get entity names
            const entityNames = entities.map(entity => entity.name);
            
            const prompt = `
            Extract temporal expressions and opinions/sentiment related to entities from the following text.
            
            Entities:
            ${entityNames.join(', ')}
            
            1. Temporal Expressions:
               - Identify when entities are associated with specific dates or time periods
               - Include the entity name, temporal expression, and evidence from the text
            
            2. Opinions/Sentiment:
               - Identify opinions or sentiment expressed about or by entities
               - Include the entity expressing the opinion, the topic, sentiment value (-1 to +1), and evidence
            
            Output in valid JSON format with the following structure:
            {
              "temporal": [
                {
                  "entity": "entity name",
                  "value": "temporal expression (date/time period)",
                  "evidence": "text evidence"
                }
              ],
              "opinions": [
                {
                  "entity": "entity expressing opinion",
                  "topic": "topic of opinion (can be another entity)",
                  "value": 0.5,
                  "evidence": "text evidence"
                }
              ]
            }
            
            Only include information explicitly mentioned in the text. Ensure JSON is perfectly valid.
            If nothing is found, return empty arrays: {"temporal": [], "opinions": []}
            
            TEXT:
            ${text}
            `;
            
            const result = await this.geminiModel.generateContent(prompt);
            const response = await result.response;
            const responseText = response.text();
            
            try {
                // Extract JSON from the response
                const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                                 responseText.match(/```\n([\s\S]*?)\n```/) ||
                                 responseText.match(/{[\s\S]*}/);
                
                let jsonString = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
                
                // Clean the JSON string
                jsonString = jsonString.replace(/^```json\s*|\s*```$/g, '');
                jsonString = jsonString.replace(/^```\s*|\s*```$/g, '');
                
                // Parse the JSON
                const parsedData = JSON.parse(jsonString);
                
                const result = {
                    temporal: parsedData.temporal || [],
                    opinions: parsedData.opinions || []
                };
                
                console.timeEnd('gemini-temporal-sentiment-extraction');
                console.log(`Extracted ${result.temporal.length} temporal expressions and ${result.opinions.length} opinions with Gemini`);
                
                return result;
            } catch (parseError) {
                console.error('Error parsing Gemini temporal/sentiment response:', parseError);
                console.error('Raw response:', responseText);
                return { temporal: [], opinions: [] };
            }
        } catch (error) {
            console.error('Error extracting temporal and sentiment with Gemini:', error);
            return { temporal: [], opinions: [] };
        }
    }

    /**
     * Create a prompt for entity extraction
     * @private
     * @param {string} text - Input text
     * @returns {string} - Formatted prompt
     */
    _createEntityExtractionPrompt(text) {
        return `Extract entities from the following text. Focus on identifying the most important and relevant entities of the following types: ${this.entityTypes.join(", ")}.

Text:
${text}

For each entity, provide:
1. The entity name (exactly as it appears in the text)
2. The entity type (must be one of: ${this.entityTypes.join(", ")})
3. A brief description or context from the text
4. Any aliases or alternative names mentioned

Format your response as a JSON object with an "entities" array of objects, where each object has the following properties:
- name: The entity name
- type: The entity type
- description: Brief description or context
- aliases: Array of alternative names (if any)

IMPORTANT: Use proper JSON format with double quotes for all property names and string values. Do not use single quotes or unescaped special characters.

Example response format:
{
  "entities": [
    {
      "name": "John Smith",
      "type": "Person",
      "description": "Expert witness in the rate case",
      "aliases": ["Dr. Smith", "J. Smith"]
    },
    {
      "name": "CenterPoint Energy",
      "type": "EnergyCompany",
      "description": "Utility company involved in the rate case",
      "aliases": ["CenterPoint", "CPE"]
    }
  ]
}

Return only the JSON object with no additional text, markdown, or code blocks.`;
    }

    /**
     * Create a prompt for relationship extraction
     * @private
     * @param {string} text - Input text
     * @param {Array} entities - Previously extracted entities
     * @returns {string} - Formatted prompt
     */
    _createRelationshipExtractionPrompt(text, entities) {
        const entityList = entities.map(e => `${e.name} (${e.type})`).join("\n- ");
        
        return `Extract relationships between entities from the following text. Consider only relationships between the entities listed below.

Text:
${text}

Entities:
- ${entityList}

Relationship types:
${this.relationshipTypes.join(", ")}

For each relationship, provide:
1. Source entity (must be from the list above)
2. Target entity (must be from the list above)
3. Relationship type (must be one of the types listed above)
4. A brief description or supporting evidence from the text

Format your response as a JSON object with a "relationships" array of objects, where each object has the following properties:
- source: The source entity name
- target: The target entity name
- type: The relationship type
- evidence: Supporting evidence from the text

IMPORTANT: Use proper JSON format with double quotes for all property names and string values. Do not use single quotes or unescaped special characters.

Example response format:
{
  "relationships": [
    {
      "source": "John Smith",
      "target": "CenterPoint Energy",
      "type": "testifiedIn",
      "evidence": "John Smith provided expert testimony regarding CenterPoint Energy's rate case."
    },
    {
      "source": "Regulatory Filing #123",
      "target": "Rate Case Hearing",
      "type": "relatedTo",
      "evidence": "The regulatory filing was submitted as part of the rate case hearing documentation."
    }
  ]
}

Return only the JSON object with no additional text, markdown, or code blocks.`;
    }

    /**
     * Create a prompt for temporal and sentiment extraction
     * @private
     * @param {string} text - Input text
     * @param {Array} entities - Previously extracted entities
     * @returns {string} - Formatted prompt
     */
    _createTemporalSentimentPrompt(text, entities) {
        const personEntities = entities
            .filter(e => e.type === "Person")
            .map(e => e.name)
            .join(", ");
            
        const topicEntities = entities
            .filter(e => ["Topic", "Concept", "Policy", "Technology"].includes(e.type))
            .map(e => e.name)
            .join(", ");
        
        return `Extract temporal information and sentiments from the following text. Focus on dates, time periods, opinions, and sentiment.

Text:
${text}

If present, analyze opinions and sentiments for the following people: ${personEntities || "any persons mentioned"}
Regarding the following topics: ${topicEntities || "any topics mentioned"}

For each extraction, provide:
1. Type (TimeExpression, Opinion, Sentiment)
2. Entity (the person, organization, or topic it relates to)
3. Value (the date, time period, opinion content, or sentiment value)
4. Evidence (the text that supports this extraction)

Format your response as a valid JSON object with three arrays: "temporal", "opinions", and "sentiments"

IMPORTANT: Use proper JSON format with double quotes for all property names and string values. Do not use single quotes or unescaped special characters.

Example response format:
{
  "temporal": [
    {
      "entity": "Rate Case Hearing",
      "value": "June 15-20, 2022",
      "evidence": "The rate case hearing took place from June 15-20, 2022."
    }
  ],
  "opinions": [
    {
      "entity": "John Smith",
      "topic": "Renewable Energy Policy",
      "value": "supportive",
      "evidence": "Dr. Smith expressed strong support for the renewable energy policy, stating it would 'benefit consumers in the long term'."
    }
  ],
  "sentiments": [
    {
      "entity": "CenterPoint Energy",
      "topic": "Rate Increase",
      "value": "negative",
      "evidence": "Multiple stakeholders expressed concerns about CenterPoint Energy's proposed rate increase."
    }
  ]
}

Return only the JSON object with no additional text, markdown, or code blocks.`;
    }

    /**
     * Validate entities against the allowed types
     * @private
     * @param {Array} entities - Extracted entities to validate
     * @returns {Array} - Validated entities
     */
    _validateEntities(entities) {
        if (!Array.isArray(entities)) {
            console.warn('Expected entities to be an array but got:', typeof entities);
            return [];
        }
        
        // Validate entity types
        const validTypes = new Set(this.entityTypes);
        const validatedEntities = entities.filter(entity => {
            if (!entity.name || !entity.type) {
                console.warn('Invalid entity missing name or type:', entity);
                return false;
            }
            
            if (!validTypes.has(entity.type)) {
                console.warn(`Invalid entity type "${entity.type}" for entity "${entity.name}"`);
                // Assign a default type rather than skipping
                entity.type = "Concept";
            }
            
            // Ensure aliases is an array
            if (!Array.isArray(entity.aliases)) {
                entity.aliases = [];
            }
            
            return true;
        });
        
        return validatedEntities;
    }

    /**
     * Validate relationships against entities and allowed relationship types
     * @private
     * @param {Array} relationships - Extracted relationships to validate
     * @param {Array} entities - Previously extracted entities
     * @returns {Array} - Validated relationships
     */
    _validateRelationships(relationships, entities) {
        if (!Array.isArray(relationships)) {
            console.warn('Expected relationships to be an array but got:', typeof relationships);
            return [];
        }
        
        // Create entity name map for validation
        const entityMap = new Map();
        for (const entity of entities) {
            entityMap.set(entity.name.toLowerCase(), entity);
            // Also map aliases
            for (const alias of (entity.aliases || [])) {
                entityMap.set(alias.toLowerCase(), entity);
            }
        }

        // Validate relationship types and entities
        const validTypes = new Set(this.relationshipTypes);
        const validatedRelationships = relationships.filter(rel => {
            if (!rel.source || !rel.target || !rel.type) {
                console.warn('Invalid relationship missing source, target, or type:', rel);
                return false;
            }
            
            // Check if relationship type is valid
            if (!validTypes.has(rel.type)) {
                console.warn(`Invalid relationship type "${rel.type}" for relationship "${rel.source}" -> "${rel.target}"`);
                // Default to a generic relationship type
                rel.type = "relatedTo";
            }
            
            // Normalize and validate source and target entities
            const sourceEntity = entityMap.get(rel.source.toLowerCase());
            const targetEntity = entityMap.get(rel.target.toLowerCase());
            
            if (!sourceEntity) {
                console.warn(`Source entity "${rel.source}" not found in extracted entities`);
                return false;
            }
            
            if (!targetEntity) {
                console.warn(`Target entity "${rel.target}" not found in extracted entities`);
                return false;
            }
            
            // Update with canonical entity names
            rel.source = sourceEntity.name;
            rel.target = targetEntity.name;
            rel.source_type = sourceEntity.type;
            rel.target_type = targetEntity.type;
            
            return true;
        });
        
        return validatedRelationships;
    }

    /**
     * Parse entity extraction response
     * @private
     * @param {string} response - API response string
     * @returns {Array} - Parsed entities
     */
    _parseEntityExtractionResponse(response) {
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            const jsonStr = jsonMatch ? jsonMatch[0] : response;
            
            // Clean and parse JSON
            const cleanedJson = this._cleanJsonString(jsonStr);
            const entities = JSON.parse(cleanedJson);
            
            // Validate entity types
            const validTypes = new Set(this.entityTypes);
            const validatedEntities = entities.filter(entity => {
                if (!entity.name || !entity.type) {
                    console.warn('Invalid entity missing name or type:', entity);
                    return false;
                }
                
                if (!validTypes.has(entity.type)) {
                    console.warn(`Invalid entity type "${entity.type}" for entity "${entity.name}"`);
                    // Assign a default type rather than skipping
                    entity.type = "Concept";
                }
                
                // Ensure aliases is an array
                if (!Array.isArray(entity.aliases)) {
                    entity.aliases = [];
                }
                
                return true;
            });
            
            return validatedEntities;
        } catch (error) {
            console.error('Error parsing entity extraction response:', error);
            console.error('Raw response:', response);
            return [];
        }
    }

    /**
     * Parse relationship extraction response
     * @private
     * @param {string} response - API response string
     * @param {Array} entities - Previously extracted entities
     * @returns {Array} - Parsed relationships
     */
    _parseRelationshipExtractionResponse(response, entities) {
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            const jsonStr = jsonMatch ? jsonMatch[0] : response;
            
            // Clean and parse JSON
            const cleanedJson = this._cleanJsonString(jsonStr);
            const relationships = JSON.parse(cleanedJson);
            
            // Create entity name map for validation
            const entityMap = new Map();
            for (const entity of entities) {
                entityMap.set(entity.name.toLowerCase(), entity);
                // Also map aliases
                for (const alias of (entity.aliases || [])) {
                    entityMap.set(alias.toLowerCase(), entity);
                }
            }

            // Validate relationship types and entities
            const validTypes = new Set(this.relationshipTypes);
            const validatedRelationships = relationships.filter(rel => {
                if (!rel.source || !rel.target || !rel.type) {
                    console.warn('Invalid relationship missing source, target, or type:', rel);
                    return false;
                }
                
                // Check if relationship type is valid
                if (!validTypes.has(rel.type)) {
                    console.warn(`Invalid relationship type "${rel.type}" for relationship "${rel.source}" -> "${rel.target}"`);
                    // Default to a generic relationship type
                    rel.type = "relatedTo";
                }
                
                // Normalize and validate source and target entities
                const sourceEntity = entityMap.get(rel.source.toLowerCase());
                const targetEntity = entityMap.get(rel.target.toLowerCase());
                
                if (!sourceEntity) {
                    console.warn(`Source entity "${rel.source}" not found in extracted entities`);
                    return false;
                }
                
                if (!targetEntity) {
                    console.warn(`Target entity "${rel.target}" not found in extracted entities`);
                    return false;
                }
                
                // Update with canonical entity names
                rel.source = sourceEntity.name;
                rel.target = targetEntity.name;
                rel.source_type = sourceEntity.type;
                rel.target_type = targetEntity.type;
                
                return true;
            });
            
            return validatedRelationships;
        } catch (error) {
            console.error('Error parsing relationship extraction response:', error);
            console.error('Raw response:', response);
            return [];
        }
    }

    /**
     * Parse temporal and sentiment response
     * @private
     * @param {string} response - API response string
     * @returns {Object} - Parsed temporal and sentiment information
     */
    _parseTemporalSentimentResponse(response) {
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : response;
            
            // Clean and parse JSON
            const cleanedJson = this._cleanJsonString(jsonStr);
            const result = JSON.parse(cleanedJson);
            
            // Ensure required arrays exist
            if (!result.temporal) result.temporal = [];
            if (!result.opinions) result.opinions = [];
            if (!result.sentiments) result.sentiments = [];
            
            return result;
        } catch (error) {
            console.error('Error parsing temporal and sentiment response:', error);
            console.error('Raw response:', response);
            return {
                temporal: [],
                opinions: [],
                sentiments: []
            };
        }
    }

    /**
     * Clean JSON string for parsing
     * @private
     * @param {string} jsonStr - JSON string to clean
     * @returns {string} - Cleaned JSON string
     */
    _cleanJsonString(jsonStr) {
        try {
            // First attempt to extract JSON if wrapped in markdown code blocks
            let cleanJson = jsonStr;
            
            // Remove markdown code blocks if present
            const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
                cleanJson = codeBlockMatch[1];
            }
            
            // Apply a series of replacements to fix common JSON issues
            cleanJson = cleanJson
                // Handle quotes and apostrophes
                .replace(/['']/g, "'") // Replace curly apostrophes with straight ones
                .replace(/[""]/g, '"') // Replace curly quotes with straight ones
                .replace(/(\w)'(\w)/g, "$1\\'$2") // Escape apostrophes in words (like don't)
                .replace(/'/g, '"') // Replace remaining single quotes with double quotes
                
                // Fix common syntax issues
                .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
                .replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":') // Ensure property names are quoted
                .replace(/:\s*([^"{\[\d\-].*?)([,}])/g, ':"$1"$2') // Quote unquoted string values
                
                // Clean up whitespace
                .replace(/\n/g, ' ') // Remove newlines
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim(); // Remove leading/trailing whitespace
                
            // Attempt to parse as a final validation
            JSON.parse(cleanJson);
            return cleanJson;
        } catch (parseError) {
            console.warn("Initial JSON cleaning failed:", parseError.message);
            
            // More aggressive fallback cleaning
            try {
                let fallbackClean = jsonStr
                    .replace(/```(?:json)?\s*/g, '') // Remove code block markers
                    .replace(/```\s*$/g, '') // Remove trailing code block markers
                    .replace(/['']/g, "'") // Replace curly apostrophes
                    .replace(/[""]/g, '"') // Replace curly quotes
                    .replace(/'/g, '"') // Replace all single quotes with double quotes
                    .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
                    .replace(/([a-zA-Z0-9_]+):/g, '"$1":') // Quote all property names
                    .replace(/:\s*'([^']*)'/g, ':"$1"') // Replace single-quoted values with double-quoted
                    .replace(/\\"/g, '\\\\"') // Escape already escaped quotes
                    .replace(/\n/g, ' ') // Remove newlines
                    .replace(/\s+/g, ' ') // Normalize whitespace
                    .trim();
                
                // Check for unquoted property names and fix them
                fallbackClean = fallbackClean.replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":');
                
                // Check for unquoted string values and fix them
                fallbackClean = fallbackClean.replace(/:([^",\{\[\]\}0-9true|false|null][^,\}\]]*?)([,\}\]])/g, ':"$1"$2');
                
                // Attempt to parse as validation
                JSON.parse(fallbackClean);
                return fallbackClean;
            } catch (fallbackError) {
                console.error("Fallback JSON cleaning also failed:", fallbackError.message);
                // Last attempt - very simple structure for arrays and objects
                try {
                    if (jsonStr.includes('[') && jsonStr.includes(']')) {
                        return '[]'; // Return empty array
                    } else if (jsonStr.includes('{') && jsonStr.includes('}')) {
                        return '{}'; // Return empty object
                    }
                } catch (e) {
                    // Ignore
                }
                return '[]'; // Default to empty array
            }
        }
    }
}

module.exports = new NlpService(); 