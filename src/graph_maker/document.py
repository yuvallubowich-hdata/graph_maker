from typing import List, Optional
import uuid

class Document:
    def __init__(self, text: str, chunk_size: int = 1000, doc_id: Optional[str] = None):
        self.text = text
        self.chunk_size = chunk_size
        self.doc_id = doc_id or str(uuid.uuid4())
        self._chunks = None
        
    @property
    def chunks(self) -> List[str]:
        if self._chunks is None:
            self._chunks = self._create_chunks()
        return self._chunks
        
    def _create_chunks(self) -> List[str]:
        """Split text into chunks of approximately chunk_size characters."""
        if not self.text:
            return []
            
        chunks = []
        current_chunk = []
        current_size = 0
        
        for word in self.text.split():
            word_size = len(word) + 1  # +1 for space
            if current_size + word_size > self.chunk_size and current_chunk:
                chunks.append(' '.join(current_chunk))
                current_chunk = [word]
                current_size = word_size
            else:
                current_chunk.append(word)
                current_size += word_size
                
        if current_chunk:
            chunks.append(' '.join(current_chunk))
            
        return chunks 