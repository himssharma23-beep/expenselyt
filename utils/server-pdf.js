const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function getPdfOutputDir() {
  const dir = path.join(process.cwd(), 'public', 'uploads', 'generated-pdfs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findBrowserExecutable() {
  const envPath = String(process.env.PDF_BROWSER_PATH || '').trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function sanitizeBaseName(value, fallback = 'report') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

async function generatePdfFileFromHtml(html, fileNameBase = 'report') {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    throw new Error('No Chrome/Edge browser was found for server PDF generation.');
  }

  const outputDir = getPdfOutputDir();
  const safeBase = sanitizeBaseName(fileNameBase);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const htmlPath = path.join(os.tmpdir(), `${safeBase}-${unique}.html`);
  const pdfPath = path.join(outputDir, `${safeBase}-${unique}.pdf`);
  fs.writeFileSync(htmlPath, String(html || ''), 'utf8');

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--allow-file-access-from-files',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=4000',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ];

  try {
    await execFileAsync(browserPath, args, { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 * 4 });
  } finally {
    try {
      fs.unlinkSync(htmlPath);
    } catch (_err) {}
  }

  if (!fs.existsSync(pdfPath)) {
    throw new Error('Server PDF generation did not produce an output file.');
  }

  return {
    absolutePath: pdfPath,
    publicUrl: `/uploads/generated-pdfs/${path.basename(pdfPath)}`,
    fileName: `${safeBase}.pdf`,
  };
}

module.exports = {
  generatePdfFileFromHtml,
  sanitizeBaseName,
};
