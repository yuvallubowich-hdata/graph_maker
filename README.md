# Graph Maker Web

A web application for creating knowledge graphs from PDF documents using OpenAI and Neo4j.

## Features

- Upload PDF files through a web interface
- Extract entities and relationships using OpenAI's GPT-3.5
- Store the knowledge graph in Neo4j
- Drag and drop file upload support
- Real-time processing status updates

## Prerequisites

- Node.js (v14 or higher)
- Neo4j database
- OpenAI API key

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
     - `OPENAI_API_KEY`: Your OpenAI API key
     - `NEO4J_URI`: Your Neo4j database URI
     - `NEO4J_USERNAME`: Neo4j database username
     - `NEO4J_PASSWORD`: Neo4j database password

## Running the Application

1. Start the development server:
```bash
npm run dev
```

2. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Open the web application in your browser
2. Drag and drop PDF files into the upload area or click to select files
3. Wait for the processing to complete
4. View the status of each uploaded file
5. The extracted knowledge graph will be stored in your Neo4j database

## Project Structure

```
graph-maker-web/
├── public/              # Static files
│   └── index.html      # Main HTML file
├── src/                # Source code
│   ├── index.js        # Main server file
│   └── services/       # Service modules
│       ├── pdfService.js
│       ├── openaiService.js
│       └── neo4jService.js
├── uploads/            # Temporary file storage
├── .env               # Environment variables
└── package.json       # Project dependencies
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
