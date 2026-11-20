const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const customersRouter = require('./routes/customers');
const tipsRouter = require('./routes/tips');
const paymentsRouter = require('./routes/payments');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
//app.use(express.json());

// Webhook FIRST — needs raw body, and takes its own express.raw()
app.use('/api/payments', paymentsRouter);

// Then the JSON parser for everything else
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/customers', customersRouter);

// ...after customers route
app.use('/api/tips', tipsRouter);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

module.exports = app;
