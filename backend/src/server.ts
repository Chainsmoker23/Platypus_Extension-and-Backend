import express from 'express';
import cors from 'cors';
import { analyzeRouter } from './api/analyze';
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Add request logging middleware
app.use((req, res, next) => {
  const requestId = uuidv4();
  // @ts-ignore
  req.id = requestId;
  console.log(`[${new Date().toISOString()}] Request [${requestId}] ${req.method} ${req.originalUrl}`);
  next();
});


app.get('/', (req, res) => {
  res.send('Platypus Backend is running!');
});

app.use('/api/v1/analyze', analyzeRouter);


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});