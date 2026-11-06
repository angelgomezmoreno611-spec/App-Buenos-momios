import { configuredApp } from '../src/config.js';
let app;
export default async function handler(req, res) {
  try { app ??= configuredApp(); }
  catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Configura las variables del servidor antes de usar datos reales.' }));
    return;
  }
  return app(req, res);
}
