require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pdfRoutes = require('./routes/pdfRoutes');
const graphRoutes = require('./routes/graphRoutes');
const queryRoutes = require('./routes/queryRoutes');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory');
}

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Configure middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded files for development purposes
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API routes
app.use('/api/pdf', pdfRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/query', queryRoutes);

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Route for the query interface
app.get('/query', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/query.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    if (err.name === 'MulterError') {
        return res.status(400).json({ error: `File upload error: ${err.message}` });
    }
    
    res.status(500).json({ error: 'An unexpected error occurred' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API available at http://localhost:${PORT}/api`);
}); 