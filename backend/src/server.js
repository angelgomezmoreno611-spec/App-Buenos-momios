import { createServer } from 'node:http';
import { configuredApp } from './config.js';

const port = Number(process.env.PORT ?? 3000);
createServer(configuredApp()).listen(port, '0.0.0.0', () => {
  console.log(`Buenos Momios API en http://localhost:${port} (${process.env.DATA_MODE ?? 'live'})`);
});
