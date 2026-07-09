const path = require('path');
const express = require('express');
const colors = require('colors');
const dotenv = require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { errorHandler } = require('./middleware/errorMiddleware');
const connectDB = require('./config/db');
const port = process.env.PORT || 5000;

connectDB();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api/goals', require('./routes/goalRoutes'));
app.use('/api/users', require('./routes/userRoutes'));

// Serve frontend
if (process.env.NODE_ENV === 'production') {
  app.get('/', (req, res) => {
    res.send('API is running...')
  })
}

app.use(errorHandler);

app.listen(port, () => console.log(`Server started on port ${port}`));
