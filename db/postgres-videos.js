const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { query } = require('./postgres');

const VIDEO_SETTINGS_KEY = 'video_library';
const DEFAULT_VIDEO_ROOT_PATH = path.join(process.cwd(), 'videos');
const LOCAL_FFMPEG_BIN_DIR = path.join(process.cwd(), 'tools', 'ffmpeg', 'bundle', 'ffmpeg-N-124278-gcc3ca17127-win64-lgpl', 'bin');
const DEFAULT_VIDEO_SETTINGS = {
  library_title: 'Video Library',
  videos_root_path: DEFAULT_VIDEO_ROOT_PATH,
  recursive_scan: true,
  allowed_extensions: ['.mp4', '.webm', '.ogg', '.mov', '.m4v', '.mkv'],
};

let ensureVideoTablesPromise = null;
let mediaToolsStatusPromise = null;
const VIDEO_SUBTITLE_CACHE_DIR = path.join(process.cwd(), 'data', 'video-subtitles-cache');

function roundNumber(value) {
  return Math.round((Number(value || 0) || 0) * 100) / 100;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function normalizeAllowedExtensions(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  const normalized = source
    .map((ext) => String(ext || '').trim().toLowerCase())
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
    .filter((ext) => /^\.[a-z0-9]+$/i.test(ext));
  return [...new Set(normalized)].slice(0, 24);
}

function normalizeVideoSettings(raw = {}) {
  return {
    library_title: String(raw.library_title || DEFAULT_VIDEO_SETTINGS.library_title).trim() || DEFAULT_VIDEO_SETTINGS.library_title,
    videos_root_path: normalizeVideoRootPath(raw.videos_root_path),
    recursive_scan: normalizeBoolean(raw.recursive_scan, true),
    allowed_extensions: normalizeAllowedExtensions(raw.allowed_extensions).length
      ? normalizeAllowedExtensions(raw.allowed_extensions)
      : [...DEFAULT_VIDEO_SETTINGS.allowed_extensions],
  };
}

function normalizeVideoRootPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_VIDEO_ROOT_PATH;
  const normalized = raw.replace(/[\\/]+/g, path.sep).replace(/[\\/]+$/, '');
  if (/^[/\\]videos$/i.test(raw) || /^videos$/i.test(raw)) {
    return DEFAULT_VIDEO_ROOT_PATH;
  }
  if (path.isAbsolute(normalized)) return normalized;
  return path.resolve(process.cwd(), normalized);
}

function prettyVideoTitle(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled Video';
}

function normalizeSubtitleLang(label) {
  const value = String(label || '').trim().toLowerCase();
  if (!value) return 'en';
  if (['en', 'eng', 'english'].includes(value)) return 'en';
  if (['hi', 'hin', 'hindi'].includes(value)) return 'hi';
  if (['es', 'spa', 'spanish'].includes(value)) return 'es';
  if (['fr', 'fre', 'fra', 'french'].includes(value)) return 'fr';
  if (['de', 'ger', 'deu', 'german'].includes(value)) return 'de';
  if (['it', 'ita', 'italian'].includes(value)) return 'it';
  if (['pt', 'por', 'portuguese'].includes(value)) return 'pt';
  if (['ja', 'jpn', 'japanese'].includes(value)) return 'ja';
  if (['ko', 'kor', 'korean'].includes(value)) return 'ko';
  if (['zh', 'chi', 'zho', 'chinese'].includes(value)) return 'zh';
  return /^[a-z]{2,5}$/i.test(value) ? value.slice(0, 5) : 'en';
}

function prettySubtitleLabel(relativeSubtitlePath, videoBaseName) {
  const subtitleFileName = path.basename(String(relativeSubtitlePath || ''));
  const subtitleBase = subtitleFileName.replace(/\.[^.]+$/, '');
  const videoBase = String(videoBaseName || '').replace(/\.[^.]+$/, '');
  let suffix = subtitleBase.slice(videoBase.length).replace(/^[._\-\s]+/, '').trim();
  if (!suffix) return { label: 'Subtitles', srclang: 'en' };
  const lang = normalizeSubtitleLang(suffix);
  return {
    label: suffix.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Subtitles',
    srclang: lang,
  };
}

function subtitleDisplayNameFromTags(tags = {}, fallback = 'Embedded Subtitles') {
  const title = String(tags.title || tags.TITLE || '').trim();
  const language = normalizeSubtitleLang(tags.language || tags.LANGUAGE || '');
  if (title) return { label: title, srclang: language };
  if (language && language !== 'en') return { label: language.toUpperCase(), srclang: language };
  return { label: fallback, srclang: language || 'en' };
}

function encodeVideoToken(relativePath) {
  return Buffer.from(String(relativePath || ''), 'utf8').toString('base64url');
}

function decodeVideoToken(token) {
  try {
    return Buffer.from(String(token || ''), 'base64url').toString('utf8');
  } catch (_err) {
    return '';
  }
}

function encodeEmbeddedSubtitleToken(relativeVideoPath, streamIndex) {
  return Buffer.from(JSON.stringify({
    type: 'embedded_subtitle',
    video: String(relativeVideoPath || ''),
    stream_index: Number(streamIndex || 0),
  }), 'utf8').toString('base64url');
}

function decodeStructuredToken(token) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function normalizeResolvedPath(value) {
  return path.resolve(String(value || '')).replace(/[\\/]+$/, '');
}

function ffprobeCommand() {
  const localPath = path.join(LOCAL_FFMPEG_BIN_DIR, 'ffprobe.exe');
  if (fs.existsSync(localPath)) return localPath;
  return String(process.env.FFPROBE_PATH || 'ffprobe').trim() || 'ffprobe';
}

function ffmpegCommand() {
  const localPath = path.join(LOCAL_FFMPEG_BIN_DIR, 'ffmpeg.exe');
  if (fs.existsSync(localPath)) return localPath;
  return String(process.env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg';
}

function execFileAsync(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 24 * 1024 * 1024, windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function isMissingMediaBinaryError(error) {
  return ['ENOENT', 'UNKNOWN'].includes(String(error?.code || '').toUpperCase())
    || /not recognized|not found|no such file/i.test(String(error?.message || ''));
}

async function getMediaToolsStatus() {
  if (!mediaToolsStatusPromise) {
    mediaToolsStatusPromise = (async () => {
      try {
        await execFileAsync(ffprobeCommand(), ['-version']);
        await execFileAsync(ffmpegCommand(), ['-version']);
        return { available: true, message: '' };
      } catch (error) {
        return {
          available: false,
          message: isMissingMediaBinaryError(error)
            ? 'Embedded subtitle extraction requires ffmpeg and ffprobe on the server.'
            : 'Embedded subtitle tools are not available right now.',
        };
      }
    })().catch(() => ({ available: false, message: 'Embedded subtitle tools are not available right now.' }));
  }
  return mediaToolsStatusPromise;
}

function isPathInsideRoot(rootPath, targetPath) {
  const normalizedRoot = normalizeResolvedPath(rootPath).toLowerCase();
  const normalizedTarget = normalizeResolvedPath(targetPath).toLowerCase();
  if (!normalizedRoot || !normalizedTarget) return false;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep.toLowerCase()}`);
}

function videoMimeType(filePath) {
  const ext = String(path.extname(filePath) || '').toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.ogg' || ext === '.ogv') return 'video/ogg';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

function subtitleMimeType(filePath) {
  const ext = String(path.extname(filePath) || '').toLowerCase();
  if (ext === '.vtt') return 'text/vtt; charset=utf-8';
  if (ext === '.srt') return 'text/plain; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function ensureSubtitleCacheDir() {
  await fs.promises.mkdir(VIDEO_SUBTITLE_CACHE_DIR, { recursive: true });
  return VIDEO_SUBTITLE_CACHE_DIR;
}

async function listSidecarSubtitles(rootPath, normalizedRelativeVideoPath) {
  const relativeVideoPath = String(normalizedRelativeVideoPath || '').replace(/\\/g, '/');
  const videoDir = path.dirname(relativeVideoPath);
  const videoFilename = path.basename(relativeVideoPath);
  const videoBase = videoFilename.replace(/\.[^.]+$/, '');
  const directoryPath = videoDir && videoDir !== '.'
    ? path.join(rootPath, videoDir)
    : rootPath;
  const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  const subtitles = [];

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const ext = String(path.extname(entry.name) || '').toLowerCase();
    if (!['.vtt', '.srt'].includes(ext)) continue;
    const subtitleBase = entry.name.replace(/\.[^.]+$/, '');
    if (!(subtitleBase === videoBase || subtitleBase.startsWith(`${videoBase}.`) || subtitleBase.startsWith(`${videoBase}_`) || subtitleBase.startsWith(`${videoBase}-`) || subtitleBase.startsWith(`${videoBase} `))) {
      continue;
    }
    const relativeSubtitlePath = (videoDir && videoDir !== '.')
      ? path.join(videoDir, entry.name)
      : entry.name;
    const normalizedSubtitlePath = relativeSubtitlePath.split(path.sep).join('/');
    const meta = prettySubtitleLabel(normalizedSubtitlePath, videoFilename);
    subtitles.push({
      id: encodeVideoToken(normalizedSubtitlePath),
      filename: entry.name,
      relative_path: normalizedSubtitlePath,
      label: meta.label,
      srclang: meta.srclang,
      extension: ext,
    });
  }

  return subtitles.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

async function listEmbeddedSubtitles(rootPath, normalizedRelativeVideoPath) {
  const toolStatus = await getMediaToolsStatus();
  if (!toolStatus.available) return [];
  const absoluteVideoPath = path.join(rootPath, String(normalizedRelativeVideoPath || '').replace(/\//g, path.sep));
  try {
    const { stdout } = await execFileAsync(ffprobeCommand(), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      absoluteVideoPath,
    ]);
    const payload = JSON.parse(String(stdout || '{}'));
    const streams = Array.isArray(payload?.streams) ? payload.streams : [];
    const subtitles = streams
      .filter((stream) => String(stream.codec_type || '').toLowerCase() === 'subtitle')
      .map((stream, index) => {
        const meta = subtitleDisplayNameFromTags(stream.tags || {}, `Embedded Subtitle ${index + 1}`);
        return {
          id: encodeEmbeddedSubtitleToken(normalizedRelativeVideoPath, Number(stream.index || 0)),
          filename: path.basename(normalizedRelativeVideoPath),
          relative_path: normalizedRelativeVideoPath,
          label: meta.label,
          srclang: meta.srclang,
          extension: '.embedded',
          source_type: 'embedded',
          stream_index: Number(stream.index || 0),
          codec_name: String(stream.codec_name || '').trim().toLowerCase(),
          is_default: stream.disposition?.default === 1,
          is_forced: stream.disposition?.forced === 1,
        };
      });
    return subtitles;
  } catch (error) {
    if (isMissingMediaBinaryError(error)) return [];
    return [];
  }
}

function convertSrtToVtt(content) {
  const normalized = String(content || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\d+:\d+:\d+),(\d+)/g, '$1.$2');
  return `WEBVTT\n\n${normalized}`;
}

function subtitleCacheFilePath(relativeVideoPath, streamIndex) {
  const digest = crypto.createHash('sha1').update(`${relativeVideoPath}::${Number(streamIndex || 0)}`).digest('hex');
  return path.join(VIDEO_SUBTITLE_CACHE_DIR, `${digest}.vtt`);
}

async function ensureEmbeddedSubtitleExtracted(rootPath, relativeVideoPath, streamIndex) {
  await ensureSubtitleCacheDir();
  const absoluteVideoPath = path.join(rootPath, String(relativeVideoPath || '').replace(/\//g, path.sep));
  const cacheFilePath = subtitleCacheFilePath(relativeVideoPath, streamIndex);
  try {
    const [videoStats, cacheStats] = await Promise.all([
      fs.promises.stat(absoluteVideoPath),
      fs.promises.stat(cacheFilePath).catch(() => null),
    ]);
    if (cacheStats && cacheStats.mtimeMs >= videoStats.mtimeMs && cacheStats.size > 0) {
      return cacheFilePath;
    }
  } catch (_err) {}

  const tempFilePath = `${cacheFilePath}.tmp`;
  try {
    await execFileAsync(ffmpegCommand(), [
      '-y',
      '-i', absoluteVideoPath,
      '-map', `0:${Number(streamIndex || 0)}`,
      '-f', 'webvtt',
      tempFilePath,
    ]);
    await fs.promises.rename(tempFilePath, cacheFilePath);
    return cacheFilePath;
  } catch (error) {
    try { await fs.promises.unlink(tempFilePath); } catch (_err) {}
    throw error;
  }
}

async function ensureVideoTables() {
  if (!ensureVideoTablesPromise) {
    ensureVideoTablesPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS app_runtime_settings (
          setting_key TEXT PRIMARY KEY,
          setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_by BIGINT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`ALTER TABLE app_runtime_settings ADD COLUMN IF NOT EXISTS updated_by BIGINT NULL`);
      await query(`ALTER TABLE app_runtime_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
      await query(`
        CREATE TABLE IF NOT EXISTS video_watch_progress (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          current_seconds NUMERIC(12,2) NOT NULL DEFAULT 0,
          duration_seconds NUMERIC(12,2) NOT NULL DEFAULT 0,
          progress_percent NUMERIC(7,2) NOT NULL DEFAULT 0,
          is_completed BOOLEAN NOT NULL DEFAULT FALSE,
          completed_at TIMESTAMPTZ,
          last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, relative_path)
        )
      `);
      await query(`CREATE INDEX IF NOT EXISTS idx_video_watch_progress_user_id ON video_watch_progress(user_id)`);
    })().catch((error) => {
      ensureVideoTablesPromise = null;
      throw error;
    });
  }
  return ensureVideoTablesPromise;
}

async function getVideoWatchProgressMap(userId, relativePaths = []) {
  await ensureVideoTables();
  const cleanUserId = Number(userId || 0);
  if (!(cleanUserId > 0) || !Array.isArray(relativePaths) || !relativePaths.length) return new Map();
  const result = await query(
    `SELECT relative_path, current_seconds, duration_seconds, progress_percent, is_completed, completed_at, last_watched_at, updated_at
     FROM video_watch_progress
     WHERE user_id = $1
       AND relative_path = ANY($2::text[])`,
    [cleanUserId, relativePaths]
  );
  return new Map(result.rows.map((row) => [String(row.relative_path || ''), {
    current_seconds: roundNumber(row.current_seconds || 0),
    duration_seconds: roundNumber(row.duration_seconds || 0),
    progress_percent: roundNumber(row.progress_percent || 0),
    is_completed: !!row.is_completed,
    completed_at: row.completed_at || null,
    last_watched_at: row.last_watched_at || null,
    updated_at: row.updated_at || null,
  }]));
}

async function saveVideoWatchProgress(userId, payload = {}) {
  await ensureVideoTables();
  const cleanUserId = Number(userId || 0);
  if (!(cleanUserId > 0)) throw new Error('User is required');
  const relativePath = String(payload.relative_path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) throw new Error('Video path is invalid');
  const currentSeconds = roundNumber(payload.current_seconds || 0);
  const durationSeconds = roundNumber(payload.duration_seconds || 0);
  const safeDuration = durationSeconds > 0 ? durationSeconds : 0;
  const inferredPercent = safeDuration > 0 ? Math.min(100, Math.max(0, roundNumber((currentSeconds / safeDuration) * 100))) : 0;
  const isCompleted = !!payload.is_completed || (safeDuration > 0 && currentSeconds >= Math.max(safeDuration - 5, safeDuration * 0.98));
  const effectiveCurrent = isCompleted ? safeDuration : Math.max(0, currentSeconds);
  const progressPercent = isCompleted ? 100 : inferredPercent;
  const completedAt = isCompleted ? new Date().toISOString() : null;
  const result = await query(
    `INSERT INTO video_watch_progress (
      user_id, relative_path, current_seconds, duration_seconds, progress_percent, is_completed, completed_at, last_watched_at, updated_at
     ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
     )
     ON CONFLICT (user_id, relative_path)
     DO UPDATE SET
       current_seconds = EXCLUDED.current_seconds,
       duration_seconds = EXCLUDED.duration_seconds,
       progress_percent = EXCLUDED.progress_percent,
       is_completed = EXCLUDED.is_completed,
       completed_at = CASE WHEN EXCLUDED.is_completed THEN EXCLUDED.completed_at ELSE NULL END,
       last_watched_at = NOW(),
       updated_at = NOW()
     RETURNING relative_path, current_seconds, duration_seconds, progress_percent, is_completed, completed_at, last_watched_at, updated_at`,
    [cleanUserId, relativePath, effectiveCurrent, safeDuration, progressPercent, isCompleted, completedAt]
  );
  const row = result.rows[0] || {};
  return {
    relative_path: String(row.relative_path || relativePath),
    current_seconds: roundNumber(row.current_seconds || 0),
    duration_seconds: roundNumber(row.duration_seconds || 0),
    progress_percent: roundNumber(row.progress_percent || 0),
    is_completed: !!row.is_completed,
    completed_at: row.completed_at || null,
    last_watched_at: row.last_watched_at || null,
    updated_at: row.updated_at || null,
  };
}

async function getVideoLibrarySettings() {
  await ensureVideoTables();
  const result = await query(
    `SELECT setting_value
       FROM app_runtime_settings
      WHERE setting_key = $1
      LIMIT 1`,
    [VIDEO_SETTINGS_KEY]
  );
  const saved = result.rows[0]?.setting_value || {};
  return normalizeVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, ...saved });
}

async function saveVideoLibrarySettings(payload = {}, adminUserId = null) {
  await ensureVideoTables();
  const settings = normalizeVideoSettings(payload);
  await query(
    `INSERT INTO app_runtime_settings (setting_key, setting_value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (setting_key)
     DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [VIDEO_SETTINGS_KEY, JSON.stringify(settings), adminUserId || null]
  );
  return settings;
}

async function scanVideoDirectory(rootPath, options = {}, relativePrefix = '') {
  const recursive = normalizeBoolean(options.recursive, true);
  const allowedExtensions = normalizeAllowedExtensions(options.allowed_extensions).length
    ? normalizeAllowedExtensions(options.allowed_extensions)
    : [...DEFAULT_VIDEO_SETTINGS.allowed_extensions];
  const directoryPath = relativePrefix ? path.join(rootPath, relativePrefix) : rootPath;
  const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  const videos = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryRelativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;
    const absolutePath = path.join(rootPath, entryRelativePath);

    if (entry.isDirectory()) {
      if (recursive) {
        const nested = await scanVideoDirectory(rootPath, { recursive, allowed_extensions: allowedExtensions }, entryRelativePath);
        videos.push(...nested);
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = String(path.extname(entry.name) || '').toLowerCase();
    if (!allowedExtensions.includes(ext)) continue;
    const stats = await fs.promises.stat(absolutePath);
    const normalizedRelativePath = entryRelativePath.split(path.sep).join('/');
    const folderPath = path.dirname(normalizedRelativePath).replace(/\\/g, '/');

    const sidecarSubtitles = await listSidecarSubtitles(rootPath, normalizedRelativePath);
    const embeddedSubtitles = await listEmbeddedSubtitles(rootPath, normalizedRelativePath);
    videos.push({
      id: encodeVideoToken(normalizedRelativePath),
      title: prettyVideoTitle(entry.name),
      filename: entry.name,
      folder: folderPath === '.' ? '' : folderPath,
      relative_path: normalizedRelativePath,
      extension: ext,
      size_bytes: Number(stats.size || 0),
      size_mb: roundNumber((Number(stats.size || 0) || 0) / (1024 * 1024)),
      updated_at: stats.mtime ? stats.mtime.toISOString() : null,
      mime_type: videoMimeType(entry.name),
      subtitles: [...sidecarSubtitles, ...embeddedSubtitles],
    });
  }

  return videos.sort((a, b) => {
    if (a.folder !== b.folder) return String(a.folder || '').localeCompare(String(b.folder || ''));
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

async function listVideoLibrary(userId = null) {
  const settings = await getVideoLibrarySettings();
  const rootPath = settings.videos_root_path;
  if (!rootPath) {
    return {
      configured: false,
      settings,
      videos: [],
      message: 'Video library path is not configured yet.',
    };
  }

  const resolvedRootPath = path.resolve(rootPath);
  let stats = null;
  try {
    stats = await fs.promises.stat(resolvedRootPath);
  } catch (_err) {
    return {
      configured: true,
      settings,
      videos: [],
      root_exists: false,
      message: 'Configured video folder was not found on the server.',
    };
  }

  if (!stats.isDirectory()) {
    return {
      configured: true,
      settings,
      videos: [],
      root_exists: false,
      message: 'Configured video path is not a folder.',
    };
  }

  const videos = await scanVideoDirectory(resolvedRootPath, {
    recursive: settings.recursive_scan,
    allowed_extensions: settings.allowed_extensions,
  });
  const progressMap = await getVideoWatchProgressMap(userId, videos.map((video) => String(video.relative_path || '')));
  const subtitle_engine = await getMediaToolsStatus();

  return {
    configured: true,
    settings,
    root_exists: true,
    root_path: resolvedRootPath,
    videos: videos.map((video) => ({
      ...video,
      progress: progressMap.get(String(video.relative_path || '')) || null,
    })),
    subtitle_engine,
    message: videos.length ? '' : 'No supported video files were found in this folder yet.',
  };
}

async function resolveVideoStreamTarget(token) {
  const settings = await getVideoLibrarySettings();
  if (!settings.videos_root_path) return null;
  const relativePath = decodeVideoToken(token).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) return null;
  const resolvedRootPath = path.resolve(settings.videos_root_path);
  const absolutePath = path.resolve(resolvedRootPath, relativePath);
  if (!isPathInsideRoot(resolvedRootPath, absolutePath)) return null;

  let stats = null;
  try {
    stats = await fs.promises.stat(absolutePath);
  } catch (_err) {
    return null;
  }
  if (!stats.isFile()) return null;

  const ext = String(path.extname(absolutePath) || '').toLowerCase();
  const allowedExtensions = settings.allowed_extensions || DEFAULT_VIDEO_SETTINGS.allowed_extensions;
  if (!allowedExtensions.includes(ext)) return null;

  return {
    settings,
    relative_path: relativePath,
    absolute_path: absolutePath,
    stats,
    filename: path.basename(absolutePath),
    title: prettyVideoTitle(path.basename(absolutePath)),
    mime_type: videoMimeType(absolutePath),
  };
}

async function resolveSubtitleStreamTarget(token) {
  const settings = await getVideoLibrarySettings();
  if (!settings.videos_root_path) return null;
  const structured = decodeStructuredToken(token);
  if (structured?.type === 'embedded_subtitle') {
    const relativeVideoPath = String(structured.video || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const streamIndex = Number(structured.stream_index || 0);
    if (!relativeVideoPath || relativeVideoPath.includes('..') || !Number.isInteger(streamIndex) || streamIndex < 0) return null;
    const resolvedRootPath = path.resolve(settings.videos_root_path);
    const absoluteVideoPath = path.resolve(resolvedRootPath, relativeVideoPath);
    if (!isPathInsideRoot(resolvedRootPath, absoluteVideoPath)) return null;
    try {
      const absoluteSubtitlePath = await ensureEmbeddedSubtitleExtracted(resolvedRootPath, relativeVideoPath, streamIndex);
      const stats = await fs.promises.stat(absoluteSubtitlePath);
      return {
        settings,
        relative_path: relativeVideoPath,
        absolute_path: absoluteSubtitlePath,
        stats,
        filename: path.basename(absoluteSubtitlePath),
        mime_type: 'text/vtt; charset=utf-8',
        extension: '.vtt',
      };
    } catch (error) {
      if (isMissingMediaBinaryError(error)) {
        const missingToolError = new Error('Embedded subtitle extraction requires ffmpeg and ffprobe on the server.');
        missingToolError.statusCode = 503;
        throw missingToolError;
      }
      throw error;
    }
  }
  const relativePath = decodeVideoToken(token).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) return null;
  const resolvedRootPath = path.resolve(settings.videos_root_path);
  const absolutePath = path.resolve(resolvedRootPath, relativePath);
  if (!isPathInsideRoot(resolvedRootPath, absolutePath)) return null;

  let stats = null;
  try {
    stats = await fs.promises.stat(absolutePath);
  } catch (_err) {
    return null;
  }
  if (!stats.isFile()) return null;

  const ext = String(path.extname(absolutePath) || '').toLowerCase();
  if (!['.vtt', '.srt'].includes(ext)) return null;

  return {
    settings,
    relative_path: relativePath,
    absolute_path: absolutePath,
    stats,
    filename: path.basename(absolutePath),
    mime_type: subtitleMimeType(absolutePath),
    extension: ext,
  };
}

module.exports = {
  DEFAULT_VIDEO_SETTINGS,
  getVideoLibrarySettings,
  saveVideoLibrarySettings,
  listVideoLibrary,
  saveVideoWatchProgress,
  resolveVideoStreamTarget,
  resolveSubtitleStreamTarget,
  convertSrtToVtt,
};
