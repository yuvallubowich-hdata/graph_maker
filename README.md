# Graph Maker Web

A web application for creating knowledge graphs from PDF documents using AI (Google Gemini and OpenAI) and Neo4j.

## Features

- Upload individual PDF files or entire folders through a web interface
- Extract entities and relationships using Google Gemini (with OpenAI fallback)
- Store the knowledge graph in Neo4j database
- Real-time progress tracking with detailed status updates
- Ability to cancel ongoing uploads
- Drag and drop file upload support
- Robust error handling and recovery
- Batch processing of large datasets
- Transaction-based Neo4j operations for data integrity

## Prerequisites

- Node.js (v14 or higher)
- Neo4j database
- Google Gemini API key
- OpenAI API key (as fallback)

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd graph-maker-web
```

2. Install dependencies:
```bash
npm install
```

3. Create an `uploads` directory:
```bash
mkdir uploads
```

4. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Update the following variables in `.env`:
     - `GEMINI_API_KEY`: Your Google Gemini API key
     - `OPENAI_API_KEY`: Your OpenAI API key (fallback)
     - `NEO4J_URI`: Your Neo4j database URI
     - `NEO4J_USERNAME`: Neo4j database username
     - `NEO4J_PASSWORD`: Neo4j database password

## Running the Application

1. Start the development server:
```bash
npm start
```

2. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Open the web application in your browser
2. Choose between file or folder upload:
   - Drag and drop PDF files/folders into the upload area or click to select
   - For folder uploads, all PDF files in the folder (and subfolders) will be processed
3. Monitor progress with real-time updates showing:
   - Number of files found and processed
   - Current file being processed
   - Percentage complete
4. Cancel uploads at any time using the "Stop Upload" button
5. The extracted knowledge graph will be stored in your Neo4j database

## Project Structure

```
graph-maker-web/
├── public/              # Static files
│   └── index.html      # Main HTML file with UI logic
├── src/                # Source code
│   ├── index.js        # Main server file
│   ├── routes/         # API routes
│   │   ├── pdfRoutes.js # PDF processing endpoints
│   │   └── graphRoutes.js # Graph data endpoints
│   └── services/       # Service modules
│       ├── pdfService.js  # PDF extraction
│       ├── geminiService.js # Google Gemini AI integration
│       ├── openaiService.js # OpenAI fallback
│       ├── neo4jService.js # Database operations
│       └── fileTrackingService.js # File processing tracking
├── uploads/            # Temporary file storage
├── .env               # Environment variables
└── package.json       # Project dependencies
```

## Error Handling

The application includes robust error handling:
- Graceful recovery from AI service failures with automatic fallback
- Transaction-based Neo4j operations to prevent data corruption
- Client-side error recovery with automatic retry mechanisms
- Detailed error logging and user-friendly error messages

## Performance Optimization

- Batch processing of entities and relationships
- Transaction-based database operations
- Memory-efficient file processing
- Detailed performance metrics for each processing stage

## License

This project is licensed under the MIT License - see the LICENSE file for details.
