import { createServer } from 'node:http';
import { buildLauncher } from './build.js';

await buildLauncher();
const port = Number(process.env.PORT ?? 4173);
createServer(async (request, response) => {
  if (request.url !== '/' && request.url !== '/index.html') { response.writeHead(404); return response.end('Not found'); }
  try {
    const html = await buildLauncher();
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end(`Build failed: ${error.message}`);
  }
}).listen(port, '127.0.0.1', () => console.log(`WordPress Lab launcher: http://localhost:${port}`));
