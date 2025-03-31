/**
 * Entity Resolution Service
 * 
 * Responsible for:
 * - Deduplicating entities across documents
 * - Normalizing entity names and properties
 * - Maintaining canonical entities and aliases
 * - Scoring entity matches for confidence
 */
class EntityResolutionService {
    constructor() {
        this.canonicalEntities = new Map(); // Map of ID to canonical entity
        this.entityIndex = new Map(); // Map of normalized name to canonical entity ID
        this.aliasMap = new Map(); // Map of alias to canonical entity ID
        this.nextEntityId = 1; // Counter for generating unique entity IDs
    }

    /**
     * Reset the entity resolution service
     */
    reset() {
        this.canonicalEntities.clear();
        this.entityIndex.clear();
        this.aliasMap.clear();
        this.nextEntityId = 1;
    }

    /**
     * Add an entity to the resolution service
     * @param {Object} entity - The entity to add
     * @returns {Object} - The canonical entity (either found or created)
     */
    addEntity(entity) {
        // Normalize the entity name
        const normalizedName = this._normalizeString(entity.name);
        
        // Check if this entity already exists
        const existingId = this.entityIndex.get(normalizedName) || this._findBestMatch(normalizedName, entity.type);
        
        if (existingId) {
            // Entity exists, update it
            const existingEntity = this.canonicalEntities.get(existingId);
            
            // Merge aliases
            const updatedAliases = new Set([
                ...(existingEntity.aliases || []),
                ...(entity.aliases || [])
            ]);
            
            // Update the canonical entity
            const updatedEntity = {
                ...existingEntity,
                description: entity.description || existingEntity.description,
                aliases: Array.from(updatedAliases),
                confidence: Math.max(existingEntity.confidence || 0.7, entity.confidence || 0.7),
                sources: [...(existingEntity.sources || []), ...(entity.sources || [])]
            };
            
            this.canonicalEntities.set(existingId, updatedEntity);
            
            // Register any new aliases
            for (const alias of entity.aliases || []) {
                const normalizedAlias = this._normalizeString(alias);
                if (!this.aliasMap.has(normalizedAlias)) {
                    this.aliasMap.set(normalizedAlias, existingId);
                }
            }
            
            return updatedEntity;
        } else {
            // Create a new canonical entity
            const entityId = `entity_${this.nextEntityId++}`;
            
            const canonicalEntity = {
                id: entityId,
                name: entity.name,
                type: entity.type,
                description: entity.description || '',
                aliases: entity.aliases || [],
                confidence: entity.confidence || 0.9, // Higher confidence for new entities
                sources: entity.sources || [],
                properties: entity.properties || {}
            };
            
            // Add to canonical entities
            this.canonicalEntities.set(entityId, canonicalEntity);
            
            // Index by normalized name
            this.entityIndex.set(normalizedName, entityId);
            
            // Register aliases
            for (const alias of entity.aliases || []) {
                const normalizedAlias = this._normalizeString(alias);
                this.aliasMap.set(normalizedAlias, entityId);
            }
            
            return canonicalEntity;
        }
    }

    /**
     * Get a canonical entity by ID
     * @param {string} entityId - The entity ID
     * @returns {Object|null} - The canonical entity or null if not found
     */
    getEntityById(entityId) {
        return this.canonicalEntities.get(entityId) || null;
    }

    /**
     * Find an entity by name
     * @param {string} name - Entity name to search for
     * @param {string} [type] - Optional entity type
     * @param {boolean} [createIfNotFound=false] - Create a new entity if not found
     * @returns {object|null} - Entity object or null if not found
     */
    findEntityByName(name, type = null, createIfNotFound = false) {
        if (!name) return null;
        
        // Normalize the input name
        const normalizedName = this._normalizeString(name);
        
        // First, try to find it in the entity index
        let entityId = this.entityIndex.get(normalizedName);
        
        // If not found in index, try alias lookup
        if (!entityId) {
            entityId = this.aliasMap.get(normalizedName);
        }
        
        // If still not found, try best match
        if (!entityId) {
            entityId = this._findBestMatch(normalizedName, type);
        }
        
        // If we found a match, return the entity
        if (entityId) {
            const entity = this.canonicalEntities.get(entityId);
            
            // If type is specified and doesn't match, consider it not found
            if (type && entity && entity.type !== type) {
                if (createIfNotFound) {
                    return this.addEntity({ name, type });
                }
                return null;
            }
            
            // If we found a match, add the search name as an alias if it's different
            if (entity && normalizedName !== this._normalizeString(entity.name)) {
                // Add the original name as an alias
                this._addAliasToEntity(entity, name);
            }
            
            return entity;
        }
        
        // If entity not found and createIfNotFound is true, create a new one
        if (createIfNotFound) {
            return this.addEntity({ name, type });
        }
        
        return null;
    }

    /**
     * Add an alias to an entity
     * @private
     * @param {object} entity - Entity object
     * @param {string} alias - Alias to add
     */
    _addAliasToEntity(entity, alias) {
        if (!alias || !entity) return;
        
        // Skip if the alias is the same as the entity name
        if (alias === entity.name) return;
        
        // Normalize the alias
        const normalizedAlias = this._normalizeString(alias);
        
        // Skip if the normalized alias is the same as the normalized entity name
        if (normalizedAlias === this._normalizeString(entity.name)) return;
        
        // Skip if the alias is already in the entity's aliases
        if (entity.aliases && entity.aliases.includes(alias)) return;
        
        // Initialize aliases array if it doesn't exist
        if (!entity.aliases) {
            entity.aliases = [];
        }
        
        // Add the alias
        entity.aliases.push(alias);
        
        // Add mapping from normalized alias to entity ID
        this.aliasMap.set(normalizedAlias, entity.id);
        
        // Update the entity in the canonical entities map
        this.canonicalEntities.set(entity.id, entity);
    }

    /**
     * Deduplicate a list of entities
     * @param {Array} entities - List of entities to deduplicate
     * @returns {Array} - Deduplicated list of canonical entities
     */
    deduplicateEntities(entities) {
        // Map of entity ID to canonical entity
        const dedupedEntities = new Map();
        
        for (const entity of entities) {
            const canonicalEntity = this.addEntity(entity);
            dedupedEntities.set(canonicalEntity.id, canonicalEntity);
        }
        
        return Array.from(dedupedEntities.values());
    }

    /**
     * Get all canonical entities
     * @returns {Array} - Array of all canonical entities
     */
    getAllEntities() {
        return Array.from(this.canonicalEntities.values());
    }

    /**
     * Normalize a string for comparison
     * @private
     * @param {string} str - The string to normalize
     * @returns {string} - The normalized string
     */
    _normalizeString(str) {
        if (!str) return '';
        
        // Convert to lowercase and trim
        let normalized = str.toLowerCase().trim();
        
        // Replace multiple spaces with a single space
        normalized = normalized.replace(/\s+/g, ' ');
        
        // Remove common punctuation and special characters
        normalized = normalized.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ');
        
        // Remove common business entity suffixes
        const suffixes = [
            'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'company', 
            'co', 'group', 'holdings', 'services', 'systems', 'technologies', 
            'solutions', 'international', 'usa', 'association', 'foundation',
            'l.l.c.', 'l.p.', 'lp', 'plc'
        ];
        
        suffixes.forEach(suffix => {
            // Remove suffix if it appears at the end of the string
            const suffixPattern = new RegExp(`\\s${suffix}\\b$`, 'i');
            normalized = normalized.replace(suffixPattern, '');
        });
        
        // Normalize common abbreviations
        const abbreviations = {
            'dept': 'department',
            'univ': 'university',
            'assn': 'association',
            'assoc': 'association',
            'natl': 'national',
            'intl': 'international',
            'dev': 'development',
            'govt': 'government',
            'tech': 'technology',
            'mgmt': 'management'
        };
        
        for (const [abbr, full] of Object.entries(abbreviations)) {
            const abbrPattern = new RegExp(`\\b${abbr}\\b`, 'ig');
            normalized = normalized.replace(abbrPattern, full);
        }
        
        // Remove common words that don't contribute to entity identity
        const commonWords = ['the', 'of', 'and', 'a', 'an', 'in', 'on', 'at', 'by', 'for', 'with'];
        const normalizedWords = normalized.split(' ').filter(word => !commonWords.includes(word));
        normalized = normalizedWords.join(' ');
        
        // Trim again after all replacements
        return normalized.trim();
    }

    /**
     * Calculate string similarity using Levenshtein distance
     * @private
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} - Similarity score between 0 and 1
     */
    _calculateStringSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        
        // If strings are identical, return 1
        if (str1 === str2) return 1;
        
        // For very different length strings, similarity is likely low
        const lengthDiff = Math.abs(str1.length - str2.length);
        const maxLength = Math.max(str1.length, str2.length);
        if (lengthDiff / maxLength > 0.5) return 0;
        
        // Calculate Levenshtein distance
        const m = str1.length;
        const n = str2.length;
        
        // Create distance matrix
        const d = Array(m + 1).fill().map(() => Array(n + 1).fill(0));
        
        // Initialize first row and column
        for (let i = 0; i <= m; i++) d[i][0] = i;
        for (let j = 0; j <= n; j++) d[0][j] = j;
        
        // Fill distance matrix
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = str1[i-1] === str2[j-1] ? 0 : 1;
                d[i][j] = Math.min(
                    d[i-1][j] + 1,          // deletion
                    d[i][j-1] + 1,          // insertion
                    d[i-1][j-1] + cost      // substitution
                );
            }
        }
        
        // Convert distance to similarity score (0 to 1)
        return 1 - (d[m][n] / Math.max(m, n));
    }

    /**
     * Find the best matching entity for a name
     * @private
     * @param {string} normalizedName - The normalized entity name to match
     * @param {string} [type] - Optional entity type for more precise matching
     * @returns {string|null} - The ID of the best matching entity, or null if no match found
     */
    _findBestMatch(normalizedName, type = null) {
        // First check for substring and acronym matches
        const substringMatches = this._findSubstringMatches(normalizedName);
        
        // If we found exact substring matches, use the first match or filter by type
        if (substringMatches.length > 0) {
            // If specific type provided, try to find a match of that type
            if (type) {
                const typeMatches = substringMatches.filter(id => {
                    const entity = this.canonicalEntities.get(id);
                    return entity && entity.type === type;
                });
                
                if (typeMatches.length > 0) {
                    return typeMatches[0];
                }
            }
            
            return substringMatches[0];
        }
        
        // Otherwise, try fuzzy matching
        let bestScore = 0.8; // Threshold for considering a match
        let bestMatchId = null;
        
        for (const [candidateId, entity] of this.canonicalEntities.entries()) {
            // Skip if types don't match and type is specified
            if (type && entity.type !== type) {
                continue;
            }
            
            const candidateName = this._normalizeString(entity.name);
            const similarity = this._calculateStringSimilarity(normalizedName, candidateName);
            
            if (similarity > bestScore) {
                bestScore = similarity;
                bestMatchId = candidateId;
            }
            
            // Also check aliases
            for (const alias of entity.aliases || []) {
                const normalizedAlias = this._normalizeString(alias);
                const aliasSimilarity = this._calculateStringSimilarity(normalizedName, normalizedAlias);
                
                if (aliasSimilarity > bestScore) {
                    bestScore = aliasSimilarity;
                    bestMatchId = candidateId;
                }
            }
        }
        
        return bestMatchId;
    }

    /**
     * Find substring matches for a name
     * @private
     * @param {string} normalizedName - The normalized entity name to match
     * @returns {Array} - Array of entity IDs that match
     */
    _findSubstringMatches(normalizedName) {
        const matches = [];
        const searchTerms = [normalizedName];
        
        // If name has more than one word, also consider acronyms
        const words = normalizedName.split(' ');
        if (words.length > 1) {
            const acronym = words.map(word => word[0]).join('');
            if (acronym.length > 1) {
                searchTerms.push(acronym);
            }
        }
        
        // Check all indexed names
        for (const [indexedName, entityId] of this.entityIndex.entries()) {
            // Check if this entity name contains or is contained by the search name
            const isSubstring = searchTerms.some(term => 
                indexedName.includes(term) || term.includes(indexedName)
            );
            
            if (isSubstring) {
                matches.push(entityId);
            }
        }
        
        // Check all aliases as well
        for (const [alias, entityId] of this.aliasMap.entries()) {
            // Check if this alias contains or is contained by the search name
            const isSubstring = searchTerms.some(term => 
                alias.includes(term) || term.includes(alias)
            );
            
            if (isSubstring && !matches.includes(entityId)) {
                matches.push(entityId);
            }
        }
        
        return matches;
    }
}

module.exports = new EntityResolutionService(); 