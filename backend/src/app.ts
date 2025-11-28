import express from 'express';
import cors from 'cors';
import { analyzeRouter } from './routes/analyzeRoutes';
import { loggingMiddleware } from './middlewares/loggingMiddleware';

const app = express();

// Core Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Custom Middlewares
app.use(loggingMiddleware);

// API Routes
app.get('/', (req, res) => {
  res.send('Platypus Backend is running!');
});
app.use('/api/v1/analyze', analyzeRouter);


export { app };
