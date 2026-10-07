// Read report data through the same authenticated API as the web app. The origin
// is the current server's listening socket, never a client-supplied host or URL.
function createPdfReportApi(req) {
  const port = Number(req.socket.localPort);
  if (!(port > 0)) throw new Error('Report data service is unavailable.');
  const origin = `${req.socket.encrypted ? 'https' : 'http'}://127.0.0.1:${port}`;
  const headers = {};
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  if (req.headers.cookie) headers.cookie = req.headers.cookie;
  return async path => {
    const allowed = /^\/api\/(?:cc\/cards|trackers|habit-trackers|planner\/(?:preview|monthly)|friends|emi\/records)(?:[/?]|$)/;
    if (!allowed.test(path) || /[\\#\r\n]/.test(path)) {
      throw new Error('Unsupported report data source.');
    }
    const url = new URL(path, origin);
    if (url.origin !== origin || !allowed.test(url.pathname)) throw new Error('Invalid report data source.');
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error || 'Could not read report data.');
    return body;
  };
}
module.exports = { createPdfReportApi };
