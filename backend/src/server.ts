
import { app } from './app';
import dotenv from 'dotenv';

dotenv.config();

const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const agentKey = process.env.AGENT_API_KEY;

console.log('======= Platypus Startup Config =======');
console.log(`PORT:             ${port}`);
if (agentKey) {
  console.log('AGENT_API_KEY:     [SET]');
} else {
  console.log('AGENT_API_KEY:     [NOT SET, LLM will not work]');
}
if (!port || isNaN(port)) {
  console.error('Fatal: No PORT specified and default failed.');
  process.exit(1);
}
app.listen(port, () => {
  console.log(`🚀 Platypus backend running at http://localhost:${port}`);
});