require('dotenv').config();
const neo4jService = require('./services/neo4jService');

async function testRelationshipCreation() {
  try {
    console.log('Testing Neo4j relationship creation...');
    
    // First, create test entities
    const entityA = {
      id: 'test_entity_a',
      name: 'Test Entity A',
      type: 'Organization',
      description: 'Test entity for relationship testing'
    };
    
    const entityB = {
      id: 'test_entity_b',
      name: 'Test Entity B',
      type: 'Project',
      description: 'Another test entity'
    };
    
    console.log('Creating test entities...');
    await neo4jService.saveEntities([entityA, entityB]);
    
    // Create a test relationship
    const testRelationship = {
      source: 'test_entity_a',
      target: 'test_entity_b',
      type: 'WORKS_ON',
      evidence: 'Test evidence for relationship',
      confidence: 0.9
    };
    
    console.log('Creating test relationship...');
    const result = await neo4jService.saveRelationships([testRelationship]);
    
    console.log('Result:', result);
    console.log('Test completed successfully!');
    
    // Verify with a query
    console.log('Verifying relationship was created...');
    const verification = await neo4jService.query(`
      MATCH (a:Entity {id: 'test_entity_a'})-[r:WORKS_ON]->(b:Entity {id: 'test_entity_b'})
      RETURN a.name as source, b.name as target, r.evidence as evidence
    `);
    
    if (verification.length > 0) {
      console.log('Verification successful! Found relationship:', 
        verification[0].get('source'), 
        '->',
        verification[0].get('target'),
        'with evidence:',
        verification[0].get('evidence')
      );
    } else {
      console.log('Verification failed! No relationship found.');
    }
    
  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    await neo4jService.close();
  }
}

testRelationshipCreation(); 