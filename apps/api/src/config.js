import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const dataDir = process.env.DATA_DIR || path.join(projectRoot, 'data');

export const config = {
  port: Number(process.env.PORT || 3001),
  dbPath: process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/^file:/, '')
    : path.join(dataDir, 'meeting-ordering.sqlite3'),
  apiBaseUrl: process.env.OPENAI_BASE_URL || 'https://northgate.xiaobei.top/v1',
  apiKey: process.env.OPENAI_API_KEY || process.env.NAC_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'nex-agi/Nex-N2-Pro-RS',
  allowLocalAgentFallback: process.env.ALLOW_LOCAL_AGENT_FALLBACK !== 'false',
};
