import os
from dotenv import load_dotenv
from neo4j import GraphDatabase

def test_neo4j_connection():
    # Load environment variables
    load_dotenv()
    
    # Get Neo4j credentials
    uri = os.getenv('NEO4J_URI')
    username = os.getenv('NEO4J_USERNAME')
    password = os.getenv('NEO4J_PASSWORD')
    
    print("Environment variables:")
    print(f"NEO4J_URI: {uri}")
    print(f"NEO4J_USERNAME: {username}")
    print(f"NEO4J_PASSWORD: {'*' * len(password) if password else None}")
    
    if not uri or not username or not password:
        print("Error: Missing environment variables")
        return
    
    try:
        # Create driver
        driver = GraphDatabase.driver(uri, auth=(username, password))
        
        # Test connection
        with driver.session() as session:
            result = session.run("RETURN 1")
            print("\nNeo4j connection successful!")
            
        driver.close()
    except Exception as e:
        print(f"\nError connecting to Neo4j: {str(e)}")

if __name__ == "__main__":
    test_neo4j_connection() 