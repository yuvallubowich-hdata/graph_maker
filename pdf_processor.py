import PyPDF2
import io
from typing import List

def extract_text_from_pdf(pdf_file: bytes) -> List[str]:
    """
    Extract text from a PDF file and split it into chunks.
    
    Args:
        pdf_file (bytes): The PDF file content as bytes
        
    Returns:
        List[str]: List of text chunks from the PDF
    """
    # Create a PDF reader object
    pdf_reader = PyPDF2.PdfReader(io.BytesIO(pdf_file))
    
    # Extract text from each page
    text_chunks = []
    for page in pdf_reader.pages:
        text = page.extract_text()
        # Split text into chunks (you can adjust the chunk size)
        chunks = [text[i:i+1000] for i in range(0, len(text), 1000)]
        text_chunks.extend(chunks)
    
    return text_chunks

def process_pdf_files(pdf_files: List[bytes]) -> List[str]:
    """
    Process multiple PDF files and combine their text chunks.
    
    Args:
        pdf_files (List[bytes]): List of PDF file contents as bytes
        
    Returns:
        List[str]: Combined list of text chunks from all PDFs
    """
    all_chunks = []
    for pdf_file in pdf_files:
        chunks = extract_text_from_pdf(pdf_file)
        all_chunks.extend(chunks)
    return all_chunks 