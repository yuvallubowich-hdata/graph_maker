from typing import List, Dict, Any, Optional
import networkx as nx
from pyvis.network import Network
from .document import Document
from .ontology import Ontology
from .openai_client import OpenAIClient

class GraphMaker:
    def __init__(self, ontology: Ontology):
        self.ontology = ontology
        self.openai_client = OpenAIClient()
        self.graph = nx.DiGraph()
        
    def process_document(self, document: Document) -> None:
        """Process a document and add its entities and relationships to the graph."""
        for chunk in document.chunks:
            result = self.openai_client.extract_entities_and_relationships(
                chunk,
                self.ontology.to_dict()
            )
            
            self._add_to_graph(result)
            
    def _add_to_graph(self, data: Dict[str, List[Dict[str, str]]]) -> None:
        """Add nodes and relationships to the graph."""
        # Add nodes
        for node in data['nodes']:
            self.graph.add_node(
                node['id'],
                label=node['label'],
                name=node['name']
            )
            
        # Add relationships
        for rel in data['relationships']:
            self.graph.add_edge(
                rel['source'],
                rel['target'],
                type=rel['type']
            )
            
    def visualize(self, output_file: str = 'graph.html', height: str = '750px') -> None:
        """Create an interactive visualization of the graph."""
        net = Network(height=height, directed=True)
        
        # Add nodes with colors based on labels
        colors = self._generate_colors()
        for node_id in self.graph.nodes():
            node_data = self.graph.nodes[node_id]
            net.add_node(
                node_id,
                label=node_data['name'],
                title=f"{node_data['label']}: {node_data['name']}",
                color=colors.get(node_data['label'], '#000000')
            )
            
        # Add edges
        for edge in self.graph.edges(data=True):
            source, target, data = edge
            net.add_edge(source, target, title=data['type'])
            
        # Save the visualization
        net.write_html(output_file)
        
    def _generate_colors(self) -> Dict[str, str]:
        """Generate a color mapping for node labels."""
        import seaborn as sns
        
        palette = sns.color_palette("husl", len(self.ontology.labels))
        colors = {}
        for label, color in zip(self.ontology.labels, palette):
            # Convert RGB values to hex color code
            hex_color = "#{:02x}{:02x}{:02x}".format(
                int(color[0] * 255),
                int(color[1] * 255),
                int(color[2] * 255)
            )
            colors[label] = hex_color
            
        return colors
        
    def save_to_neo4j(self, neo4j_url: str, username: str, password: str) -> None:
        """Save the graph to Neo4j database."""
        from neo4j import GraphDatabase
        
        driver = GraphDatabase.driver(neo4j_url, auth=(username, password))
        
        with driver.session() as session:
            # Clear existing data
            session.run("MATCH (n) DETACH DELETE n")
            
            # Create nodes
            for node_id in self.graph.nodes():
                node_data = self.graph.nodes[node_id]
                session.run(
                    f"CREATE (n:{node_data['label']} {{id: $id, name: $name}})",
                    id=node_id,
                    name=node_data['name']
                )
                
            # Create relationships
            for source, target, data in self.graph.edges(data=True):
                source_data = self.graph.nodes[source]
                target_data = self.graph.nodes[target]
                # Convert relationship type to Neo4j compatible format
                relationship_type = data['type'].upper().replace(' ', '_').replace('-', '_')
                
                session.run(
                    f"""
                    MATCH (s:{source_data['label']} {{id: $source_id}})
                    MATCH (t:{target_data['label']} {{id: $target_id}})
                    CREATE (s)-[r:{relationship_type}]->(t)
                    """,
                    source_id=source,
                    target_id=target
                )
                
        driver.close() 