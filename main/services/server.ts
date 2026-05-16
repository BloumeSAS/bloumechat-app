import http from 'http'
import fs from 'fs'
import path from 'path'

export const PROD_PORT = 15999

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm',
}

const CSP_HEADER =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "frame-src https://bloumechat.com https://www.bloumechat.com https://challenges.cloudflare.com; " +
  "connect-src 'self'; font-src 'self' data:; media-src 'self' blob:; worker-src blob:"

export async function startLocalServer(serveDir: string): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname = new URL(req.url || '', `http://${req.headers.host}`).pathname

      if (pathname === '/' || pathname === '') pathname = '/home/index.html'
      else if (pathname === '/home' || pathname === '/home/') pathname = '/home/index.html'
      else if (pathname === '/update' || pathname === '/update/') pathname = '/update/index.html'
      else if (pathname === '/screen-picker' || pathname === '/screen-picker/') pathname = '/screen-picker/index.html'
      else if (!pathname.includes('.')) {
        if (fs.existsSync(path.join(serveDir, pathname + '.html'))) {
          pathname += '.html'
        } else if (fs.existsSync(path.join(serveDir, pathname + '/index.html'))) {
          pathname += '/index.html'
        }
      }

      const filePath = path.join(serveDir, pathname)
      const extname = String(path.extname(filePath)).toLowerCase()
      const contentType = MIME_TYPES[extname] || 'application/octet-stream'

      fs.readFile(filePath, (error, content) => {
        if (error) {
          res.writeHead(error.code === 'ENOENT' ? 404 : 500)
          res.end(error.code === 'ENOENT' ? 'File not found' : 'Internal server error: ' + error.code)
          return
        }
        const headers: Record<string, string> = { 'Content-Type': contentType }
        if (extname === '.html') {
          headers['Content-Security-Policy'] = CSP_HEADER
          headers['X-Content-Type-Options'] = 'nosniff'
          headers['X-Frame-Options'] = 'SAMEORIGIN'
        }
        res.writeHead(200, headers)
        res.end(content, 'utf-8')
      })
    })

    server.listen(PROD_PORT, '127.0.0.1', () => {
      console.log(`[Server] Production server running at http://127.0.0.1:${PROD_PORT}`)
      resolve({ server, port: PROD_PORT })
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PROD_PORT} already in use`)
      }
      reject(err)
    })
  })
}
