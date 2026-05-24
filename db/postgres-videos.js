const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { query, withTransaction } = require('./postgres');

const VIDEO_SETTINGS_KEY = 'video_library';
const LEGACY_VIDEO_ROOT_PATH = path.join(process.cwd(), 'videos');
const SHARED_VIDEO_ROOT_PATH = path.resolve(process.cwd(), '..', 'shared', 'videos');
const DEFAULT_VIDEO_ROOT_PATH = process.platform === 'win32'
  ? LEGACY_VIDEO_ROOT_PATH
  : SHARED_VIDEO_ROOT_PATH;
const LOCAL_FFMPEG_BIN_DIR = path.resolve(__dirname, '..', 'tools', 'ffmpeg', 'bundle', 'ffmpeg-N-124278-gcc3ca17127-win64-lgpl', 'bin');
const DEFAULT_VIDEO_SETTINGS = {
  library_title: 'Video Library',
  videos_root_path: DEFAULT_VIDEO_ROOT_PATH,
  recursive_scan: true,
  allowed_extensions: ['.mp4', '.webm', '.ogg', '.mov', '.m4v', '.mkv'],
};

let ensureVideoTablesPromise = null;
let mediaToolsStatusPromise = null;
const VIDEO_SUBTITLE_CACHE_DIR = path.join(process.cwd(), 'data', 'video-subtitles-cache');
const VIDEO_CATALOG_STATUSES = {
  SCANNED: 'scanned',
  REVIEW: 'review',
  PUBLISHED: 'published',
};

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

function videoDirectPlaySupported(relativePath = '', mimeType = '', audioTracks = []) {
  const ext = String(path.extname(String(relativePath || '')) || '').toLowerCase();
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  const containerSupported = ['.mp4', '.m4v', '.mov'].includes(ext)
    || ['video/mp4', 'video/x-m4v', 'video/quicktime'].includes(normalizedMime);
  if (!containerSupported) return false;
  const tracks = Array.isArray(audioTracks) ? audioTracks : [];
  if (tracks.length > 1) return false;
  const defaultAudioTrack = tracks.find((track) => track?.is_default) || tracks[0] || null;
  const audioCodec = String(defaultAudioTrack?.codec_name || '').trim().toLowerCase();
  if (audioCodec && !['aac', 'mp3'].includes(audioCodec)) return false;
  return true;
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

function resolveVideoRootPathForRuntime(configuredPath) {
  const configuredResolved = path.resolve(String(configuredPath || DEFAULT_VIDEO_ROOT_PATH));
  const normalizedConfigured = normalizeResolvedPath(configuredResolved);
  const normalizedLegacy = normalizeResolvedPath(LEGACY_VIDEO_ROOT_PATH);
  const normalizedShared = normalizeResolvedPath(SHARED_VIDEO_ROOT_PATH);
  if (
    normalizedConfigured === normalizedLegacy
    && normalizedShared !== normalizedLegacy
    && !fs.existsSync(configuredResolved)
    && fs.existsSync(SHARED_VIDEO_ROOT_PATH)
  ) {
    return SHARED_VIDEO_ROOT_PATH;
  }
  return configuredResolved;
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

function normalizeAudioLang(label) {
  const value = String(label || '').trim().toLowerCase();
  if (!value) return 'und';
  if (['en', 'eng', 'english'].includes(value)) return 'en';
  if (['hi', 'hin', 'hindi'].includes(value)) return 'hi';
  if (['ta', 'tam', 'tamil'].includes(value)) return 'ta';
  if (['te', 'tel', 'telugu'].includes(value)) return 'te';
  if (['ml', 'mal', 'malayalam'].includes(value)) return 'ml';
  if (['kn', 'kan', 'kannada'].includes(value)) return 'kn';
  if (['es', 'spa', 'spanish'].includes(value)) return 'es';
  if (['fr', 'fre', 'fra', 'french'].includes(value)) return 'fr';
  if (['de', 'ger', 'deu', 'german'].includes(value)) return 'de';
  if (['it', 'ita', 'italian'].includes(value)) return 'it';
  if (['pt', 'por', 'portuguese'].includes(value)) return 'pt';
  if (['ja', 'jpn', 'japanese'].includes(value)) return 'ja';
  if (['ko', 'kor', 'korean'].includes(value)) return 'ko';
  if (['zh', 'chi', 'zho', 'chinese'].includes(value)) return 'zh';
  return /^[a-z]{2,5}$/i.test(value) ? value.slice(0, 5) : 'und';
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

function audioDisplayNameFromStream(stream = {}, fallback = 'Audio Track') {
  const tags = stream?.tags || {};
  const title = String(tags.title || tags.TITLE || '').trim();
  const language = normalizeAudioLang(tags.language || tags.LANGUAGE || '');
  const codec = String(stream?.codec_name || '').trim().toUpperCase();
  const channels = Number(stream?.channels || 0);
  const channelLabel = channels >= 6 ? '5.1' : channels >= 2 ? 'Stereo' : channels === 1 ? 'Mono' : '';
  const baseLabel = title || (language && language !== 'und' ? language.toUpperCase() : fallback);
  const detailParts = [channelLabel, codec].filter(Boolean);
  return {
    language,
    label: detailParts.length ? `${baseLabel} (${detailParts.join(' / ')})` : baseLabel,
    short_label: title || (language && language !== 'und' ? language.toUpperCase() : fallback),
  };
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

async function listEmbeddedAudioTracks(rootPath, normalizedRelativeVideoPath) {
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
    return streams
      .filter((stream) => String(stream.codec_type || '').toLowerCase() === 'audio')
      .map((stream, index) => {
        const meta = audioDisplayNameFromStream(stream, `Audio ${index + 1}`);
        return {
          id: `audio:${Number(stream.index || 0)}`,
          label: meta.label,
          short_label: meta.short_label,
          language: meta.language,
          stream_index: Number(stream.index || 0),
          codec_name: String(stream.codec_name || '').trim().toLowerCase(),
          channels: Number(stream.channels || 0),
          is_default: stream.disposition?.default === 1,
        };
      });
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
      await query(`
        CREATE TABLE IF NOT EXISTS video_catalog_items (
          id BIGSERIAL PRIMARY KEY,
          source_root_path TEXT NOT NULL,
          folder_relative_path TEXT NOT NULL,
          folder_name TEXT NOT NULL,
          display_title TEXT NOT NULL,
          media_type TEXT NOT NULL DEFAULT 'movie',
          release_year INTEGER NULL,
          synopsis TEXT NOT NULL DEFAULT '',
          poster_relative_path TEXT NOT NULL DEFAULT '',
          poster_url TEXT NOT NULL DEFAULT '',
          poster_exists BOOLEAN NOT NULL DEFAULT FALSE,
          genres JSONB NOT NULL DEFAULT '[]'::jsonb,
          cast_members JSONB NOT NULL DEFAULT '[]'::jsonb,
          creators JSONB NOT NULL DEFAULT '[]'::jsonb,
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          original_language TEXT NOT NULL DEFAULT '',
          country TEXT NOT NULL DEFAULT '',
          content_rating TEXT NOT NULL DEFAULT '',
          runtime_minutes INTEGER NULL,
          season_count INTEGER NULL,
          episode_count INTEGER NOT NULL DEFAULT 0,
          primary_video_relative_path TEXT NOT NULL DEFAULT '',
          file_count INTEGER NOT NULL DEFAULT 0,
          file_exists BOOLEAN NOT NULL DEFAULT TRUE,
          status TEXT NOT NULL DEFAULT 'scanned',
          ai_confidence INTEGER NOT NULL DEFAULT 0,
          ai_notes TEXT NOT NULL DEFAULT '',
          ai_raw JSONB NOT NULL DEFAULT '{}'::jsonb,
          search_text TEXT NOT NULL DEFAULT '',
          last_scanned_at TIMESTAMPTZ NULL,
          verified_at TIMESTAMPTZ NULL,
          verified_by BIGINT NULL,
          published_at TIMESTAMPTZ NULL,
          created_by BIGINT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_video_catalog_items_root_folder UNIQUE (source_root_path, folder_relative_path)
        )
      `);
      await query(`ALTER TABLE video_catalog_items ADD COLUMN IF NOT EXISTS poster_relative_path TEXT NOT NULL DEFAULT ''`);
      await query(`ALTER TABLE video_catalog_items ADD COLUMN IF NOT EXISTS poster_url TEXT NOT NULL DEFAULT ''`);
      await query(`ALTER TABLE video_catalog_items ADD COLUMN IF NOT EXISTS poster_exists BOOLEAN NOT NULL DEFAULT FALSE`);
      await query(`CREATE INDEX IF NOT EXISTS idx_video_catalog_items_status ON video_catalog_items(status)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_video_catalog_items_root_path ON video_catalog_items(source_root_path)`);
      await query(`
        CREATE TABLE IF NOT EXISTS video_catalog_files (
          id BIGSERIAL PRIMARY KEY,
          catalog_item_id BIGINT NOT NULL REFERENCES video_catalog_items(id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          folder_relative_path TEXT NOT NULL DEFAULT '',
          filename TEXT NOT NULL,
          extension TEXT NOT NULL DEFAULT '',
          size_bytes BIGINT NOT NULL DEFAULT 0,
          mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
          subtitles JSONB NOT NULL DEFAULT '[]'::jsonb,
          audio_tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
          series_title TEXT NOT NULL DEFAULT '',
          season_label TEXT NOT NULL DEFAULT '',
          season_number INTEGER NULL,
          episode_label TEXT NOT NULL DEFAULT '',
          episode_number INTEGER NULL,
          file_exists BOOLEAN NOT NULL DEFAULT TRUE,
          is_primary BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_video_catalog_files_item_path UNIQUE (catalog_item_id, relative_path)
        )
      `);
      await query(`ALTER TABLE video_catalog_files ADD COLUMN IF NOT EXISTS audio_tracks JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await query(`ALTER TABLE video_catalog_files ADD COLUMN IF NOT EXISTS series_title TEXT NOT NULL DEFAULT ''`);
      await query(`ALTER TABLE video_catalog_files ADD COLUMN IF NOT EXISTS season_label TEXT NOT NULL DEFAULT ''`);
      await query(`ALTER TABLE video_catalog_files ADD COLUMN IF NOT EXISTS season_number INTEGER NULL`);
      await query(`ALTER TABLE video_catalog_files ADD COLUMN IF NOT EXISTS episode_label TEXT NOT NULL DEFAULT ''`);
      await query(`ALTER TABLE video_catalog_files ADD COLUMN IF NOT EXISTS episode_number INTEGER NULL`);
      await query(`CREATE INDEX IF NOT EXISTS idx_video_catalog_files_item_id ON video_catalog_files(catalog_item_id)`);
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
  if (!relativePath) throw new Error('Video path is invalid');
  if (relativePath.includes('..')) throw new Error('Video path is invalid');
  const currentSeconds = roundNumber(payload.current_seconds || 0);
  const durationSeconds = roundNumber(payload.duration_seconds || 0);
  const safeDuration = durationSeconds > 0 ? durationSeconds : 0;
  const inferredPercent = safeDuration > 0 ? Math.min(100, Math.max(0, roundNumber((currentSeconds / safeDuration) * 100))) : 0;
  const isCompleted = !!payload.is_completed || (safeDuration > 0 && currentSeconds >= Math.max(safeDuration - 5, safeDuration * 0.98));
  const effectiveCurrent = isCompleted ? safeDuration : Math.max(0, currentSeconds);
  const progressPercent = isCompleted ? 100 : inferredPercent;
  const completedAt = isCompleted ? new Date().toISOString() : null;
  const preserveCompletedOnReset = !isCompleted && effectiveCurrent <= 5;
  const result = await query(
    `INSERT INTO video_watch_progress (
      user_id, relative_path, current_seconds, duration_seconds, progress_percent, is_completed, completed_at, last_watched_at, updated_at
     ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
     )
     ON CONFLICT (user_id, relative_path)
     DO UPDATE SET
       current_seconds = CASE
         WHEN video_watch_progress.is_completed = TRUE AND $8 = TRUE
           THEN video_watch_progress.current_seconds
         ELSE EXCLUDED.current_seconds
       END,
       duration_seconds = CASE
         WHEN video_watch_progress.is_completed = TRUE AND $8 = TRUE
           THEN GREATEST(video_watch_progress.duration_seconds, EXCLUDED.duration_seconds)
         ELSE EXCLUDED.duration_seconds
       END,
       progress_percent = CASE
         WHEN video_watch_progress.is_completed = TRUE AND $8 = TRUE
           THEN video_watch_progress.progress_percent
         ELSE EXCLUDED.progress_percent
       END,
       is_completed = CASE
         WHEN video_watch_progress.is_completed = TRUE AND $8 = TRUE
           THEN TRUE
         ELSE EXCLUDED.is_completed
       END,
       completed_at = CASE
         WHEN video_watch_progress.is_completed = TRUE AND $8 = TRUE
           THEN video_watch_progress.completed_at
         WHEN EXCLUDED.is_completed
           THEN EXCLUDED.completed_at
         ELSE NULL
       END,
       last_watched_at = NOW(),
       updated_at = NOW()
     RETURNING relative_path, current_seconds, duration_seconds, progress_percent, is_completed, completed_at, last_watched_at, updated_at`,
    [cleanUserId, relativePath, effectiveCurrent, safeDuration, progressPercent, isCompleted, completedAt, preserveCompletedOnReset]
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
    `INSERT INTO app_runtime_settings (setting_key, setting_value, updated_by)
     VALUES ($1, $2::jsonb, $3)
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
    const embeddedAudioTracks = await listEmbeddedAudioTracks(rootPath, normalizedRelativePath);
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
      audio_tracks: embeddedAudioTracks,
    });
  }

  return videos.sort((a, b) => {
    if (a.folder !== b.folder) return String(a.folder || '').localeCompare(String(b.folder || ''));
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function encodeCatalogFileToken(fileId) {
  return Buffer.from(JSON.stringify({
    type: 'catalog_file',
    file_id: Number(fileId || 0),
  }), 'utf8').toString('base64url');
}

function encodeCatalogSubtitleToken(rootPath, relativePath) {
  return Buffer.from(JSON.stringify({
    type: 'catalog_sidecar_subtitle',
    root_path: String(rootPath || ''),
    relative_path: String(relativePath || ''),
  }), 'utf8').toString('base64url');
}

function encodeCatalogEmbeddedSubtitleToken(rootPath, relativeVideoPath, streamIndex) {
  return Buffer.from(JSON.stringify({
    type: 'embedded_subtitle',
    root_path: String(rootPath || ''),
    video: String(relativeVideoPath || ''),
    stream_index: Number(streamIndex || 0),
  }), 'utf8').toString('base64url');
}

function encodeCatalogPosterToken(rootPath, relativePath) {
  return Buffer.from(JSON.stringify({
    type: 'catalog_poster',
    root_path: String(rootPath || ''),
    relative_path: String(relativePath || ''),
  }), 'utf8').toString('base64url');
}

function inferPosterExtensionFromUrl(url) {
  const cleanUrl = String(url || '').split('?')[0].split('#')[0];
  const ext = String(path.extname(cleanUrl) || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return '';
}

function inferPosterExtensionFromContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('image/png')) return '.png';
  if (type.includes('image/webp')) return '.webp';
  if (type.includes('image/jpeg') || type.includes('image/jpg')) return '.jpg';
  return '';
}

function sanitizeCatalogPosterRelativePath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function sanitizeCatalogPosterUrlForClient(url) {
  const raw = String(url || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  if (/\s/.test(raw)) return '';
  if (/m\.media-amazon\.com/i.test(raw)) return '';
  if (/\.(jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(raw)) return raw;
  if (/(image\.tmdb\.org|upload\.wikimedia\.org|static\.tvmaze\.com)/i.test(raw)) return raw;
  return '';
}

async function downloadCatalogPosterToLocal(rootPath, folderRelativePath, posterUrl) {
  const resolvedRootPath = resolveVideoRootPathForRuntime(rootPath);
  const normalizedFolder = sanitizeCatalogPosterRelativePath(folderRelativePath);
  const targetDir = path.resolve(resolvedRootPath, normalizedFolder);
  if (!isPathInsideRoot(resolvedRootPath, targetDir)) {
    throw new Error('Poster target folder is outside the library root.');
  }
  await fs.promises.mkdir(targetDir, { recursive: true });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(String(posterUrl || ''), {
      signal: controller.signal,
      headers: {
        'user-agent': 'ExpenseManager Video Catalog Poster Fetcher',
        'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    if (!response.ok) {
      throw new Error(`Poster request failed with status ${response.status}`);
    }
    const contentType = String(response.headers.get('content-type') || '');
    if (!/^image\//i.test(contentType)) {
      throw new Error('Poster response was not an image.');
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      throw new Error('Poster image was empty.');
    }
    const extension = inferPosterExtensionFromContentType(contentType) || inferPosterExtensionFromUrl(posterUrl) || '.jpg';
    const filename = `poster-ai${extension}`;
    const absolutePath = path.resolve(targetDir, filename);
    if (!isPathInsideRoot(resolvedRootPath, absolutePath)) {
      throw new Error('Poster target path is outside the library root.');
    }
    await fs.promises.writeFile(absolutePath, buffer);
    return sanitizeCatalogPosterRelativePath(path.posix.join(normalizedFolder, filename));
  } finally {
    clearTimeout(timeout);
  }
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function normalizeTextArray(value, limit = 24) {
  return safeJsonArray(value)
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function buildCatalogSearchText(item = {}) {
  return [
    item.display_title,
    item.folder_name,
    item.media_type,
    ...(normalizeTextArray(item.genres)),
    ...(normalizeTextArray(item.cast_members)),
    ...(normalizeTextArray(item.creators)),
    ...(normalizeTextArray(item.tags)),
    item.original_language,
    item.country,
    item.content_rating,
    item.synopsis,
    item.series_title,
    item.poster_url,
  ].filter(Boolean).join(' ').toLowerCase();
}

function cleanCatalogLabel(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSeriesEpisodeMeta(relativePath, folderName, displayTitle) {
  const filename = path.basename(String(relativePath || ''));
  const label = cleanCatalogLabel(filename);
  const folderLabel = cleanCatalogLabel(folderName || displayTitle || '');
  const patterns = [
    /s(\d{1,2})\s*e(\d{1,3})/i,
    /(\d{1,2})x(\d{1,3})/i,
    /season\s*(\d{1,2}).{0,20}?episode\s*(\d{1,3})/i,
  ];
  for (const pattern of patterns) {
    const match = label.match(pattern);
    if (match) {
      const seasonNumber = Number(match[1]);
      const episodeNumber = Number(match[2]);
      const episodeSuffix = label
        .replace(pattern, '')
        .replace(/^[\s\-_:]+/, '')
        .trim();
      return {
        series_title: folderLabel || cleanCatalogLabel(displayTitle),
        season_number: Number.isFinite(seasonNumber) ? seasonNumber : null,
        season_label: Number.isFinite(seasonNumber) ? `Season ${seasonNumber}` : '',
        episode_number: Number.isFinite(episodeNumber) ? episodeNumber : null,
        episode_label: episodeSuffix || `Episode ${episodeNumber}`,
      };
    }
  }
  const nestedFolder = String(relativePath || '').split('/')[1] || '';
  const seasonMatch = cleanCatalogLabel(nestedFolder).match(/season\s*(\d{1,2})/i);
  const seasonNumber = seasonMatch ? Number(seasonMatch[1]) : 1;
  return {
    series_title: folderLabel || cleanCatalogLabel(displayTitle),
    season_number: seasonNumber,
    season_label: `Season ${seasonNumber}`,
    episode_number: null,
    episode_label: label,
  };
}

async function findCatalogPosterForGroup(rootPath, group = {}) {
  const folderRelativePath = String(
    group.poster_search_relative_path != null
      ? group.poster_search_relative_path
      : (group.folder_relative_path || '')
  ).trim();
  const folderAbsolutePath = folderRelativePath
    ? path.join(rootPath, folderRelativePath.replace(/\//g, path.sep))
    : rootPath;
  const candidates = [];
  const displayBase = cleanCatalogLabel(group.display_title || group.folder_name || '');
  const primaryBase = cleanCatalogLabel(path.basename(String(group.primary_video_relative_path || '')));
  ['poster', 'folder', 'cover', 'thumb', displayBase, primaryBase]
    .filter(Boolean)
    .forEach((base) => {
      ['.jpg', '.jpeg', '.png', '.webp'].forEach((ext) => candidates.push(`${base}${ext}`));
    });
  try {
    const entries = await fs.promises.readdir(folderAbsolutePath, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const lowered = new Map(files.map((name) => [name.toLowerCase(), name]));
    for (const candidate of candidates) {
      const actual = lowered.get(candidate.toLowerCase());
      if (actual) {
        return folderRelativePath ? path.join(folderRelativePath, actual).split(path.sep).join('/') : actual;
      }
    }
  } catch (_err) {}
  return '';
}

function detectSeriesHints(folderName, files = []) {
  const text = [folderName, ...files.map((file) => `${file.filename} ${file.relative_path}`)].join(' ').toLowerCase();
  if (/\bs\d{1,2}\s*e\d{1,2}\b/.test(text)) return true;
  if (/\bseason\b/.test(text) || /\bepisode\b/.test(text)) return true;
  const childSegments = new Set();
  files.forEach((file) => {
    const parts = String(file.relative_path || '').split('/');
    if (parts.length > 2) childSegments.add(parts[1]);
  });
  return childSegments.size > 1 || files.length > 3;
}

function catalogItemHasExplicitSeriesHints(item = {}, files = []) {
  const text = [
    item?.display_title,
    item?.folder_name,
    item?.folder_relative_path,
    item?.search_text,
    ...files.map((file) => [
      file?.filename,
      file?.relative_path,
      file?.series_title,
      file?.season_label,
      file?.episode_label,
    ].join(' ')),
  ].join(' ');
  return /\bs\d{1,2}\s*e\d{1,3}\b/i.test(text)
    || /\b\d{1,2}x\d{1,3}\b/i.test(text)
    || /\bseason\s*\d{1,2}\b/i.test(text)
    || /\bepisode\s*\d{1,3}\b/i.test(text);
}

function catalogItemShouldBeSeries(item = {}, files = []) {
  if (String(item?.media_type || 'movie') !== 'series') return false;
  if (Number(item?.season_count || 0) > 1) return true;
  if (Number(item?.episode_count || 0) > 1) return true;
  if (
    Number(item?.season_count || 0) === 1
    && Number(item?.episode_count || 0) > 0
    && catalogItemHasExplicitSeriesHints(item, files)
  ) {
    return true;
  }
  return catalogItemHasExplicitSeriesHints(item, files);
}

function parseYearFromLabel(label) {
  const match = String(label || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function pickPrimaryVideo(files = [], mediaType = 'movie') {
  if (!files.length) return null;
  if (mediaType === 'series') {
    return [...files].sort((a, b) => String(a.relative_path || '').localeCompare(String(b.relative_path || '')))[0];
  }
  return [...files].sort((a, b) => {
    const bySize = Number(b.size_bytes || 0) - Number(a.size_bytes || 0);
    if (bySize) return bySize;
    return String(a.relative_path || '').localeCompare(String(b.relative_path || ''));
  })[0];
}

function catalogFileLooksMultiAudio(file = {}) {
  const text = [
    file?.filename,
    file?.relative_path,
    file?.series_title,
    file?.episode_label,
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(?:dual\s*audio|multi\s*audio|multi-audio|hindi|english|tamil|telugu|malayalam|kannada)\b/.test(text);
}

function buildCatalogDraftGroups(videos = []) {
  return videos.map((video) => {
    const folderRelativePath = String(video.folder || '').trim();
    const folderName = cleanCatalogLabel(folderRelativePath.split('/').filter(Boolean).pop() || '');
    const guessedTitle = prettyVideoTitle(video.filename);
    const isSeries = detectSeriesHints(`${folderName} ${video.filename}`, [video]);
    const episodeMeta = isSeries
      ? parseSeriesEpisodeMeta(video.relative_path, folderName || guessedTitle, folderName || guessedTitle)
      : null;
    const displayTitle = isSeries
      ? (episodeMeta?.series_title || folderName || guessedTitle)
      : guessedTitle;
    return {
      group_key: String(video.relative_path || ''),
      folder_relative_path: String(video.relative_path || ''),
      poster_search_relative_path: folderRelativePath,
      folder_name: folderName || guessedTitle,
      display_title: displayTitle,
      media_type: isSeries ? 'series' : 'movie',
      release_year: parseYearFromLabel(`${folderName} ${video.filename}`),
      poster_relative_path: '',
      primary_video_relative_path: String(video.relative_path || ''),
      file_count: 1,
      episode_count: isSeries ? 1 : null,
      season_count: isSeries && Number.isFinite(Number(episodeMeta?.season_number)) ? 1 : null,
      file_exists: true,
      files: [video],
      episode_meta: episodeMeta,
    };
  }).sort((a, b) => {
    const titleCompare = String(a.display_title || '').localeCompare(String(b.display_title || ''));
    if (titleCompare) return titleCompare;
    return String(a.primary_video_relative_path || '').localeCompare(String(b.primary_video_relative_path || ''));
  });
}

async function scanVideoCatalogPath(scanPath, userId = null) {
  await ensureVideoTables();
  const resolvedRootPath = resolveVideoRootPathForRuntime(normalizeVideoRootPath(scanPath));
  const stats = await fs.promises.stat(resolvedRootPath);
  if (!stats.isDirectory()) {
    throw new Error('The scan path is not a folder.');
  }

  const settings = await getVideoLibrarySettings();
  const videos = await scanVideoDirectory(resolvedRootPath, {
    recursive: settings.recursive_scan,
    allowed_extensions: settings.allowed_extensions,
  });
  const groups = buildCatalogDraftGroups(videos);
  for (const group of groups) {
    group.poster_relative_path = await findCatalogPosterForGroup(resolvedRootPath, group);
  }

  const result = await withTransaction(async (client) => {
    const scannedFolders = new Set();
    const itemIds = [];

    for (const group of groups) {
      scannedFolders.add(String(group.folder_relative_path || ''));
      const now = new Date().toISOString();
      const upsert = await client.query(
        `INSERT INTO video_catalog_items (
           source_root_path, folder_relative_path, folder_name, display_title, media_type, release_year,
           poster_relative_path, poster_url, poster_exists,
           primary_video_relative_path, file_count, episode_count, season_count, file_exists, status,
           search_text, last_scanned_at, updated_at, created_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,'',$8,
           $9,$10,$11,$12,TRUE,
           CASE WHEN $13 THEN '${VIDEO_CATALOG_STATUSES.PUBLISHED}' ELSE '${VIDEO_CATALOG_STATUSES.SCANNED}' END,
           $14,$15,$15,$16
         )
         ON CONFLICT (source_root_path, folder_relative_path)
         DO UPDATE SET
           folder_name = EXCLUDED.folder_name,
           display_title = EXCLUDED.display_title,
           media_type = EXCLUDED.media_type,
           release_year = COALESCE(video_catalog_items.release_year, EXCLUDED.release_year),
           poster_relative_path = CASE
             WHEN EXCLUDED.poster_relative_path <> '' THEN EXCLUDED.poster_relative_path
             ELSE video_catalog_items.poster_relative_path
           END,
           poster_exists = CASE
             WHEN EXCLUDED.poster_relative_path <> '' THEN TRUE
             WHEN video_catalog_items.poster_url <> '' THEN video_catalog_items.poster_exists
             ELSE FALSE
           END,
           primary_video_relative_path = EXCLUDED.primary_video_relative_path,
           file_count = EXCLUDED.file_count,
           episode_count = EXCLUDED.episode_count,
           season_count = EXCLUDED.season_count,
           file_exists = TRUE,
           last_scanned_at = EXCLUDED.last_scanned_at,
           updated_at = EXCLUDED.updated_at,
           status = CASE
             WHEN video_catalog_items.status = '${VIDEO_CATALOG_STATUSES.PUBLISHED}' THEN video_catalog_items.status
             WHEN video_catalog_items.status = '${VIDEO_CATALOG_STATUSES.REVIEW}' THEN video_catalog_items.status
             ELSE '${VIDEO_CATALOG_STATUSES.SCANNED}'
           END
         RETURNING id, status`,
        [
          resolvedRootPath,
          String(group.folder_relative_path || ''),
          String(group.folder_name || ''),
          String(group.display_title || ''),
          String(group.media_type || 'movie'),
          group.release_year,
          String(group.poster_relative_path || ''),
          !!group.poster_relative_path,
          String(group.primary_video_relative_path || ''),
          Number(group.file_count || 0),
          Number(group.episode_count || 0),
          group.season_count,
          false,
          buildCatalogSearchText(group),
          now,
          userId ? Number(userId) : null,
        ]
      );
      const item = upsert.rows[0];
      itemIds.push(Number(item.id));

        await client.query(`UPDATE video_catalog_files SET file_exists = FALSE, updated_at = NOW() WHERE catalog_item_id = $1`, [item.id]);
        for (const file of group.files) {
          const episodeMeta = group.media_type === 'series'
            ? (group.episode_meta || parseSeriesEpisodeMeta(file.relative_path, group.folder_name, group.display_title))
            : { series_title: '', season_label: '', season_number: null, episode_label: '', episode_number: null };
        await client.query(
          `INSERT INTO video_catalog_files (
             catalog_item_id, relative_path, folder_relative_path, filename, extension, size_bytes, mime_type, subtitles, audio_tracks,
             series_title, season_label, season_number, episode_label, episode_number,
             file_exists, is_primary, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,TRUE,$15,NOW(),NOW()
           )
           ON CONFLICT (catalog_item_id, relative_path)
           DO UPDATE SET
             folder_relative_path = EXCLUDED.folder_relative_path,
             filename = EXCLUDED.filename,
             extension = EXCLUDED.extension,
             size_bytes = EXCLUDED.size_bytes,
             updated_at = EXCLUDED.updated_at,
             mime_type = EXCLUDED.mime_type,
             subtitles = EXCLUDED.subtitles,
             audio_tracks = EXCLUDED.audio_tracks,
             series_title = EXCLUDED.series_title,
             season_label = EXCLUDED.season_label,
             season_number = EXCLUDED.season_number,
             episode_label = EXCLUDED.episode_label,
             episode_number = EXCLUDED.episode_number,
             file_exists = TRUE,
             is_primary = EXCLUDED.is_primary`,
          [
            item.id,
            String(file.relative_path || ''),
            String(file.folder || ''),
            String(file.filename || ''),
            String(file.extension || ''),
            Number(file.size_bytes || 0),
            String(file.mime_type || 'application/octet-stream'),
            JSON.stringify(Array.isArray(file.subtitles) ? file.subtitles : []),
            JSON.stringify(Array.isArray(file.audio_tracks) ? file.audio_tracks : []),
            String(episodeMeta.series_title || ''),
            String(episodeMeta.season_label || ''),
            episodeMeta.season_number,
            String(episodeMeta.episode_label || ''),
            episodeMeta.episode_number,
            String(file.relative_path || '') === String(group.primary_video_relative_path || ''),
          ]
        );
      }
    }

    await client.query(
      `UPDATE video_catalog_items
          SET file_exists = FALSE,
              updated_at = NOW()
        WHERE source_root_path = $1
          AND folder_relative_path <> ALL($2::text[])
      `,
      [resolvedRootPath, [...scannedFolders]]
    );

    return { itemIds };
  });

  return {
    root_path: resolvedRootPath,
    scanned_count: groups.length,
    file_count: videos.length,
    item_ids: result.itemIds,
  };
}

async function listVideoCatalogItems(options = {}) {
  await ensureVideoTables();
  const status = String(options.status || 'all').trim().toLowerCase();
  const rootPath = options.root_path
    ? normalizeResolvedPath(resolveVideoRootPathForRuntime(normalizeVideoRootPath(options.root_path))).toLowerCase()
    : null;
  const clauses = [];
  const params = [];
  if (status && status !== 'all') {
    params.push(status);
    clauses.push(`i.status = $${params.length}`);
  }
  if (rootPath) {
    params.push(rootPath);
    clauses.push(`LOWER(i.source_root_path) = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `SELECT
       i.*,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', f.id,
             'relative_path', f.relative_path,
             'folder_relative_path', f.folder_relative_path,
             'filename', f.filename,
             'extension', f.extension,
             'size_bytes', f.size_bytes,
             'updated_at', f.updated_at,
             'mime_type', f.mime_type,
             'subtitles', f.subtitles,
             'audio_tracks', f.audio_tracks,
             'series_title', f.series_title,
             'season_label', f.season_label,
             'season_number', f.season_number,
             'episode_label', f.episode_label,
             'episode_number', f.episode_number,
             'file_exists', f.file_exists,
             'is_primary', f.is_primary
           )
           ORDER BY f.is_primary DESC, f.relative_path ASC
         ) FILTER (WHERE f.id IS NOT NULL),
         '[]'::jsonb
       ) AS files
     FROM video_catalog_items i
     LEFT JOIN video_catalog_files f ON f.catalog_item_id = i.id
     ${where}
     GROUP BY i.id
     ORDER BY i.display_title ASC`,
    params
  );
  return rows.rows.map((row) => ({
    ...row,
    genres: normalizeTextArray(row.genres),
    cast_members: normalizeTextArray(row.cast_members),
    creators: normalizeTextArray(row.creators),
    tags: normalizeTextArray(row.tags),
    poster_url: '',
    files: safeJsonArray(row.files),
  }));
}

async function clearVideoCatalog(rootPath = '') {
  await ensureVideoTables();
  const normalizedRootPath = String(rootPath || '').trim();
  const resolvedRootPath = normalizedRootPath
    ? normalizeResolvedPath(resolveVideoRootPathForRuntime(normalizeVideoRootPath(normalizedRootPath)))
    : '';
  return withTransaction(async (client) => {
    const result = resolvedRootPath
      ? await client.query(
          `DELETE FROM video_catalog_items
            WHERE LOWER(source_root_path) = LOWER($1)
        RETURNING id`,
          [resolvedRootPath]
        )
      : await client.query(
          `DELETE FROM video_catalog_items
        RETURNING id`
        );
    return {
      cleared_count: Number(result.rowCount || 0),
      root_path: resolvedRootPath,
    };
  });
}

async function saveVideoCatalogAiMetadata(itemId, metadata = {}, userId = null) {
  await ensureVideoTables();
  const normalized = {
    display_title: String(metadata.display_title || metadata.canonical_title || '').trim(),
    media_type: ['movie', 'series'].includes(String(metadata.media_type || '').trim().toLowerCase())
      ? String(metadata.media_type || '').trim().toLowerCase()
      : 'movie',
    release_year: Number.isInteger(Number(metadata.release_year)) ? Number(metadata.release_year) : null,
    synopsis: String(metadata.synopsis || '').trim(),
    genres: normalizeTextArray(metadata.genres, 12),
    cast_members: normalizeTextArray(metadata.cast_members, 24),
    creators: normalizeTextArray(metadata.creators, 16),
    tags: normalizeTextArray(metadata.tags || metadata.keywords, 24),
    original_language: String(metadata.original_language || metadata.language || '').trim(),
    country: String(metadata.country || '').trim(),
    content_rating: String(metadata.content_rating || metadata.rating || '').trim(),
    poster_url: String(metadata.poster_url || '').trim(),
    runtime_minutes: Number.isFinite(Number(metadata.runtime_minutes)) ? Math.round(Number(metadata.runtime_minutes)) : null,
    season_count: Number.isFinite(Number(metadata.season_count)) ? Math.max(1, Math.round(Number(metadata.season_count))) : null,
    episode_count: Number.isFinite(Number(metadata.episode_count)) ? Math.max(0, Math.round(Number(metadata.episode_count))) : 0,
    ai_confidence: Number.isFinite(Number(metadata.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(metadata.confidence)))) : 0,
    ai_notes: String(metadata.note || metadata.ai_notes || '').trim(),
    ai_raw: metadata,
  };
  const currentRows = await query(
    `SELECT id, source_root_path, folder_relative_path, poster_relative_path, poster_url
       FROM video_catalog_items
      WHERE id = $1
      LIMIT 1`,
    [Number(itemId)]
  );
  const current = currentRows.rows[0] || null;
  if (!current) throw new Error('Catalog item not found');
  if (!normalized.poster_url && current.poster_url) {
    normalized.poster_url = String(current.poster_url || '').trim();
  }
  normalized.poster_relative_path = String(current.poster_relative_path || '').trim();
  if (normalized.poster_url && !normalized.poster_relative_path) {
    try {
      normalized.poster_relative_path = await downloadCatalogPosterToLocal(
        current.source_root_path,
        current.folder_relative_path,
        normalized.poster_url
      );
    } catch (_err) {
      normalized.poster_relative_path = '';
      normalized.poster_url = '';
    }
  }
  normalized.search_text = buildCatalogSearchText(normalized);
  const rows = await query(
    `UPDATE video_catalog_items
        SET display_title = COALESCE(NULLIF($2, ''), display_title),
            media_type = COALESCE(NULLIF($3, ''), media_type),
            release_year = COALESCE($4, release_year),
            synopsis = $5,
            genres = $6::jsonb,
            cast_members = $7::jsonb,
            creators = $8::jsonb,
            tags = $9::jsonb,
            original_language = $10,
            country = $11,
            content_rating = $12,
            poster_url = CASE WHEN $13 <> '' THEN $13 ELSE poster_url END,
            poster_relative_path = CASE WHEN $14 <> '' THEN $14 ELSE poster_relative_path END,
            poster_exists = CASE WHEN $13 <> '' OR $14 <> '' THEN TRUE ELSE poster_exists END,
            runtime_minutes = COALESCE($15, runtime_minutes),
            season_count = COALESCE($16, season_count),
            episode_count = CASE WHEN $17 > 0 THEN $17 ELSE episode_count END,
            ai_confidence = $18,
            ai_notes = $19,
            ai_raw = $20::jsonb,
            search_text = $21,
            status = '${VIDEO_CATALOG_STATUSES.REVIEW}',
            verified_by = $22,
            verified_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING id`,
    [
      Number(itemId),
      normalized.display_title,
      normalized.media_type,
      normalized.release_year,
      normalized.synopsis,
      JSON.stringify(normalized.genres),
      JSON.stringify(normalized.cast_members),
      JSON.stringify(normalized.creators),
      JSON.stringify(normalized.tags),
      normalized.original_language,
      normalized.country,
      normalized.content_rating,
      normalized.poster_url,
      normalized.poster_relative_path,
      normalized.runtime_minutes,
      normalized.season_count,
      normalized.episode_count,
      normalized.ai_confidence,
      normalized.ai_notes,
      JSON.stringify(normalized.ai_raw || {}),
      normalized.search_text,
      userId ? Number(userId) : null,
    ]
  );
  return rows.rows[0] || null;
}

async function publishVideoCatalogItems(itemIds = [], userId = null) {
  await ensureVideoTables();
  const normalizedIds = [...new Set((Array.isArray(itemIds) ? itemIds : []).map((itemId) => Number(itemId)).filter((itemId) => Number.isFinite(itemId) && itemId > 0))];
  if (!normalizedIds.length) return { published_count: 0 };
  const rows = await query(
    `UPDATE video_catalog_items
        SET status = '${VIDEO_CATALOG_STATUSES.PUBLISHED}',
            published_at = NOW(),
            verified_at = NOW(),
            verified_by = $2,
            updated_at = NOW()
      WHERE id = ANY($1::bigint[])
      RETURNING id`,
    [normalizedIds, userId ? Number(userId) : null]
  );
  return { published_count: rows.rowCount || 0 };
}

async function updateVideoCatalogItem(itemId, payload = {}, userId = null) {
  await ensureVideoTables();
  const currentItems = await listVideoCatalogItems({ status: 'all' });
  const current = currentItems.find((item) => Number(item.id || 0) === Number(itemId || 0));
  if (!current) throw new Error('Catalog item not found');

  const normalized = {
    display_title: String(payload.display_title ?? current.display_title ?? '').trim() || String(current.display_title || '').trim(),
    media_type: ['movie', 'series'].includes(String(payload.media_type || current.media_type || '').trim().toLowerCase())
      ? String(payload.media_type || current.media_type || '').trim().toLowerCase()
      : 'movie',
    release_year: payload.release_year === '' || payload.release_year == null
      ? null
      : (Number.isFinite(Number(payload.release_year)) ? Number(payload.release_year) : null),
    synopsis: String(payload.synopsis ?? current.synopsis ?? '').trim(),
    genres: normalizeTextArray(Array.isArray(payload.genres) ? payload.genres : String(payload.genres ?? (current.genres || []).join(',')).split(','), 12),
    cast_members: normalizeTextArray(Array.isArray(payload.cast_members) ? payload.cast_members : String(payload.cast_members ?? (current.cast_members || []).join(',')).split(','), 24),
    creators: normalizeTextArray(Array.isArray(payload.creators) ? payload.creators : String(payload.creators ?? (current.creators || []).join(',')).split(','), 16),
    tags: normalizeTextArray(Array.isArray(payload.tags) ? payload.tags : String(payload.tags ?? (current.tags || []).join(',')).split(','), 24),
    original_language: String(payload.original_language ?? current.original_language ?? '').trim(),
    country: String(payload.country ?? current.country ?? '').trim(),
    content_rating: String(payload.content_rating ?? current.content_rating ?? '').trim(),
    poster_url: String(payload.poster_url ?? current.poster_url ?? '').trim(),
    poster_relative_path: String(payload.poster_relative_path ?? current.poster_relative_path ?? '').trim(),
    runtime_minutes: payload.runtime_minutes === '' || payload.runtime_minutes == null
      ? null
      : (Number.isFinite(Number(payload.runtime_minutes)) ? Math.round(Number(payload.runtime_minutes)) : null),
    season_count: payload.season_count === '' || payload.season_count == null
      ? null
      : (Number.isFinite(Number(payload.season_count)) ? Math.max(1, Math.round(Number(payload.season_count))) : null),
    episode_count: payload.episode_count === '' || payload.episode_count == null
      ? Number(current.episode_count || 0)
      : (Number.isFinite(Number(payload.episode_count)) ? Math.max(0, Math.round(Number(payload.episode_count))) : Number(current.episode_count || 0)),
    ai_confidence: payload.ai_confidence === '' || payload.ai_confidence == null
      ? Number(current.ai_confidence || 0)
      : (Number.isFinite(Number(payload.ai_confidence)) ? Math.max(0, Math.min(100, Math.round(Number(payload.ai_confidence)))) : Number(current.ai_confidence || 0)),
    ai_notes: String(payload.ai_notes ?? current.ai_notes ?? '').trim(),
  };
  normalized.poster_exists = !!(normalized.poster_url || normalized.poster_relative_path);
  normalized.search_text = buildCatalogSearchText(normalized);

  const rows = await query(
    `UPDATE video_catalog_items
        SET display_title = $2,
            media_type = $3,
            release_year = $4,
            synopsis = $5,
            genres = $6::jsonb,
            cast_members = $7::jsonb,
            creators = $8::jsonb,
            tags = $9::jsonb,
            original_language = $10,
            country = $11,
            content_rating = $12,
            poster_url = $13,
            poster_relative_path = $14,
            poster_exists = $15,
            runtime_minutes = $16,
            season_count = $17,
            episode_count = $18,
            ai_confidence = $19,
            ai_notes = $20,
            search_text = $21,
            status = '${VIDEO_CATALOG_STATUSES.REVIEW}',
            verified_by = $22,
            verified_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING id`,
    [
      Number(itemId || 0),
      normalized.display_title,
      normalized.media_type,
      normalized.release_year,
      normalized.synopsis,
      JSON.stringify(normalized.genres),
      JSON.stringify(normalized.cast_members),
      JSON.stringify(normalized.creators),
      JSON.stringify(normalized.tags),
      normalized.original_language,
      normalized.country,
      normalized.content_rating,
      normalized.poster_url,
      normalized.poster_relative_path,
      normalized.poster_exists,
      normalized.runtime_minutes,
      normalized.season_count,
      normalized.episode_count,
      normalized.ai_confidence,
      normalized.ai_notes,
      normalized.search_text,
      userId ? Number(userId) : null,
    ]
  );
  return rows.rows[0] || null;
}

async function listVideoLibrary(userId = null) {
  await ensureVideoTables();
  const settings = await getVideoLibrarySettings();
  const publishedItems = await listVideoCatalogItems({
    status: VIDEO_CATALOG_STATUSES.PUBLISHED,
    root_path: settings.videos_root_path || '',
  });
  const repairIds = [];
  publishedItems.forEach((item) => {
    const files = safeJsonArray(item.files);
    if (String(item?.media_type || 'movie') === 'series' && !catalogItemShouldBeSeries(item, files)) {
      item.media_type = 'movie';
      item.season_count = null;
      item.episode_count = 0;
      repairIds.push(Number(item.id || 0));
    }
  });
  if (repairIds.length) {
    await query(
      `UPDATE video_catalog_items
          SET media_type = 'movie',
              season_count = NULL,
              episode_count = 0,
              updated_at = NOW()
        WHERE id = ANY($1::bigint[])`,
      [repairIds.filter((id) => Number.isFinite(id) && id > 0)]
    );
  }
  if (!publishedItems.length) {
    return {
      configured: true,
      settings,
      root_exists: true,
      videos: [],
      subtitle_engine: await getMediaToolsStatus(),
      message: 'No published movies or series are available yet. Scan a folder, fetch AI metadata, and publish verified entries first.',
    };
  }

  const allFiles = publishedItems.flatMap((item) => safeJsonArray(item.files).map((file) => ({ item, file })));
  const progressKeys = allFiles.map(({ file }) => `catalog:${Number(file.id || 0)}`);
  const progressMap = await getVideoWatchProgressMap(userId, progressKeys);
  const subtitle_engine = await getMediaToolsStatus();
  const videos = (await Promise.all(allFiles.map(async ({ item, file }) => {
    const subtitles = safeJsonArray(file.subtitles).map((subtitle) => {
      if (subtitle?.type === 'embedded_subtitle') {
        return {
          ...subtitle,
          id: encodeCatalogEmbeddedSubtitleToken(item.source_root_path, file.relative_path, subtitle.stream_index),
        };
      }
      return {
        ...subtitle,
        id: encodeCatalogSubtitleToken(item.source_root_path, subtitle.relative_path),
      };
    });
      const storedAudioTracks = safeJsonArray(file.audio_tracks);
      const fallbackAudioTracks = (!storedAudioTracks.length && file.file_exists && catalogFileLooksMultiAudio(file))
        ? await listEmbeddedAudioTracks(resolveVideoRootPathForRuntime(item.source_root_path), file.relative_path)
        : [];
      const audioTracks = (storedAudioTracks.length ? storedAudioTracks : fallbackAudioTracks).map((track) => ({
        id: String(track.id || `audio:${Number(track.stream_index || 0)}`),
        label: String(track.label || track.short_label || 'Audio').trim() || 'Audio',
        short_label: String(track.short_label || track.label || 'Audio').trim() || 'Audio',
        language: String(track.language || 'und').trim() || 'und',
        stream_index: Number(track.stream_index || 0),
        codec_name: String(track.codec_name || '').trim().toLowerCase(),
        channels: Number(track.channels || 0),
        is_default: !!track.is_default,
      }));
      const defaultAudioTrack = audioTracks.find((track) => track.is_default) || audioTracks[0] || null;
      const progressKey = `catalog:${Number(file.id || 0)}`;
      const effectiveMediaType = catalogItemShouldBeSeries(item, [file]) ? 'series' : 'movie';
      return {
        id: encodeCatalogFileToken(file.id),
        progress_key: progressKey,
        title: effectiveMediaType === 'series'
          ? (file.episode_label || prettyVideoTitle(file.filename))
          : item.display_title,
      catalog_title: item.display_title,
      filename: file.filename,
      folder: item.folder_name || item.folder_relative_path || 'Root',
      relative_path: file.relative_path,
      extension: file.extension,
      size_bytes: Number(file.size_bytes || 0),
      size_mb: roundNumber((Number(file.size_bytes || 0) || 0) / (1024 * 1024)),
      updated_at: file.updated_at,
      mime_type: file.mime_type,
      direct_play_supported: videoDirectPlaySupported(file.relative_path, file.mime_type, audioTracks),
      subtitles,
      audio_tracks: audioTracks,
      default_audio_track_id: defaultAudioTrack?.id || '',
      available: !!file.file_exists,
      stream_url: file.file_exists ? `/api/videos/stream/${encodeURIComponent(encodeCatalogFileToken(file.id))}` : '',
      hls_url: file.file_exists ? `/api/videos/hls/${encodeURIComponent(encodeCatalogFileToken(file.id))}/master.m3u8` : '',
      progress: progressMap.get(progressKey) || null,
      media_type: effectiveMediaType,
      release_year: item.release_year,
      genres: normalizeTextArray(item.genres),
      synopsis: item.synopsis || '',
      cast_members: normalizeTextArray(item.cast_members),
      creators: normalizeTextArray(item.creators),
      tags: normalizeTextArray(item.tags),
      original_language: item.original_language || '',
      country: item.country || '',
      content_rating: item.content_rating || '',
      runtime_minutes: item.runtime_minutes,
      ai_confidence: Number(item.ai_confidence || 0),
      item_status: item.status,
      item_id: Number(item.id || 0),
      file_count: Number(item.file_count || 0),
      episode_count: Number(item.episode_count || 0),
      season_count: item.season_count,
      poster_relative_path: item.poster_relative_path || '',
      poster_url: '',
      poster_exists: !!item.poster_exists,
      poster_stream_url: item.poster_relative_path ? `/api/videos/poster/${encodeURIComponent(encodeCatalogPosterToken(item.source_root_path, item.poster_relative_path))}` : '',
      series_title: file.series_title || item.display_title,
      season_label: file.season_label || '',
      season_number: file.season_number,
      episode_label: file.episode_label || '',
      episode_number: file.episode_number,
    };
  }))).sort((a, b) => {
    if (a.folder !== b.folder) return String(a.folder || '').localeCompare(String(b.folder || ''));
    if (a.catalog_title !== b.catalog_title) return String(a.catalog_title || '').localeCompare(String(b.catalog_title || ''));
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  return {
    configured: true,
    settings,
    root_exists: true,
    videos,
    subtitle_engine,
    message: videos.length ? '' : 'No published video files are available right now.',
  };
}

async function resolveVideoStreamTarget(token) {
  await ensureVideoTables();
  const structured = decodeStructuredToken(token);
  if (structured?.type === 'catalog_file') {
    const fileId = Number(structured.file_id || 0);
    if (!(fileId > 0)) return null;
    const rows = await query(
      `SELECT
         i.source_root_path,
         f.relative_path,
         f.filename,
         f.mime_type
       FROM video_catalog_files f
       JOIN video_catalog_items i ON i.id = f.catalog_item_id
       WHERE f.id = $1`,
      [fileId]
    );
    const file = rows.rows[0];
    if (!file) return null;
    const resolvedRootPath = resolveVideoRootPathForRuntime(file.source_root_path);
    const absolutePath = path.resolve(resolvedRootPath, String(file.relative_path || ''));
    if (!isPathInsideRoot(resolvedRootPath, absolutePath)) return null;
    try {
      const stats = await fs.promises.stat(absolutePath);
      if (!stats.isFile()) return null;
      return {
        source_root_path: resolvedRootPath,
        relative_path: String(file.relative_path || ''),
        absolute_path: absolutePath,
        stats,
        filename: file.filename || path.basename(absolutePath),
        title: prettyVideoTitle(file.filename || path.basename(absolutePath)),
        mime_type: file.mime_type || videoMimeType(absolutePath),
        audio_tracks: await listEmbeddedAudioTracks(resolvedRootPath, String(file.relative_path || '')),
      };
    } catch (_err) {
      return null;
    }
  }

  const settings = await getVideoLibrarySettings();
  if (!settings.videos_root_path) return null;
  const relativePath = decodeVideoToken(token).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) return null;
  const resolvedRootPath = resolveVideoRootPathForRuntime(settings.videos_root_path);
  const absolutePath = path.resolve(resolvedRootPath, relativePath);
  if (!isPathInsideRoot(resolvedRootPath, absolutePath)) return null;
  try {
    const stats = await fs.promises.stat(absolutePath);
    if (!stats.isFile()) return null;
    return {
      settings,
      source_root_path: resolvedRootPath,
      relative_path: relativePath,
      absolute_path: absolutePath,
      stats,
      filename: path.basename(absolutePath),
      title: prettyVideoTitle(path.basename(absolutePath)),
      mime_type: videoMimeType(absolutePath),
      audio_tracks: await listEmbeddedAudioTracks(resolvedRootPath, relativePath),
    };
  } catch (_err) {
    return null;
  }
}

async function resolveVideoAudioTrackTarget(token, requestedTrackId = '') {
  const target = await resolveVideoStreamTarget(token);
  if (!target) return null;
  const trackId = String(requestedTrackId || '').trim();
  if (!trackId) return { ...target, audio_track: null };
  const rawIndex = trackId.startsWith('audio:') ? trackId.slice(6) : trackId;
  const streamIndex = Number(rawIndex);
  if (!Number.isFinite(streamIndex) || streamIndex < 0) return null;
  const rootPath = String(target.source_root_path || '').trim();
  const relativePath = String(target.relative_path || '').trim();
  if (!rootPath || !relativePath) return null;
  const tracks = await listEmbeddedAudioTracks(rootPath, relativePath);
  const audioTrack = tracks.find((track) => Number(track.stream_index) === streamIndex) || null;
  if (!audioTrack) return null;
  return {
    ...target,
    audio_track: audioTrack,
  };
}

async function resolveSubtitleStreamTarget(token) {
  const structured = decodeStructuredToken(token);
  if (structured?.type === 'catalog_sidecar_subtitle') {
    const resolvedRootPath = resolveVideoRootPathForRuntime(structured.root_path);
    const relativePath = String(structured.relative_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relativePath || relativePath.includes('..')) return null;
    const absolutePath = path.resolve(resolvedRootPath, relativePath);
    if (!isPathInsideRoot(resolvedRootPath, absolutePath)) return null;
    try {
      const stats = await fs.promises.stat(absolutePath);
      if (!stats.isFile()) return null;
      const ext = String(path.extname(absolutePath) || '').toLowerCase();
      if (!['.vtt', '.srt'].includes(ext)) return null;
      return {
        relative_path: relativePath,
        absolute_path: absolutePath,
        stats,
        filename: path.basename(absolutePath),
        mime_type: subtitleMimeType(absolutePath),
        extension: ext,
      };
    } catch (_err) {
      return null;
    }
  }
  if (structured?.type === 'embedded_subtitle') {
    const relativeVideoPath = String(structured.video || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const streamIndex = Number(structured.stream_index || 0);
    if (!relativeVideoPath || relativeVideoPath.includes('..') || !Number.isInteger(streamIndex) || streamIndex < 0) return null;
    const resolvedRootPath = resolveVideoRootPathForRuntime(structured.root_path || (await getVideoLibrarySettings()).videos_root_path);
    const absoluteVideoPath = path.resolve(resolvedRootPath, relativeVideoPath);
    if (!isPathInsideRoot(resolvedRootPath, absoluteVideoPath)) return null;
    try {
      const absoluteSubtitlePath = await ensureEmbeddedSubtitleExtracted(resolvedRootPath, relativeVideoPath, streamIndex);
      const stats = await fs.promises.stat(absoluteSubtitlePath);
      return {
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
  const settings = await getVideoLibrarySettings();
  if (!settings.videos_root_path) return null;
  const relativePath = decodeVideoToken(token).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) return null;
  const resolvedRootPath = resolveVideoRootPathForRuntime(settings.videos_root_path);
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

async function resolvePosterStreamTarget(token) {
  const structured = decodeStructuredToken(token);
  if (structured?.type !== 'catalog_poster') return null;
  const resolvedRootPath = resolveVideoRootPathForRuntime(structured.root_path);
  const relativePath = String(structured.relative_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) return null;
  const absolutePath = path.resolve(resolvedRootPath, relativePath);
  if (!isPathInsideRoot(resolvedRootPath, absolutePath)) return null;
  try {
    const stats = await fs.promises.stat(absolutePath);
    if (!stats.isFile()) return null;
    const ext = String(path.extname(absolutePath) || '').toLowerCase();
    const mime = ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';
    return {
      relative_path: relativePath,
      absolute_path: absolutePath,
      stats,
      filename: path.basename(absolutePath),
      mime_type: mime,
    };
  } catch (_err) {
    return null;
  }
}

module.exports = {
  DEFAULT_VIDEO_SETTINGS,
  VIDEO_CATALOG_STATUSES,
  ffmpegCommand,
  getMediaToolsStatus,
  getVideoLibrarySettings,
  saveVideoLibrarySettings,
  scanVideoCatalogPath,
  listVideoCatalogItems,
  clearVideoCatalog,
  saveVideoCatalogAiMetadata,
  updateVideoCatalogItem,
  publishVideoCatalogItems,
  listVideoLibrary,
  saveVideoWatchProgress,
  resolveVideoStreamTarget,
  resolveVideoAudioTrackTarget,
  resolveSubtitleStreamTarget,
  resolvePosterStreamTarget,
  convertSrtToVtt,
};
