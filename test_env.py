import os
from dotenv import load_dotenv

def test_env_variables():
    load_dotenv()
    
    # Print all environment variables
    print("Environment variables:")
    print("NEO4J_URI:", os.getenv('NEO4J_URI'))
    print("NEO4J_USERNAME:", os.getenv('NEO4J_USERNAME'))
    print("NEO4J_PASSWORD:", os.getenv('NEO4J_PASSWORD'))
    
    # Test Neo4j connection
    from neo4j import GraphDatabase
    
    uri = os.getenv('NEO4J_URI')
    username = os.getenv('NEO4J_USERNAME')
    password = os.getenv('NEO4J_PASSWORD')
    
    print("\nTesting Neo4j connection with:")
    print(f"URI: {uri}")
    print(f"Username: {username}")
    print(f"Password: {'*' * len(password) if password else None}")
    
    try:
        driver = GraphDatabase.driver(uri, auth=(username, password))
        with driver.session() as session:
            result = session.run("RETURN 1")
            print("\nNeo4j connection successful!")
        driver.close()
    except Exception as e:
        print("\nError connecting to Neo4j:", str(e))

if __name__ == "__main__":
    test_env_variables() 