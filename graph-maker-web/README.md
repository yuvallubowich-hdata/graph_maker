# Graph Maker - Document Knowledge Graph Builder

A robust application for extracting knowledge graphs from PDF documents using natural language processing and graph database technology.

## Features

- **PDF Processing**: Upload individual files or entire folders with recursive processing
- **AI Analysis**: Extract entities and relationships using Google Gemini (with OpenAI fallback)
- **Real-time Progress**: Detailed progress tracking with file counts and status updates
- **Upload Control**: Cancel ongoing uploads with graceful cleanup of resources
- **Entity Resolution**: Deduplicate entities across documents with fuzzy matching
- **Knowledge Graph**: Store and query entities and relationships in Neo4j with robust transaction handling
- **Performance Optimization**: Batch processing and transaction management for Neo4j operations
- **Visualization**: Interactive graph visualization with D3.js

## Architecture

The application follows a modular architecture:

1. **Data Ingestion**:
   - PDF/Folder Upload & Extraction
   - Text Chunking & Pre-processing
   - Real-time Progress Tracking

2. **AI Processing**:
   - Google Gemini Integration (Primary)
   - OpenAI Fallback
   - Named Entity Recognition (NER)
   - Relationship Extraction
   - Temporal & Sentiment Analysis

3. **Entity Resolution**:
   - Canonicalization
   - Fuzzy Matching
   - Alias Management

4. **Storage & Querying**:
   - Neo4j Graph Database with Transaction Management
   - Batch Processing
   - Verification for Entity Visibility
   - CRUD Operations
   - Advanced Querying

5. **Visualization**:
   - D3.js Force-Directed Graph
   - Entity Detail View
   - Graph Statistics

## Setup

### Prerequisites

- Node.js (v14+)
- Neo4j Database
- Google Gemini API Key
- OpenAI API Key (fallback)

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   cd graph-maker-web
   npm install
   ```
3. Create a `.env` file with the following variables:
   ```
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key
   OPENAI_API_KEY=your_openai_api_key
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your_password
   ```
4. Start the server:
   ```
   npm start
   ```
5. Access the application at `http://localhost:3000`

## Usage

1. **Initialize the System**:
   - Click "Initialize System" to set up the Neo4j database with indices and constraints.

2. **Upload Documents**:
   - Choose between file or folder upload options
   - Drag and drop PDF files/folders or use the file browser
   - Configure chunking options if needed
   - Click "Upload & Process" to start the extraction
   - Monitor real-time progress with file counts and status updates
   - Cancel the upload at any time with the "Stop Upload" button

3. **Explore the Graph**:
   - Browse entities by type in the Entity Explorer
   - Search for specific entities
   - Click on an entity to view its details and relationships
   - Visualize the entity network in the Knowledge Graph panel

## API Documentation

### PDF Endpoints

- `GET /api/pdf/initialize`: Initialize the system
- `POST /api/pdf/upload`: Upload and process a PDF document
- `POST /api/pdf/upload-folder`: Upload and process all PDFs in a folder
- `POST /api/pdf/cancel/:clientId`: Cancel an ongoing upload process
- `GET /api/pdf/status/:clientId`: Get the status of an ongoing upload process
- `POST /api/pdf/reset`: Reset the entity resolution service

### Graph Endpoints

- `GET /api/graph/stats`: Get graph statistics
- `GET /api/graph/entity-types`: Get all entity types with counts
- `GET /api/graph/relationship-types`: Get all relationship types with counts
- `GET /api/graph/entities/:type`: Get entities by type
- `GET /api/graph/search`: Search for entities
- `GET /api/graph/entity/:id`: Get entity details with relationships
- `GET /api/graph/visualization`: Get a subgraph for visualization

## Component Overview

### PDF Service

Handles the extraction of text from PDF files and splits it into semantic chunks with appropriate metadata. Supports both individual files and folder-based batch processing.

### AI Service

Processes text chunks to extract entities, relationships, and temporal/sentiment information. Primary integration with Google Gemini API, with OpenAI fallback for robustness.

### Entity Resolution Service

Manages entity deduplication and canonicalization, using fuzzy matching and intelligent name normalization to identify when different surface forms refer to the same entity.

### Neo4j Service

Handles all interactions with the Neo4j graph database, including batch processing with explicit transaction management, verification of entity visibility, and efficient relationship creation.

### File Tracking Service

Monitors the progress of file processing, providing real-time updates on files found, files processed, and current processing status.

## Error Handling

The application includes comprehensive error handling:
- Graceful recovery from AI service failures
- Transaction-based Neo4j operations with rollback on failure
- Client-side polling with error recovery
- Detailed logging of processing stages and errors

## License

MIT 