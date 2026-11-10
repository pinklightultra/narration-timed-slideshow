#!/usr/bin/env node
/**
 * server.js -- local server for Slideshow Studio. No dependencies.
 *
 * Serves slideshow_studio.html on 127.0.0.1.
 * GET /api/status returns { ok: true, app, port }.
 * POST /api/render runs narration-sync.js with filesystem paths from the JSON
 * body (audio, screenshots, and optional output, groups, noise, min_silence,
 * lead_in). The page does not call that route. The mp4 still comes from the
 * CLI. The route does not accept --width or --height.
 *
 * Usage:
 *   node server.js
 *   node server.js --port 8429
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const PORT = Number(getArg('--port', 8429));
const HOST = '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4'
};

function sendJson(res, data, statusCode = 200) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || HOST}`);
  const pathname = reqUrl.pathname;

  // CORS headers
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // API: Status
  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, { ok: true, app: 'narration-timed-slideshow', port: PORT });
  }

  // API: Render MP4
  if (pathname === '/api/render' && req.method === 'POST') {
    try {
      const payload = await parseBody(req);
      const { audio, screenshots, output, groups, noise, min_silence, lead_in } = payload;

      if (!audio || !screenshots) {
        return sendJson(res, { error: 'Missing required parameters: audio and screenshots' }, 400);
      }

      const scriptPath = path.join(__dirname, 'narration-sync.js');
      const cmdArgs = [scriptPath, '--audio', audio, '--screenshots', screenshots];

      if (output) cmdArgs.push('--output', output);
      if (groups) cmdArgs.push('--groups', String(groups));
      if (noise) cmdArgs.push('--noise', String(noise));
      if (min_silence) cmdArgs.push('--min-silence', String(min_silence));
      if (lead_in) cmdArgs.push('--lead-in', String(lead_in));

      const child = spawn(process.execPath, cmdArgs, { cwd: __dirname });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });

      child.on('close', code => {
        if (code === 0) {
          return sendJson(res, { ok: true, message: 'Render completed successfully', stdout, output });
        }
        // Exit 2 is the CLI's "file written, narration trimmed" status, not a missed render.
        if (code === 2) {
          return sendJson(res, {
            error: 'The mp4 was written, but the end of the narration was trimmed.',
            stderr,
            stdout,
            output,
          }, 500);
        }
        return sendJson(res, { error: `Render failed with exit code ${code}`, stderr, stdout }, 500);
      });
    } catch (e) {
      return sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // Static File Serving
  let filePath = pathname === '/' ? path.join(__dirname, 'slideshow_studio.html') : path.join(__dirname, pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Slideshow Studio server running at http://${HOST}:${PORT}`);
});
