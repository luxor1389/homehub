// Tiny API gateway for the local test stack: mimics Supabase URL layout on one port.
//   /auth/v1/*  -> GoTrue (9999)      /rest/v1/* -> PostgREST (3000)
// Storage and Realtime are not available in this harness (see docs/TESTING.md).
import http from 'node:http';

const routes = [
  { prefix: '/auth/v1', port: Number(process.env.AUTH_PORT ?? 9999) },
  { prefix: '/rest/v1', port: Number(process.env.REST_PORT ?? 3000) },
];
const port = Number(process.env.GATEWAY_PORT ?? 54321);

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, range, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-total-count',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const route = routes.find((r) => req.url.startsWith(r.prefix));
  if (!route) { res.writeHead(404, { ...cors, 'content-type': 'application/json' }); return res.end('{"message":"not available in local harness"}'); }
  const path = req.url.slice(route.prefix.length) || '/';
  const proxied = http.request({ host: '127.0.0.1', port: route.port, path, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${route.port}` } }, (up) => {
    res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors });
    up.pipe(res);
  });
  proxied.on('error', (e) => { res.writeHead(502, cors); res.end(String(e.message)); });
  req.pipe(proxied);
}).listen(port, () => console.log(`gateway on http://localhost:${port}`));
