// The server only listens on 127.0.0.1, but any web page open in a browser can still try to reach it.
// These checks make sure only Cockpit's own page (or a local non-browser client) can read or change anything:
// - Host must be 127.0.0.1:PORT or localhost:PORT (stops DNS-rebinding pages, whose Host is their own name).
// - A browser's Origin, when sent, must be ours; Sec-Fetch-Site must be same-origin (or none: typed URL).
// - Changes need the X-Cockpit header, which a cross-site page cannot send without a CORS preflight we never allow.

export function allowedOrigins(port) {
  const list = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (process.env.COCKPIT_DEV) list.push('127.0.0.1:4791', 'localhost:4791') // the Vite dev server's proxy
  return list
}

export function checkHost(req, port) {
  const host = String(req.headers.host || '').toLowerCase()
  return allowedOrigins(port).includes(host) || (process.env.COCKPIT_DEV && /^(127\.0\.0\.1|localhost):4791$/.test(host))
}

/**
 * Returns null when the request may go on, else a short reason.
 * looseRead: GET of a shown entry's files (images inside a sandboxed HTML page arrive as cross-site requests
 * from its opaque origin); those still need our Host and an unguessable entry id.
 */
export function checkApiRequest(req, port, { looseRead = false } = {}) {
  if (!checkHost(req, port)) return 'host'
  const method = req.method || 'GET'
  const reading = method === 'GET' || method === 'HEAD'
  const origin = req.headers.origin
  if (origin !== undefined && !(looseRead && reading)) {
    const o = String(origin).toLowerCase()
    if (!allowedOrigins(port).some(h => o === `http://${h}`)) return 'origin'
  }
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none' && !(looseRead && reading)) return 'site'
  if (!reading && req.headers['x-cockpit'] !== '1') return 'header'
  return null
}
