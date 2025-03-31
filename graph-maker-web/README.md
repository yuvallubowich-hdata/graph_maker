# Graph Maker - Document Knowledge Graph Builder

A robust application for extracting knowledge graphs from PDF documents using natural language processing and graph database technology.

## Features

- **PDF Processing**: Upload and extract text from PDF documents with advanced chunking
- **NLP Analysis**: Extract entities, relationships, temporal information, and sentiment
- **Entity Resolution**: Deduplicate entities across documents with fuzzy matching
- **Knowledge Graph**: Store and query entities and relationships in Neo4j
- **Visualization**: Interactive graph visualization with D3.js

## Architecture

The application follows a modular architecture:

1. **Data Ingestion**:
   - PDF Upload & Extraction
   - Text Chunking & Pre-processing

2. **NLP Processing**:
   - Named Entity Recognition (NER)
   - Relationship Extraction
   - Temporal & Sentiment Analysis

3. **Entity Resolution**:
   - Canonicalization
   - Fuzzy Matching
   - Alias Management

4. **Storage & Querying**:
   - Neo4j Graph Database
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
- OpenAI API Key

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
   - Drag and drop PDF files or use the file browser.
   - Configure chunking options if needed.
   - Click "Upload & Process" to start the extraction.

3. **Explore the Graph**:
   - Browse entities by type in the Entity Explorer.
   - Search for specific entities.
   - Click on an entity to view its details and relationships.
   - Visualize the entity network in the Knowledge Graph panel.

## API Documentation

### PDF Endpoints

- `GET /api/pdf/initialize`: Initialize the system
- `POST /api/pdf/upload`: Upload and process a PDF document
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

Handles the extraction of text from PDF files and splits it into semantic chunks with appropriate metadata. Uses the `pdf-parse` library.

### NLP Service

Processes text chunks to extract entities, relationships, and temporal/sentiment information. Integrates with OpenAI's API for advanced natural language understanding.

### Entity Resolution Service

Manages entity deduplication and canonicalization, using fuzzy matching and intelligent name normalization to identify when different surface forms refer to the same entity.

### Neo4j Service

Handles all interactions with the Neo4j graph database, including creating and querying nodes and relationships, managing constraints and indices, and performing graph operations.

### Graph Processor Service

Orchestrates the entire process, coordinating between the various services to ensure that documents are processed correctly and the resulting knowledge graph is accurate and useful.

## License

MIT 