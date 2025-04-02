from typing import List, Dict, Any

class Ontology:
    def __init__(self, labels: List[str], relationship_descriptor: str):
        self.labels = labels
        self.relationship_descriptor = relationship_descriptor
        
    def to_dict(self) -> Dict[str, Any]:
        return {
            'labels': self.labels,
            'relationship_descriptor': self.relationship_descriptor
        }
        
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Ontology':
        return cls(
            labels=data['labels'],
            relationship_descriptor=data['relationship_descriptor']
        ) 