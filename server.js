// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // Allows your server to parse JSON bodies

// Basic Health Check Route
app.get('/api/status', (req, res) => {
    res.json({ message: 'ClassDex Backend is running successfully!' });
});

// Start the Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
