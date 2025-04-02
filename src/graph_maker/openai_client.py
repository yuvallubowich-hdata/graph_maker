import os
from typing import Dict, Any, List
import openai
from dotenv import load_dotenv

class OpenAIClient:
    def __init__(self):
        load_dotenv()
        openai.api_key = os.getenv('OPENAI_API_KEY')
        
    def extract_entities_and_relationships(self, text: str, ontology: Dict[str, Any]) -> Dict[str, Any]:
        """Extract entities and relationships from text using OpenAI API."""
        prompt = self._create_prompt(text, ontology)
        
        try:
            response = openai.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that extracts entities and relationships from text."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.0
            )
            
            result = response.choices[0].message.content
            return self._parse_response(result)
            
        except Exception as e:
            print(f"Error calling OpenAI API: {str(e)}")
            return {"nodes": [], "relationships": []}
            
    def _create_prompt(self, text: str, ontology: Dict[str, Any]) -> str:
        """Create a prompt for the OpenAI API."""
        labels = ontology['labels']
        relationship_descriptor = ontology['relationship_descriptor']
        
        prompt = f"""Given the following text, extract entities and their relationships.
        
Text: {text}

Entity types: {', '.join(labels)}
Relationship descriptor: {relationship_descriptor}

Format the output as a JSON object with two lists:
1. "nodes": List of objects with "id" (string), "label" (one of the entity types), and "name" (string)
2. "relationships": List of objects with "source" (node id), "target" (node id), and "type" (string describing the relationship)

Example format:
{{
    "nodes": [
        {{"id": "1", "label": "Person", "name": "John"}},
        {{"id": "2", "label": "Place", "name": "New York"}}
    ],
    "relationships": [
        {{"source": "1", "target": "2", "type": "lives in"}}
    ]
}}

Extract only the most relevant and important entities and relationships. Ensure all relationships use the relationship descriptor as context."""
        
        return prompt
        
    def _parse_response(self, response: str) -> Dict[str, List[Dict[str, str]]]:
        """Parse the response from OpenAI API into a structured format."""
        try:
            import json
            result = json.loads(response)
            return {
                "nodes": result.get("nodes", []),
                "relationships": result.get("relationships", [])
            }
        except Exception as e:
            print(f"Error parsing OpenAI response: {str(e)}")
            return {"nodes": [], "relationships": []} 