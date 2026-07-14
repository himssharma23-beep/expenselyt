const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
let puppeteerModule = null;
let puppeteerLoadError = null;

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
        path.join(String(process.env.LOCALAPPDATA || ''), 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(String(process.env.LOCALAPPDATA || ''), 'Chromium', 'Application', 'chrome.exe'),
        path.join(String(process.env.LOCALAPPDATA || ''), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
        '/opt/google/chrome/chrome',
        '/opt/microsoft/msedge/msedge',
      ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === 'win32') {
    const registryCandidates = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
    ];
    for (const registryKey of registryCandidates) {
      try {
        const result = require('child_process').spawnSync('reg', ['query', registryKey, '/ve'], {
          windowsHide: true,
          encoding: 'utf8',
        });
        const output = String(result?.stdout || '');
        const match = output.match(/[A-Z]:\\[^\r\n]+?\.(?:exe)/i);
        if (match && fs.existsSync(match[0])) return match[0];
      } catch (_err) {}
    }
    const pathCommands = ['chrome.exe', 'msedge.exe', 'chrome', 'msedge'];
    for (const cmd of pathCommands) {
      try {
        const result = require('child_process').spawnSync('where', [cmd], {
          windowsHide: true,
          encoding: 'utf8',
        });
        const lines = String(result?.stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const hit = lines.find((line) => fs.existsSync(line));
        if (hit) return hit;
      } catch (_err) {}
    }
  } else {
    const pathCommands = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
    for (const cmd of pathCommands) {
      try {
        const result = require('child_process').spawnSync('which', [cmd], {
          encoding: 'utf8',
        });
        const hit = String(result?.stdout || '').trim();
        if (hit && fs.existsSync(hit)) return hit;
      } catch (_err) {}
    }
  }

  return '';
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

function getPuppeteerModule() {
  if (puppeteerModule) return puppeteerModule;
  if (puppeteerLoadError) return null;
  try {
    // Installed as a regular dependency so server PDF generation does not rely only on system Chrome/Edge.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    puppeteerModule = require('puppeteer');
    return puppeteerModule;
  } catch (err) {
    puppeteerLoadError = err;
    return null;
  }
}

async function generatePdfViaPuppeteer(html, pdfPath, browserPath = '') {
  const puppeteer = getPuppeteerModule();
  if (!puppeteer) {
    throw puppeteerLoadError || new Error('Puppeteer is not available for server PDF generation.');
  }
  const launchOptions = {
    headless: true,
    args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (browserPath) launchOptions.executablePath = browserPath;
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(String(html || ''), { waitUntil: ['domcontentloaded', 'networkidle0'] });
    await page.emulateMediaType('screen');
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    try {
      await browser.close();
    } catch (_err) {}
  }
}

function getPdfServerStatus() {
  const browserPath = findBrowserExecutable();
  const puppeteer = getPuppeteerModule();
  const outputDir = getPdfOutputDir();
  const envPath = String(process.env.PDF_BROWSER_PATH || '').trim();
  return {
    ok: !!browserPath || !!puppeteer,
    browserPath: browserPath || null,
    browserDetected: !!browserPath,
    puppeteerAvailable: !!puppeteer,
    puppeteerError: puppeteer ? null : (puppeteerLoadError ? String(puppeteerLoadError.message || puppeteerLoadError) : null),
    configuredBrowserPath: envPath || null,
    configuredBrowserPathExists: !!(envPath && fs.existsSync(envPath)),
    outputDir,
    outputDirExists: fs.existsSync(outputDir),
    platform: process.platform,
    cwd: process.cwd(),
    fallbackMode: browserPath || puppeteer ? 'server-pdf-file' : 'html-print-preview',
  };
}

async function generatePdfFileFromHtml(html, fileNameBase = 'report') {
  const browserPath = findBrowserExecutable();
  const puppeteer = getPuppeteerModule();
  if (!browserPath && !puppeteer) {
    throw new Error('No Chrome/Edge browser was found for server PDF generation.');
  }

  const outputDir = getPdfOutputDir();
  const safeBase = sanitizeBaseName(fileNameBase);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const htmlPath = path.join(os.tmpdir(), `${safeBase}-${unique}.html`);
  const pdfPath = path.join(outputDir, `${safeBase}-${unique}.pdf`);
  if (browserPath) {
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

    let browserError = null;
    try {
      await execFileAsync(browserPath, args, { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 * 4 });
    } catch (err) {
      browserError = err;
    } finally {
      try {
        fs.unlinkSync(htmlPath);
      } catch (_err) {}
    }
    if (browserError) {
      if (!puppeteer) {
        throw browserError;
      }
      await generatePdfViaPuppeteer(html, pdfPath, '');
    }
  } else {
    await generatePdfViaPuppeteer(html, pdfPath);
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
  getPdfServerStatus,
  sanitizeBaseName,
};
