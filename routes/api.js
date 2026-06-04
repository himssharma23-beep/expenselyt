// ============================================================
// API Routes — Expenses, Friends, Loans, Divide
// ============================================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const Tesseract = require('tesseract.js');
const pgDb = require('../db/postgres-auth');
const pgCoreDb = require('../db/postgres-core');
const pgTenantDb = require('../db/postgres-tenants');
const pgVideoDb = require('../db/postgres-videos');
const pgPetrolDb = require('../db/postgres-petrol');
const pgOpsDb = require('../db/postgres-ops');
const pgBillingDb = require('../db/postgres-billing');
const pgFinanceDb = require('../db/postgres-finance');
const pgAdminNotificationsDb = require('../db/postgres-admin-notifications');
const pgPortalAccessDb = require('../db/postgres-portal-access');
const { assertPostgresConfigured } = require('../db/provider');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { normalizeMessagePayload, sendExpoPushNotifications } = require('../utils/push-notifications');
const {
  sendSplitShareEmailsToTargets,
  sendTripLinkedEmailToUser,
  sendTripFinalizedEmails,
  sendRecurringAppliedEmailForUser,
  sendTrackerExpenseAppliedEmailForUser,
} = require('../utils/user-email-events');
const {
  AI_SYNONYM_GROUPS,
  AI_CANONICAL_QUESTIONS,
  AI_INTENT_RULES,
} = require('../utils/ai-lookup-config');
const { sendLiveSplitInviteEmail, sendTenantPaymentRequestEmail, sendSocietyPaymentRequestEmail } = require('../utils/mailer');
const { sendSms, normalizePhone, isSmsEnabled } = require('../utils/sms');
const {
  isMsg91FlowSmsEnabled,
  isMsg91OtpEnabled,
  isMsg91WidgetSdkEnabled,
  normalizeIndianMobile,
  maskIndianMobile,
  sendMsg91FlowSms,
  sendMsg91Otp,
  verifyMsg91Otp,
  verifyMsg91AccessToken,
} = require('../utils/msg91');
const {
  notifyLiveSplitInviteReceived,
  notifyLiveSplitInviteResponded,
  notifyLiveSplitTripCreated,
  notifyLiveSplitSessionShared,
} = require('../utils/live-split-notifications');

const VIDEO_MOBILE_CACHE_DIR = path.resolve(process.cwd(), 'data', 'video-mobile-cache');
const VIDEO_AUDIO_CACHE_DIR = path.resolve(process.cwd(), 'data', 'video-audio-cache');
const VIDEO_ALT_STREAM_CACHE_DIR = path.resolve(process.cwd(), 'data', 'video-alt-stream-cache');
const VIDEO_HLS_CACHE_DIR = path.resolve(process.cwd(), 'data', 'video-hls-cache');
const mobileVideoTranscodePromises = new Map();
const audioClipCachePromises = new Map();
const altVideoCachePromises = new Map();
const hlsCachePromises = new Map();
const ffmpegMp4EncoderCache = new Map();

function hashMobileVideoKey(target) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      version: 2,
      path: String(target?.absolute_path || ''),
      size: Number(target?.stats?.size || 0),
      mtimeMs: Number(target?.stats?.mtimeMs || 0),
    }))
    .digest('hex');
}

function ffmpegEncoderListIncludes(output = '', encoderName = '') {
  const safeName = String(encoderName || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!safeName) return false;
  return new RegExp(`^\\s*[^\\s]{6}\\s+${safeName}\\b`, 'mi').test(String(output || ''));
}

function getPreferredMp4VideoEncoder(ffmpegCommand) {
  const key = String(ffmpegCommand || '').trim() || 'ffmpeg';
  if (ffmpegMp4EncoderCache.has(key)) return ffmpegMp4EncoderCache.get(key);
  const task = (() => {
    const result = spawnSync(ffmpegCommand, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const output = `${String(result.stdout || '')}\n${String(result.stderr || '')}`;
    if (ffmpegEncoderListIncludes(output, 'libx264')) {
      return {
        name: 'libx264',
        args: ['-preset', 'veryfast', '-crf', '22'],
      };
    }
    if (ffmpegEncoderListIncludes(output, 'libopenh264')) {
      return {
        name: 'libopenh264',
        args: ['-b:v', '3500k', '-maxrate', '4500k', '-bufsize', '7000k'],
      };
    }
    if (ffmpegEncoderListIncludes(output, 'mpeg4')) {
      return {
        name: 'mpeg4',
        args: ['-q:v', '5'],
      };
    }
    throw new Error('No browser-compatible MP4 video encoder is available in the installed ffmpeg build.');
  })();
  ffmpegMp4EncoderCache.set(key, task);
  return task;
}

function streamTranscodedMp4ToResponse(req, res, target, ffmpegCommand, audioStreamIndex = null) {
  const videoEncoder = getPreferredMp4VideoEncoder(ffmpegCommand);
  const audioMap = Number.isInteger(Number(audioStreamIndex)) && Number(audioStreamIndex) >= 0
    ? `0:${Number(audioStreamIndex)}`
    : '0:a:0?';
  let clientClosed = false;
  res.status(200);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent((target?.filename || 'video').replace(/\.[^.]+$/, '') + '.mp4')}`);
  if (typeof res.flushHeaders === 'function') {
    try { res.flushHeaders(); } catch (_err) {}
  }

  const ffmpeg = spawn(ffmpegCommand, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', target.absolute_path,
    '-map', '0:v:0',
    '-map', audioMap,
    '-sn',
    '-dn',
    '-c:v', videoEncoder.name,
    ...videoEncoder.args,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-ac', '2',
    '-b:a', '128k',
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-max_muxing_queue_size', '2048',
    '-f', 'mp4',
    'pipe:1',
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let responseStarted = false;
  ffmpeg.stdout.on('data', () => {
    responseStarted = true;
  });
  ffmpeg.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });
  ffmpeg.on('error', (error) => {
    if (clientClosed) return;
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Could not transcode video' });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
  ffmpeg.on('close', (code) => {
    if (clientClosed) return;
    if (code === 0) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (!responseStarted && !res.headersSent) {
      res.status(500).json({ error: stderr.trim() || 'Could not transcode video' });
      return;
    }
    if (!res.writableEnded) res.end();
  });
  req.on('close', () => {
    clientClosed = true;
    if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
  });
  return ffmpeg.stdout.pipe(res);
}

function streamLocalFileWithRange(req, res, target) {
  const fileSize = Number(target?.stats?.size || 0);
  const range = String(req.headers.range || '').trim();
  const contentType = target?.mime_type || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(target?.filename || 'video')}`);

  if (!range) {
    res.setHeader('Content-Length', fileSize);
    return fs.createReadStream(target.absolute_path).pipe(res);
  }

  const match = range.match(/bytes=(\d*)-(\d*)/i);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
    return res.end();
  }

  let start = match[1] === '' ? NaN : Number(match[1]);
  let end = match[2] === '' ? NaN : Number(match[2]);

  if (Number.isNaN(start) && !Number.isNaN(end)) {
    start = Math.max(fileSize - end, 0);
    end = fileSize - 1;
  } else {
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= fileSize) end = fileSize - 1;
  }

  if (start < 0 || end < start || start >= fileSize) {
    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
    return res.end();
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  res.setHeader('Content-Length', end - start + 1);
  return fs.createReadStream(target.absolute_path, { start, end }).pipe(res);
}

function setVideoHlsCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
}

function rewriteHlsMediaPlaylist(rawManifest = '', token = '', requestedAudioTrack = '') {
  const querySuffix = requestedAudioTrack ? `?audio_stream=${encodeURIComponent(requestedAudioTrack)}` : '';
  return String(rawManifest || '').split(/\r?\n/).map((line) => {
    if (!line || line.startsWith('#')) return line;
    return `/api/videos/hls/${encodeURIComponent(token)}/${encodeURIComponent(line)}${querySuffix}`;
  }).join('\n');
}

function buildHlsMasterPlaylist(token = '', audioTracks = []) {
  const tracks = Array.isArray(audioTracks) ? audioTracks : [];
  if (!tracks.length) return '#EXTM3U\n#EXT-X-VERSION:3\n';
  const defaultTrack = tracks.find((track) => track?.is_default) || tracks[0];
  const orderedTracks = [
    defaultTrack,
    ...tracks.filter((track) => String(track?.id || '') !== String(defaultTrack?.id || '')),
  ].filter(Boolean);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  orderedTracks.forEach((track) => {
    const trackId = String(track?.id || '').trim();
    if (!trackId) return;
    const label = String(track?.label || track?.short_label || trackId).replace(/[\r\n]+/g, ' ').trim();
    lines.push(`# Audio: ${label}`);
    lines.push('#EXT-X-STREAM-INF:BANDWIDTH=2800000,CODECS="avc1.64001f,mp4a.40.2"');
    lines.push(`/api/videos/hls/${encodeURIComponent(token)}/master.m3u8?audio_stream=${encodeURIComponent(trackId)}`);
  });
  return `${lines.join('\n')}\n`;
}

function hlsCacheAudioKey(audioStream = '') {
  const raw = String(audioStream || '').trim();
  if (!raw) return 'default';
  const numeric = raw.startsWith('audio:') ? raw.slice(6) : raw;
  return /^\d+$/.test(numeric) ? `audio-${numeric}` : 'default';
}

function hashHlsCacheKey(target, audioStream = '') {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      version: 2,
      path: String(target?.absolute_path || ''),
      size: Number(target?.stats?.size || 0),
      mtimeMs: Number(target?.stats?.mtimeMs || 0),
      audio: hlsCacheAudioKey(audioStream),
    }))
    .digest('hex');
}

async function ensureHlsCache(target, ffmpegCommand, audioStream = '') {
  await fs.promises.mkdir(VIDEO_HLS_CACHE_DIR, { recursive: true });
  const videoEncoder = getPreferredMp4VideoEncoder(ffmpegCommand);
  const cacheKey = hashHlsCacheKey(target, audioStream);
  const finalDir = path.join(VIDEO_HLS_CACHE_DIR, cacheKey);
  const masterPath = path.join(finalDir, 'master.m3u8');
  const cacheReady = async () => {
    const masterStats = await fs.promises.stat(masterPath).catch(() => null);
    if (!(masterStats?.isFile() && Number(masterStats.size || 0) > 0)) return false;
    const firstSegmentStats = await fs.promises.stat(path.join(finalDir, 'seg_000.ts')).catch(() => null);
    return !!(firstSegmentStats?.isFile() && Number(firstSegmentStats.size || 0) > 0);
  };

  try {
    if (await cacheReady()) {
      return { cacheKey, dir: finalDir, masterPath };
    }
  } catch (_err) {}

  if (hlsCachePromises.has(cacheKey)) {
    return hlsCachePromises.get(cacheKey);
  }

  const task = (async () => {
    const requestedAudio = String(audioStream || '').trim();
    const requestedAudioIndex = requestedAudio.startsWith('audio:') ? requestedAudio.slice(6) : requestedAudio;
    const audioMap = /^\d+$/.test(requestedAudioIndex) ? `0:${Number(requestedAudioIndex)}` : '0:a:0?';
    const segmentPattern = path.join(finalDir, 'seg_%03d.ts');

    await fs.promises.rm(finalDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.mkdir(finalDir, { recursive: true });
    try {
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegCommand, [
          '-hide_banner',
          '-loglevel', 'error',
          '-i', target.absolute_path,
          '-map', '0:v:0',
          '-map', audioMap,
          '-sn',
          '-dn',
          '-c:v', videoEncoder.name,
          ...videoEncoder.args,
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '160k',
          '-ac', '2',
          '-f', 'hls',
          '-hls_time', '6',
          '-hls_list_size', '0',
          '-hls_flags', 'independent_segments+append_list',
          '-hls_segment_filename', segmentPattern,
          '-max_muxing_queue_size', '2048',
          '-y',
          masterPath,
        ], {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
        });

        let stderr = '';
        let settled = false;
        const finishResolve = async () => {
          if (settled) return;
          if (await cacheReady()) {
            settled = true;
            resolve();
          }
        };
        const pollTimer = setInterval(() => {
          finishResolve().catch(() => {});
        }, 500);
        ffmpeg.stderr.on('data', (chunk) => {
          stderr += String(chunk || '');
        });
        ffmpeg.on('error', (error) => {
          clearInterval(pollTimer);
          if (!settled) reject(error);
        });
        ffmpeg.on('close', (code) => {
          clearInterval(pollTimer);
          if (code === 0) {
            finishResolve().then(() => {
              if (!settled) {
                settled = true;
                resolve();
              }
            }).catch(reject);
            return;
          }
          if (!settled) reject(new Error(stderr.trim() || 'HLS transcoding failed'));
        });
      });

      return { cacheKey, dir: finalDir, masterPath };
    } finally {
      hlsCachePromises.delete(cacheKey);
    }
  })();

  hlsCachePromises.set(cacheKey, task);
  return task;
}

async function ensureMobileVideoCacheFile(target, ffmpegCommand) {
  await fs.promises.mkdir(VIDEO_MOBILE_CACHE_DIR, { recursive: true });
  const videoEncoder = getPreferredMp4VideoEncoder(ffmpegCommand);
  const cacheKey = hashMobileVideoKey(target);
  const finalPath = path.join(VIDEO_MOBILE_CACHE_DIR, `${cacheKey}.mp4`);

  try {
    const existingStats = await fs.promises.stat(finalPath);
    if (existingStats.isFile() && Number(existingStats.size || 0) > 0) {
      return {
        absolute_path: finalPath,
        stats: existingStats,
        filename: (target.filename || 'video').replace(/\.[^.]+$/, '.mp4'),
        mime_type: 'video/mp4',
      };
    }
  } catch (_err) {}

  if (!mobileVideoTranscodePromises.has(cacheKey)) {
    mobileVideoTranscodePromises.set(cacheKey, (async () => {
      const tempPath = path.join(VIDEO_MOBILE_CACHE_DIR, `${cacheKey}.${process.pid}.${Date.now()}.tmp.mp4`);
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegCommand, [
          '-hide_banner',
          '-loglevel', 'error',
          '-i', target.absolute_path,
          '-map', '0:v:0',
          '-map', '0:a:0?',
          '-sn',
          '-dn',
          '-c:v', videoEncoder.name,
          ...videoEncoder.args,
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-ac', '2',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-max_muxing_queue_size', '2048',
          '-y',
          tempPath,
        ], {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
        });

        let stderr = '';
        ffmpeg.stderr.on('data', (chunk) => {
          stderr += String(chunk || '');
        });
        ffmpeg.on('error', (error) => reject(error));
        ffmpeg.on('close', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          const error = new Error(stderr.trim() || 'Mobile transcoding failed');
          reject(error);
        });
      });

      try {
        await fs.promises.rename(tempPath, finalPath);
      } catch (_renameErr) {
        try {
          const finalStats = await fs.promises.stat(finalPath);
          if (!(finalStats.isFile() && Number(finalStats.size || 0) > 0)) throw _renameErr;
        } finally {
          await fs.promises.unlink(tempPath).catch(() => {});
        }
      }

      return finalPath;
    })().finally(() => {
      mobileVideoTranscodePromises.delete(cacheKey);
    }));
  }

  const resolvedPath = await mobileVideoTranscodePromises.get(cacheKey);
  const stats = await fs.promises.stat(resolvedPath);
  return {
    absolute_path: resolvedPath,
    stats,
    filename: (target.filename || 'video').replace(/\.[^.]+$/, '.mp4'),
    mime_type: 'video/mp4',
  };
}

function hashAudioClipKey(target, streamIndex, startSeconds) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      path: String(target?.absolute_path || ''),
      size: Number(target?.stats?.size || 0),
      mtimeMs: Number(target?.stats?.mtimeMs || 0),
      streamIndex: Number(streamIndex || 0),
      startSeconds: Number(startSeconds || 0),
    }))
    .digest('hex');
}

async function ensureAudioClipCacheFile(target, ffmpegCommand, streamIndex, startSeconds = 0) {
  await fs.promises.mkdir(VIDEO_AUDIO_CACHE_DIR, { recursive: true });
  const cacheKey = hashAudioClipKey(target, streamIndex, startSeconds);
  const finalPath = path.join(VIDEO_AUDIO_CACHE_DIR, `${cacheKey}.m4a`);

  try {
    const existingStats = await fs.promises.stat(finalPath);
    if (existingStats.isFile() && Number(existingStats.size || 0) > 0) {
      return {
        absolute_path: finalPath,
        filename: `${String(target?.filename || 'audio').replace(/\.[^.]+$/, '')}.m4a`,
        mime_type: 'audio/mp4',
        stats: existingStats,
      };
    }
  } catch (_err) {}

  if (audioClipCachePromises.has(cacheKey)) {
    return audioClipCachePromises.get(cacheKey);
  }

  const task = (async () => {
    const tempPath = `${finalPath}.tmp.m4a`;
    try {
      try { await fs.promises.unlink(tempPath); } catch (_err) {}
      const ffmpegArgs = [
        '-v', 'error',
        '-i', target.absolute_path,
      ];
      if (Number(startSeconds || 0) > 0) ffmpegArgs.push('-ss', String(Number(startSeconds || 0)));
      ffmpegArgs.push(
        '-map', `0:${Number(streamIndex || 0)}`,
        '-vn',
        '-sn',
        '-dn',
        '-map_metadata', '-1',
        '-c:a', 'aac',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', 'faststart',
        '-y',
        tempPath
      );

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegCommand, ffmpegArgs, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        ffmpeg.stderr.on('data', (chunk) => {
          stderr += String(chunk || '');
        });
        ffmpeg.on('error', reject);
        ffmpeg.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        });
      });

      await fs.promises.rename(tempPath, finalPath);
      const stats = await fs.promises.stat(finalPath);
      return {
        absolute_path: finalPath,
        filename: `${String(target?.filename || 'audio').replace(/\.[^.]+$/, '')}.m4a`,
        mime_type: 'audio/mp4',
        stats,
      };
    } finally {
      audioClipCachePromises.delete(cacheKey);
      try { await fs.promises.unlink(tempPath); } catch (_err) {}
    }
  })();

  audioClipCachePromises.set(cacheKey, task);
  return task;
}

function hashAltVideoKey(target, streamIndex) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      version: 4,
      path: String(target?.absolute_path || ''),
      size: Number(target?.stats?.size || 0),
      mtimeMs: Number(target?.stats?.mtimeMs || 0),
      streamIndex: Number(streamIndex || 0),
    }))
    .digest('hex');
}

async function ensureAlternateVideoCacheFile(target, ffmpegCommand, streamIndex) {
  await fs.promises.mkdir(VIDEO_ALT_STREAM_CACHE_DIR, { recursive: true });
  const cacheKey = hashAltVideoKey(target, streamIndex);
  const finalPath = path.join(VIDEO_ALT_STREAM_CACHE_DIR, `${cacheKey}.mp4`);

  try {
    const existingStats = await fs.promises.stat(finalPath);
    if (existingStats.isFile() && Number(existingStats.size || 0) > 0) {
      return {
        absolute_path: finalPath,
        filename: `${String(target?.filename || 'video').replace(/\.[^.]+$/, '')}.mp4`,
        mime_type: 'video/mp4',
        stats: existingStats,
      };
    }
  } catch (_err) {}

  if (altVideoCachePromises.has(cacheKey)) {
    return altVideoCachePromises.get(cacheKey);
  }

  const task = (async () => {
    const tempPath = `${finalPath}.tmp.mp4`;
    try {
      try { await fs.promises.unlink(tempPath); } catch (_err) {}
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegCommand, [
          '-v', 'error',
          '-i', target.absolute_path,
          '-map', '0:v:0',
          '-map', `0:${Number(streamIndex || 0)}`,
          '-sn',
          '-dn',
          '-map_metadata', '-1',
          '-fflags', '+genpts',
          '-avoid_negative_ts', 'make_zero',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          '-y',
          tempPath,
        ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        ffmpeg.stderr.on('data', (chunk) => {
          stderr += String(chunk || '');
        });
        ffmpeg.on('error', reject);
        ffmpeg.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        });
      });

      await fs.promises.rename(tempPath, finalPath);
      const stats = await fs.promises.stat(finalPath);
      return {
        absolute_path: finalPath,
        filename: `${String(target?.filename || 'video').replace(/\.[^.]+$/, '')}.mp4`,
        mime_type: 'video/mp4',
        stats,
      };
    } finally {
      altVideoCachePromises.delete(cacheKey);
      try { await fs.promises.unlink(tempPath); } catch (_err) {}
    }
  })();

  altVideoCachePromises.set(cacheKey, task);
  return task;
}

function normalizeOcrAmount(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .replace(/[,\s]/g, '')
    .replace(/[^0-9.-]/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

function normalizeOcrLine(line) {
  return String(line || '')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseReceiptDateFromText(text) {
  const source = String(text || '');
  const patterns = [
    /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    if (pattern === patterns[0]) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (year >= 2000 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
      continue;
    }
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    if (year >= 2000 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function roundCurrencyAmount(value) {
  return Math.round((Number(value || 0) || 0) * 100) / 100;
}

function formatNotificationCurrency(amount, currencyCode = 'INR', localeCode = 'en-IN') {
  try {
    return new Intl.NumberFormat(localeCode || 'en-IN', {
      style: 'currency',
      currency: currencyCode || 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(roundCurrencyAmount(amount));
  } catch (_err) {
    return `${currencyCode || 'INR'} ${roundCurrencyAmount(amount).toFixed(2)}`;
  }
}

async function sendStoredNotificationToUser(userId, payload = {}) {
  const notification = await Promise.resolve(pgDb.createUserNotification(userId, payload));
  if (!notification) {
    return { created: null, sent: 0, delivery: null };
  }

  const [prefs, unread, tokenRows] = await Promise.all([
    Promise.resolve(pgDb.getUserNotificationPreferences(userId)),
    Promise.resolve(pgDb.getUnreadNotificationCount(userId)),
    Promise.resolve(pgDb.getPushTokensForUsers([userId])),
  ]);

  if (prefs?.push_enabled === false || !tokenRows.length || payload?.silent) {
    return { created: notification, sent: 0, delivery: null };
  }

  const delivery = await sendExpoPushNotifications(tokenRows.map((row) => ({
    to: row.token,
    title: notification.title,
    body: notification.body,
    user_id: userId,
    notification_id: notification.id,
    platform: row.platform,
    data: {
      notificationId: notification.id,
      screen: notification.target_screen || null,
      params: notification.target_params || {},
      type: notification.type,
      ...(notification.data || {}),
    },
  })));

  for (const ticketRow of (delivery?.tickets || [])) {
    if (ticketRow?.ticket?.status !== 'ok') continue;
    const pushedUserId = Number(ticketRow?.meta?.user_id || 0);
    const notificationId = Number(ticketRow?.meta?.notification_id || 0);
    if (pushedUserId === Number(userId) && notificationId > 0) {
      await Promise.resolve(pgDb.markUserNotificationPushed(userId, notificationId));
    }
  }

  return {
    created: notification,
    sent: Number(delivery?.sent || 0),
    unread,
    delivery,
  };
}

async function notifyAdminAboutTenantPaymentRequest(context = {}) {
  const ownerUserId = Number(context?.owner_user_id || 0);
  if (!ownerUserId) return { notified: false };
  const tenantName = String(context?.tenant_name || 'Tenant').trim() || 'Tenant';
  const buildingName = String(context?.building_name || 'Building').trim() || 'Building';
  const invoiceMonth = String(context?.invoice_month || '').trim();
  const amountText = formatNotificationCurrency(context?.requested_amount || 0, context?.currency_code || 'INR', context?.locale_code || 'en-IN');
  const roomText = [String(context?.room_label || '').trim(), String(context?.floor_label || '').trim()].filter(Boolean).join(' - ');
  const body = `${tenantName} marked ${invoiceMonth || 'an invoice'} paid for ${amountText}${roomText ? ` (${roomText})` : ''}.`;
  const notificationResult = await sendStoredNotificationToUser(ownerUserId, {
    type: 'tenant_payment_request',
    title: 'Tenant marked invoice paid',
    body,
    target_screen: 'Tenants',
    target_params: { tab: 'invoices' },
    data: {
      requestId: Number(context?.request_id || 0),
      invoiceId: Number(context?.invoice_id || 0),
      tenantId: Number(context?.tenant_id || 0),
      invoiceMonth,
    },
    dedupe_key: `tenant-payment-request:${Number(context?.request_id || 0)}`,
  });
  if (context?.owner_email) {
    await sendTenantPaymentRequestEmail({
      to: context.owner_email,
      ownerName: context.owner_name,
      tenantName: context.tenant_name,
      buildingName: context.building_name,
      roomLabel: context.room_label,
      floorLabel: context.floor_label,
      invoiceMonth: context.invoice_month,
      dueDate: context.due_date,
      requestedAmount: context.requested_amount,
      totalAmount: context.total_amount,
      tenantNote: context.tenant_note,
      currencyCode: context.currency_code,
      localeCode: context.locale_code,
    });
  }
  return { notified: true, notificationResult };
}

async function notifyAdminAboutSocietyPaymentRequest(context = {}) {
  const ownerUserId = Number(context?.owner_user_id || 0);
  if (!ownerUserId) return { notified: false };
  const memberName = String(context?.member_name || 'Member').trim() || 'Member';
  const monthKey = String(context?.month_key || '').trim();
  const amountText = formatNotificationCurrency(context?.requested_amount || 0, context?.currency_code || 'INR', context?.locale_code || 'en-IN');
  const unitText = [String(context?.unit_label || '').trim(), String(context?.property_type || '').trim()].filter(Boolean).join(' - ');
  const body = `${memberName} marked ${monthKey || 'monthly dues'} paid for ${amountText}${unitText ? ` (${unitText})` : ''}.`;
  const notificationResult = await sendStoredNotificationToUser(ownerUserId, {
    type: 'society_payment_request',
    title: 'Member marked monthly due paid',
    body,
    target_screen: 'Societies',
    target_params: { tab: 'requests' },
    data: {
      requestId: Number(context?.request_id || 0),
      societyId: Number(context?.society_id || 0),
      memberId: Number(context?.member_id || 0),
      monthKey,
    },
    dedupe_key: `society-payment-request:${Number(context?.request_id || 0)}`,
  });
  if (context?.owner_email) {
    await sendSocietyPaymentRequestEmail({
      to: context.owner_email,
      ownerName: context.owner_name,
      memberName: context.member_name,
      societyName: context.society_name,
      unitLabel: context.unit_label,
      propertyType: context.property_type,
      monthKey: context.month_key,
      requestedPaidOn: context.requested_paid_on,
      requestedAmount: context.requested_amount,
      monthlyDue: context.monthly_due,
      memberNote: context.member_note,
      currencyCode: context.currency_code,
      localeCode: context.locale_code,
    });
  }
  return { notified: true, notificationResult };
}

function parseReceiptDraftFromText(text) {
  const rawLines = String(text || '').split(/\r?\n/).map(normalizeOcrLine).filter(Boolean);
  const lines = rawLines.filter((line) => !/^[\W_]+$/.test(line));
  const receiptDate = parseReceiptDateFromText(lines.join('\n'));
  const merchant = lines.find((line) => (
    line.length >= 3 &&
    line.length <= 48 &&
    /[a-z]/i.test(line) &&
    !/\b(invoice|bill|date|time|cash|gst|total|receipt|tax)\b/i.test(line)
  )) || 'Scanned receipt';

  let totalAmount = null;
  for (const line of lines) {
    if (!/\b(total|grand total|net total|amount due|bill total|balance due)\b/i.test(line)) continue;
    const amountMatch = line.match(/([0-9]+(?:[.,][0-9]{2})?)\s*$/);
    const amount = normalizeOcrAmount(amountMatch ? amountMatch[1] : line);
    if (amount) {
      totalAmount = amount;
      break;
    }
  }

  const itemRows = lines
    .map((line) => parseReceiptItemCandidateLine(line, receiptDate))
    .filter(Boolean);

  let items = itemRows.filter((row) => row.amount < 100000);
  if (totalAmount && items.length > 1) {
    const sum = items.reduce((acc, row) => acc + row.amount, 0);
    if (sum > totalAmount * 1.6) {
      items = items.filter((row) => row.amount <= totalAmount);
    }
  }

  if (!items.length && totalAmount) {
    items = [{
      item_name: merchant,
      amount: totalAmount,
      purchase_date: receiptDate,
      category: null,
      is_extra: false,
      selected: true,
    }];
  }

  return {
    merchant,
    purchase_date: receiptDate,
    total_amount: totalAmount,
    items,
    raw_text: lines.join('\n'),
  };
}

function cleanReceiptItemName(name) {
  return String(name || '')
    .replace(/^\d+\s+(?=[A-Z][A-Z0-9%/ ]{2,})/, '')
    .replace(/\s*-\s*[A-Za-z,& ]{1,20}-\s*$/g, '')
    .replace(/\s+-[A-Z,]{1,12}$/g, '')
    .replace(/\s+[A-Z]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseReceiptItemCandidateLine(line, purchaseDate = null) {
  const value = normalizeOcrLine(line);
  if (!value) return null;
  if (/\b(total|subtotal|gst|cgst|sgst|tax|round off|cash|change|invoice|receipt|date|time|phone|upi|card|amount due|balance due|approval|approved|mastercard|visa|auth|reference|member)\b/i.test(value)) return null;
  if (/\bTPD\/[A-Z0-9]+\b/i.test(value)) return null;
  const match = value.match(/^(.+?)\s+([0-9]+(?:[.,][0-9]{2}))\s*[A-Z]?\s*$/);
  if (!match) return null;
  const amount = normalizeOcrAmount(match[2]);
  let itemName = cleanReceiptItemName(match[1]);
  if (!itemName || itemName.length < 2 || !amount) return null;
  if (!/[A-Za-z]/.test(itemName)) return null;
  if (/^\d+\s*@\s*$/i.test(itemName)) return null;
  if (/^\d+\s*[x@]\s*[0-9.]+$/i.test(itemName)) return null;
  if (/^\d+\s+(?:ea|each|pcs|qty|units?)$/i.test(itemName)) return null;
  if (/^\d+$/.test(itemName) || itemName.length > 100) return null;
  return {
    item_name: itemName,
    amount,
    purchase_date: purchaseDate,
    category: null,
    is_extra: false,
    selected: true,
  };
}

function normalizeReceiptNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9% ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function receiptNameLooksSame(a, b) {
  const left = normalizeReceiptNameKey(a);
  const right = normalizeReceiptNameKey(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function parseReceiptDiscountCandidateLine(line) {
  const value = normalizeOcrLine(line);
  if (!value) return null;
  const match = value.match(/^(?:\d+\s+)?TPD\/(\d+)\s+([0-9]+(?:[.,][0-9]{2}))-\s*[A-Z]?\s*$/i);
  if (!match) return null;
  const amount = normalizeOcrAmount(match[2]);
  if (!amount) return null;
  return {
    ref_sku: String(match[1] || '').trim(),
    amount,
  };
}

function parseReceiptDetailedItemLine(line, purchaseDate = null) {
  const value = normalizeOcrLine(line);
  if (!value) return null;
  const discountLine = parseReceiptDiscountCandidateLine(value);
  if (discountLine) return { type: 'discount', ...discountLine };
  const item = parseReceiptItemCandidateLine(value, purchaseDate);
  if (!item) return null;
  const skuMatch = value.match(/^(\d{3,})\s+/);
  return {
    type: 'item',
    sku: skuMatch ? String(skuMatch[1]) : '',
    ...item,
  };
}

function buildDetailedReceiptItemsFromOcr(ocrText = '', purchaseDate = null) {
  const detailedRows = [];
  const lastItemIndexBySku = new Map();
  String(ocrText || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const parsed = parseReceiptDetailedItemLine(line, purchaseDate);
      if (!parsed) return;
      if (parsed.type === 'item') {
        const row = {
          item_name: parsed.item_name,
          amount: parsed.amount,
          purchase_date: parsed.purchase_date || purchaseDate,
          category: null,
          is_extra: false,
          selected: true,
          _sku: parsed.sku || '',
          _raw: normalizeOcrLine(line),
        };
        detailedRows.push(row);
        if (row._sku) lastItemIndexBySku.set(row._sku, detailedRows.length - 1);
        return;
      }
      if (parsed.type === 'discount') {
        let targetIndex = -1;
        if (parsed.ref_sku && lastItemIndexBySku.has(parsed.ref_sku)) {
          targetIndex = Number(lastItemIndexBySku.get(parsed.ref_sku));
        } else if (parsed.ref_sku) {
          for (let index = detailedRows.length - 1; index >= 0; index -= 1) {
            const raw = String(detailedRows[index]?._raw || '');
            if (raw && new RegExp(`\\b${parsed.ref_sku}\\b`).test(raw)) {
              targetIndex = index;
              break;
            }
          }
        }
        if (targetIndex < 0 && detailedRows.length) {
          targetIndex = detailedRows.length - 1;
        }
        if (targetIndex >= 0 && detailedRows[targetIndex]) {
          detailedRows[targetIndex].amount = roundCurrencyAmount(Math.max(0, Number(detailedRows[targetIndex].amount || 0) - Number(parsed.amount || 0)));
        }
      }
    });
  return detailedRows
    .filter((row) => Number(row?.amount || 0) > 0)
    .map(({ _sku, _raw, ...row }) => row);
}

function sanitizeReceiptItems(items, fallbackDate = null) {
  return (Array.isArray(items) ? items : [])
    .map((row) => {
      const amount = normalizeOcrAmount(row?.amount);
      const itemName = String(row?.item_name || '').trim();
      const purchaseDate = parseReceiptDateFromText(String(row?.purchase_date || '')) || fallbackDate;
      if (!itemName || !amount) return null;
      return {
        item_name: itemName,
        amount,
        purchase_date: purchaseDate,
        category: String(row?.category || '').trim() || null,
        is_extra: !!row?.is_extra,
        selected: row?.selected !== false,
      };
    })
    .filter(Boolean);
}

function normalizeReceiptDraftShape(draft, rawText = '') {
  const purchaseDate = parseReceiptDateFromText(String(draft?.purchase_date || '')) || parseReceiptDateFromText(rawText);
  const merchant = String(draft?.merchant || '').trim() || 'Scanned receipt';
  const totalAmount = normalizeOcrAmount(draft?.total_amount);
  let items = sanitizeReceiptItems(draft?.items, purchaseDate);

  if (!items.length && totalAmount) {
    items = [{
      item_name: merchant,
      amount: totalAmount,
      purchase_date: purchaseDate,
      category: null,
      is_extra: false,
      selected: true,
    }];
  }

  return {
    merchant,
    purchase_date: purchaseDate,
    total_amount: totalAmount,
    items,
    raw_text: String(rawText || draft?.raw_text || '').trim(),
  };
}

function mergeReceiptDrafts(localDraft, aiDraft) {
  if (!aiDraft) return localDraft;
  return {
    merchant: aiDraft.merchant || localDraft.merchant,
    purchase_date: aiDraft.purchase_date || localDraft.purchase_date,
    total_amount: aiDraft.total_amount || localDraft.total_amount,
    items: aiDraft.items?.length ? aiDraft.items : localDraft.items,
    raw_text: aiDraft.raw_text || localDraft.raw_text,
  };
}

function isTransactionListDraft(draft) {
  const rawText = String(draft?.raw_text || '');
  const items = Array.isArray(draft?.items) ? draft.items : [];
  const transactionKeywords = /\b(payment history|payment|checkout|razorpay|wallet|transactions?|statement|apr '?26|may '?26|jun '?26|am|pm)\b/i;
  const datedRows = items.filter((row) => parseReceiptDateFromText(String(row?.purchase_date || ''))).length;
  const repeatedShortNames = items.filter((row) => String(row?.item_name || '').trim().length >= 2 && String(row?.item_name || '').trim().length <= 40).length;
  return items.length >= 2 && (
    transactionKeywords.test(rawText) ||
    datedRows >= 2 ||
    repeatedShortNames >= 3
  );
}

function finalizeReceiptDraft(draft) {
  if (!draft) return draft;
  const rawText = String(draft.raw_text || '');
  const hasExplicitTotalLabel = /\b(total|grand total|net total|amount due|bill total|balance due|subtotal)\b/i.test(rawText);
  let items = Array.isArray(draft.items) ? [...draft.items] : [];
  const totalAmount = normalizeOcrAmount(draft.total_amount);
  const isTransactionList = isTransactionListDraft(draft);

  if (items.length > 1 && totalAmount) {
    const smallerRows = items.filter((row) => {
      const rowAmount = normalizeOcrAmount(row?.amount);
      return rowAmount && rowAmount < totalAmount - 0.01;
    });
    if (smallerRows.length) {
      items = items.filter((row) => {
        const rowAmount = normalizeOcrAmount(row?.amount);
        return !(rowAmount && Math.abs(rowAmount - totalAmount) < 0.01);
      });
    }
  }

  if (items.length > 1 && totalAmount && (isTransactionList || !hasExplicitTotalLabel)) {
    const totalMatchesSingleRow = items.some((row) => {
      const rowAmount = normalizeOcrAmount(row?.amount);
      return rowAmount && Math.abs(rowAmount - totalAmount) < 0.01;
    });
    if (isTransactionList || totalMatchesSingleRow) {
      return {
        ...draft,
        merchant: isTransactionList ? 'Scanned transactions' : draft.merchant,
        total_amount: null,
        items,
      };
    }
  }

  if (isTransactionList) {
    return {
      ...draft,
      merchant: 'Scanned transactions',
    };
  }

  return draft;
}

function normalizeReceiptItemMatchKey(row) {
  const name = String(row?.item_name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const amount = normalizeOcrAmount(row?.amount);
  if (!name || !amount) return '';
  return `${name}|${amount.toFixed(2)}`;
}

function reconcileReceiptItemsWithOcr(aiItems = [], ocrText = '', purchaseDate = null) {
  const aiRows = (Array.isArray(aiItems) ? aiItems : []).filter((row) => {
    const itemName = String(row?.item_name || '').trim();
    return itemName && !/^\d+\s*@\s*[0-9.]+$/i.test(itemName) && !/^\d+\s*@?$/i.test(itemName);
  }).map((row) => ({ ...row }));
  const ocrRows = buildDetailedReceiptItemsFromOcr(ocrText, purchaseDate);
  if (!ocrRows.length) return aiRows;

  const aiSubtotal = roundCurrencyAmount(aiRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0));
  const ocrSubtotal = roundCurrencyAmount(ocrRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0));
  const ocrLooksWeak = (
    (ocrRows.length <= 1 && aiRows.length >= 2)
    || (aiRows.length >= 4 && ocrRows.length <= Math.max(1, Math.floor(aiRows.length / 3)))
    || (aiSubtotal > 0 && ocrSubtotal > 0 && ocrSubtotal < aiSubtotal * 0.4)
  );
  if (ocrLooksWeak) return aiRows;

  const usedAiIndexes = new Set();
  const finalRows = [];
  ocrRows.forEach((ocrRow) => {
    const exactIndex = aiRows.findIndex((aiRow, index) => (
      !usedAiIndexes.has(index)
      && normalizeReceiptItemMatchKey(aiRow) === normalizeReceiptItemMatchKey(ocrRow)
    ));
    if (exactIndex >= 0) {
      usedAiIndexes.add(exactIndex);
      finalRows.push(aiRows[exactIndex]);
      return;
    }
    const nameIndex = aiRows.findIndex((aiRow, index) => (
      !usedAiIndexes.has(index)
      && receiptNameLooksSame(aiRow?.item_name, ocrRow?.item_name)
    ));
    if (nameIndex >= 0) {
      usedAiIndexes.add(nameIndex);
      finalRows.push({
        ...aiRows[nameIndex],
        item_name: ocrRow.item_name,
        amount: ocrRow.amount,
        purchase_date: ocrRow.purchase_date || aiRows[nameIndex].purchase_date || purchaseDate || '',
      });
      return;
    }
    finalRows.push({
      ...ocrRow,
      purchase_date: ocrRow.purchase_date || purchaseDate || '',
    });
  });

  return orderReceiptItemsByReference(finalRows, ocrRows);
}

function dedupeReceiptItemsHeuristically(items = []) {
  const deduped = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const key = normalizeReceiptItemMatchKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function mergeReceiptItemsByPageMaxCount(drafts = [], purchaseDate = '') {
  const pages = (Array.isArray(drafts) ? drafts : []).filter(Boolean);
  const maxCountByKey = new Map();
  const sampleByKey = new Map();
  const firstSeenOrder = [];
  pages.forEach((page) => {
    const rows = sanitizeReceiptItems(page?.items, purchaseDate);
    const counts = new Map();
    rows.forEach((row) => {
      const key = normalizeReceiptItemMatchKey(row);
      if (!key) return;
      counts.set(key, Number(counts.get(key) || 0) + 1);
      if (!sampleByKey.has(key)) {
        sampleByKey.set(key, row);
        firstSeenOrder.push(key);
      }
    });
    counts.forEach((count, key) => {
      const existing = Number(maxCountByKey.get(key) || 0);
      if (count > existing) maxCountByKey.set(key, count);
    });
  });
  return firstSeenOrder.flatMap((key) => {
    const sample = sampleByKey.get(key);
    const count = Number(maxCountByKey.get(key) || 0);
    return Array.from({ length: count }, () => ({ ...sample }));
  });
}

function orderReceiptItemsByReference(items = [], referenceItems = []) {
  const orderMap = new Map();
  (Array.isArray(referenceItems) ? referenceItems : []).forEach((item, index) => {
    const key = normalizeReceiptItemMatchKey(item);
    if (key && !orderMap.has(key)) orderMap.set(key, index);
  });
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const aIndex = orderMap.has(normalizeReceiptItemMatchKey(a)) ? orderMap.get(normalizeReceiptItemMatchKey(a)) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderMap.has(normalizeReceiptItemMatchKey(b)) ? orderMap.get(normalizeReceiptItemMatchKey(b)) : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return 0;
  });
}

function mergeReceiptDraftPages(drafts = []) {
  const pages = (Array.isArray(drafts) ? drafts : []).filter(Boolean);
  const merchant = pages.map((page) => String(page?.merchant || '').trim()).find(Boolean) || 'Scanned receipt';
  const purchaseDate = pages.map((page) => String(page?.purchase_date || '').trim()).find(Boolean) || '';
  const totalAmount = pages
    .map((page) => normalizeOcrAmount(page?.total_amount))
    .filter((value) => value > 0)
    .sort((a, b) => b - a)[0] || null;
  const combinedItems = mergeReceiptItemsByPageMaxCount(pages, purchaseDate);
  const rawText = pages.map((page, index) => `--- PAGE ${index + 1} ---\n${String(page?.raw_text || '').trim()}`.trim()).filter(Boolean).join('\n\n');
  return {
    merchant,
    purchase_date: purchaseDate,
    total_amount: totalAmount,
    items: combinedItems,
    raw_text: rawText,
  };
}

function normalizeSmartCaptureText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[|]+/g, ' ')
    .trim();
}

function getOpenAiSmartCaptureConfig() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const model = String(process.env.OPENAI_SMART_CAPTURE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  return {
    apiKey,
    model,
    enabled: !!apiKey,
  };
}

function getOpenAiReceiptScanModel() {
  return String(
    process.env.OPENAI_RECEIPT_SCAN_MODEL ||
    process.env.OPENAI_SMART_CAPTURE_MODEL ||
    process.env.OPENAI_MODEL ||
    'gpt-4.1-mini'
  ).trim();
}

function getOpenAiReceiptScanTimeoutMs() {
  const raw = Number(process.env.OPENAI_RECEIPT_SCAN_TIMEOUT_MS || 45000);
  if (!Number.isFinite(raw)) return 45000;
  if (raw < 10000) return 10000;
  if (raw > 120000) return 120000;
  return Math.round(raw);
}

function getOpenAiCcBillMatchModel() {
  return String(
    process.env.OPENAI_CC_BILL_MATCH_MODEL ||
    process.env.OPENAI_RECEIPT_SCAN_MODEL ||
    process.env.OPENAI_SMART_CAPTURE_MODEL ||
    'gpt-4o-mini'
  ).trim();
}

function getOpenAiCcBillMatchTimeoutMs() {
  const raw = Number(process.env.OPENAI_CC_BILL_MATCH_TIMEOUT_MS || 90000);
  if (!Number.isFinite(raw)) return 90000;
  if (raw < 20000) return 20000;
  if (raw > 180000) return 180000;
  return Math.round(raw);
}

async function postOpenAiResponseWithTimeout(body, apiKey, timeoutMs = getOpenAiReceiptScanTimeoutMs()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getOpenAiAiLookupConfig() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const model = String(
    process.env.OPENAI_AI_LOOKUP_MODEL ||
    process.env.OPENAI_MODEL ||
    'gpt-4.1-mini'
  ).trim();
  return {
    apiKey,
    model,
    enabled: !!apiKey,
  };
}

function getOpenAiVideoCatalogConfig() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const model = String(
    process.env.OPENAI_VIDEO_CATALOG_MODEL ||
    process.env.OPENAI_MODEL ||
    'gpt-4.1-mini'
  ).trim();
  return {
    apiKey,
    model,
    enabled: !!apiKey,
  };
}

function enrichAiLookupStatus(status) {
  const config = getOpenAiAiLookupConfig();
  const allowed = status?.allowed_modes || { offline: true, online: true };
  return {
    ...(status || {}),
    allowed_modes: allowed,
    modes: {
      offline: !!allowed.offline,
      online: !!allowed.online && !!config.enabled,
    },
    online_model: allowed.online && config.enabled ? config.model : '',
  };
}

function normalizeAppVersionValue(value) {
  return String(value || '').trim().slice(0, 40);
}

function parseAppVersionParts(version) {
  return normalizeAppVersionValue(version)
    .split(/[^0-9A-Za-z]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

function compareAppVersions(currentVersion, latestVersion) {
  const left = parseAppVersionParts(currentVersion);
  const right = parseAppVersionParts(latestVersion);
  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen; i++) {
    const a = left[i];
    const b = right[i];
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') {
      if (a < b) return -1;
      if (a > b) return 1;
      continue;
    }
    const textA = String(a);
    const textB = String(b);
    if (textA < textB) return -1;
    if (textA > textB) return 1;
  }
  return 0;
}

function isTruthyEnvFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function extractOpenAiOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts = [];
  for (const item of (payload?.output || [])) {
    if (item?.type !== 'message') continue;
    for (const content of (item?.content || [])) {
      if (content?.type === 'output_text' && typeof content?.text === 'string') {
        parts.push(content.text);
      }
      if (content?.type === 'refusal' && content?.refusal) {
        throw new Error(content.refusal);
      }
    }
  }
  return parts.join('\n').trim();
}

function tryParseJsonObjectText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    // Keep trying below.
  }
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch (_err) {
      // Keep trying below.
    }
  }
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_err) {
      // Keep trying below.
    }
  }
  return null;
}

function normalizePosterUrlCandidate(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  if (/\s/.test(raw)) return '';
  if (/m\.media-amazon\.com/i.test(raw)) return '';
  if (/\.(jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(raw)) return raw;
  if (/(image\.tmdb\.org|upload\.wikimedia\.org|static\.tvmaze\.com)/i.test(raw)) return raw;
  return '';
}

function withPromiseTimeout(promise, timeoutMs, message) {
  const maxMs = Math.max(1000, Number(timeoutMs || 0));
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error(message || 'Operation timed out.');
        err.statusCode = 504;
        reject(err);
      }, maxMs);
    }),
  ]);
}

function sleep(ms) {
  const delay = Math.max(0, Number(ms || 0));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function buildVideoCatalogAiReuseKey(item) {
  const year = Number(item?.release_year || 0) > 0 ? String(item.release_year) : '';
  const mediaType = String(item?.media_type || 'movie').trim().toLowerCase() || 'movie';
  const raw = String(item?.display_title || item?.folder_name || '').trim().toLowerCase();
  const cleaned = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:1080p|720p|2160p|4k|hdr|hevc|x264|x265|ddp5?\.?1|aac|bluray|brrip|webrip|web-dl|multi(?:\s*audio)?|dual\s*audio|proper|remux|uncut|extended|hindi|eng(?:lish)?|tam(?:il)?|tel(?:ugu)?|mal(?:ayalam)?|peruguy|allmovieshub(?:\.in)?|sample)\b/gi, ' ')
    .replace(/\b\d+x\d+\b/gi, ' ')
    .replace(/\bs\d{1,2}e\d{1,3}\b/gi, ' ')
    .replace(/\bseason\s*\d+\b/gi, ' ')
    .replace(/\bepisode\s*\d+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${mediaType}|${year}|${cleaned || raw}`;
}

function scoreVideoCatalogAiCandidate(item) {
  const raw = String(item?.display_title || item?.folder_name || '').trim();
  let score = 0;
  if (/\b(sample|allmovieshub|peruguy)\b/i.test(raw)) score += 8;
  if (/\[[^\]]+\]/.test(raw)) score += 3;
  if (/\b(?:1080p|720p|2160p|4k|hdr|hevc|x264|x265|bluray|brrip|webrip|web-dl|multi(?:\s*audio)?|dual\s*audio|proper|remux|uncut|extended)\b/i.test(raw)) score += 4;
  if (/\b(?:hin|hindi|eng|english|tam|tamil|tel|telugu|mal|malayalam)\b/i.test(raw)) score += 2;
  if (/\bs\d{1,2}e\d{1,3}\b/i.test(raw)) score += 1;
  if (raw.length > 80) score += 2;
  return score;
}

function isOpenAiQuotaExhaustedError(err) {
  const status = Number(err?.statusCode || err?.status || 0);
  const message = String(err?.message || '').toLowerCase();
  if (status !== 429) return false;
  return (
    message.includes('insufficient_quota') ||
    message.includes('quota') ||
    message.includes('billing') ||
    message.includes('balance') ||
    message.includes('credit')
  );
}

async function fetchVideoCatalogMetadataDraft(item) {
  const config = getOpenAiVideoCatalogConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI video cataloging is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: [
      'display_title',
      'media_type',
      'release_year',
      'genres',
      'synopsis',
      'cast_members',
      'creators',
      'tags',
      'original_language',
      'country',
      'content_rating',
      'poster_url',
      'runtime_minutes',
      'season_count',
      'episode_count',
      'confidence',
      'note',
    ],
    properties: {
      display_title: { type: 'string' },
      media_type: { type: 'string', enum: ['movie', 'series'] },
      release_year: { type: ['integer', 'null'] },
      genres: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      synopsis: { type: 'string' },
      cast_members: { type: 'array', items: { type: 'string' }, maxItems: 24 },
      creators: { type: 'array', items: { type: 'string' }, maxItems: 16 },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 24 },
      original_language: { type: 'string' },
      country: { type: 'string' },
      content_rating: { type: 'string' },
      poster_url: { type: 'string' },
      runtime_minutes: { type: ['integer', 'null'] },
      season_count: { type: ['integer', 'null'] },
      episode_count: { type: 'integer' },
      confidence: { type: 'integer' },
      note: { type: 'string' },
    },
  };

  const body = {
    model: config.model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              'You are enriching a private movie and TV series catalog from folder names and filenames.',
              'Infer metadata only when you are reasonably confident the title is a recognizable real movie or series.',
              'If you are unsure, keep fields blank or null instead of inventing details.',
              'Use concise, searchable metadata: genres, synopsis, cast, creators, language, country, rating, runtime, season count, episode count, and tags.',
              'For series, keep display_title as the series title, not an episode name.',
              'Use web search to identify the exact movie or series when needed.',
              'If you can confidently find a real public poster image, return a direct poster image URL in poster_url.',
              'poster_url must be a direct image URL, not a webpage URL.',
              'If you cannot confidently find a direct poster image URL, return an empty string for poster_url.',
              'confidence must be 0 to 100.',
              'Return only valid JSON matching the schema.',
            ].join(' '),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              folder_name: item.folder_name || '',
              current_title: item.display_title || '',
              current_type: item.media_type || '',
              current_year: item.release_year || null,
              file_count: Number(item.file_count || 0),
              episode_count: Number(item.episode_count || 0),
              season_count: item.season_count || null,
              filenames: Array.isArray(item.files) ? item.files.slice(0, 40).map((file) => file.filename || file.relative_path || '') : [],
              relative_paths: Array.isArray(item.files) ? item.files.slice(0, 40).map((file) => file.relative_path || '') : [],
            }, null, 2),
          },
        ],
      },
    ],
    tools: [
      { type: 'web_search', search_context_size: 'low' },
    ],
    tool_choice: 'auto',
    text: {
      format: {
        type: 'json_schema',
        name: 'video_catalog_metadata',
        strict: true,
        schema,
      },
    },
  };

  const response = await postOpenAiResponseWithTimeout(body, config.apiKey, 35000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || payload?.message || `OpenAI video catalog request failed with HTTP ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }
  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) {
    const err = new Error('OpenAI returned an empty video metadata result.');
    err.statusCode = 502;
    throw err;
  }
  const parsed = tryParseJsonObjectText(outputText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('OpenAI returned invalid JSON for video catalog metadata.');
    err.statusCode = 502;
    throw err;
  }
  parsed.poster_url = normalizePosterUrlCandidate(parsed.poster_url);
  return parsed;
}

function buildAiLookupOpenAiContext(summary, currentUser) {
  const safeArray = (value, limit = 50) => (Array.isArray(value) ? value.slice(0, limit) : []);
  return {
    user: {
      id: Number(currentUser?.id || 0),
      username: currentUser?.username || '',
      display_name: currentUser?.display_name || '',
      currency_code: currentUser?.currency_code || 'INR',
      locale_code: currentUser?.locale_code || 'en-IN',
      time_zone: currentUser?.time_zone || 'Asia/Kolkata',
    },
    as_of: summary?.as_of || new Date().toISOString().slice(0, 10),
    current_month: summary?.current_month || '',
    totals: {
      total_expense_current_month: Number(summary?.total_expense_current_month || 0),
      total_expense_current_year: Number(summary?.total_expense_current_year || 0),
      fair_spend_current_month: Number(summary?.fair_spend_current_month || 0),
      extra_spend_current_month: Number(summary?.extra_spend_current_month || 0),
      monthly_savings_current_month: Number(summary?.monthly_savings_current_month || 0),
      total_bank_balance: Number(summary?.total_bank_balance || 0),
      total_credit_card_due: Number(summary?.total_credit_card_due || 0),
      total_friend_balance: Number(summary?.total_friend_balance || 0),
      total_trip_spend: Number(summary?.total_trip_spend || 0),
    },
    expense_by_year: safeArray(summary?.expense_by_year, 12),
    expense_last_6_months: safeArray(summary?.expense_last_6_months, 12),
    expense_by_day: safeArray(summary?.expense_by_day, 45),
    expense_by_category: safeArray(summary?.expense_by_category, 20),
    recent_expenses: safeArray(summary?.recent_expenses, 60),
    friends_loan_summary: safeArray(summary?.friends_loan_summary, 40),
    emis: safeArray(summary?.emis, 40),
    credit_cards: safeArray(summary?.credit_cards, 20),
    bank_accounts: safeArray(summary?.bank_accounts, 20),
    active_trips: safeArray(summary?.active_trips, 20),
    recurring_defaults: safeArray(summary?.recurring_defaults, 30),
    current_month_planner: safeArray(summary?.current_month_planner, 40),
    petrol_divide_months: safeArray(summary?.petrol_divide_months, 18),
    petrol_by_day: safeArray(summary?.petrol_by_day, 45),
    petrol_recent_entries: safeArray(summary?.petrol_recent_entries, 60),
    live_split_balances: safeArray(summary?.live_split_balances, 40),
    live_split_recent_groups: safeArray(summary?.live_split_recent_groups, 40),
    live_split_trips: safeArray(summary?.live_split_trips, 20),
    daily_trackers: safeArray(summary?.daily_trackers, 40),
    habit_trackers: safeArray(summary?.habit_trackers, 40),
  };
}

function buildAiPetrolMonthSnapshot(monthData) {
  const entries = Array.isArray(monthData?.entries) ? monthData.entries : [];
  const byDayMap = new Map();
  entries.forEach((entry) => {
    const day = aiDateKeyValue(entry?.entry_date);
    if (!day) return;
    if (!byDayMap.has(day)) {
      byDayMap.set(day, {
        day,
        total_amount: 0,
        total_litres: 0,
        total_distance_km: 0,
        entry_count: 0,
      });
    }
    const row = byDayMap.get(day);
    row.total_amount = roundCurrencyAmount(row.total_amount + Number(entry?.amount_used || 0));
    row.total_litres = roundCurrencyAmount(row.total_litres + Number(entry?.petrol_used_litre || 0));
    row.total_distance_km = roundCurrencyAmount(row.total_distance_km + Number(entry?.distance_km || 0));
    row.entry_count += 1;
  });
  const petrolByDay = [...byDayMap.values()].sort((a, b) => String(b.day).localeCompare(String(a.day)));
  const petrolRecentEntries = entries.map((entry) => ({
    entry_date: aiDateKeyValue(entry?.entry_date),
    remarks: String(entry?.remarks || '').trim(),
    amount_used: roundCurrencyAmount(entry?.amount_used),
    petrol_used_litre: roundCurrencyAmount(entry?.petrol_used_litre),
    distance_km: roundCurrencyAmount(entry?.distance_km),
    average_kmpl: roundCurrencyAmount(entry?.average_kmpl),
    is_fake: !!entry?.is_fake,
  }));
  const totals = petrolByDay.reduce((acc, row) => ({
    total_amount: roundCurrencyAmount(acc.total_amount + Number(row.total_amount || 0)),
    total_litres: roundCurrencyAmount(acc.total_litres + Number(row.total_litres || 0)),
    total_distance_km: roundCurrencyAmount(acc.total_distance_km + Number(row.total_distance_km || 0)),
    entry_count: Number(acc.entry_count || 0) + Number(row.entry_count || 0),
  }), { total_amount: 0, total_litres: 0, total_distance_km: 0, entry_count: 0 });
  return {
    petrol_by_day: petrolByDay,
    petrol_recent_entries: petrolRecentEntries,
    petrol_month_snapshot: monthData?.month ? {
      month_key: String(monthData.month.month_key || ''),
      petrol_price: roundCurrencyAmount(monthData.month.petrol_price),
      total_amount: roundCurrencyAmount(totals.total_amount),
      total_litres: roundCurrencyAmount(totals.total_litres),
      total_distance_km: roundCurrencyAmount(totals.total_distance_km),
      entry_count: Number(totals.entry_count || 0),
    } : null,
  };
}

function buildAiLiveSplitSnapshot(userId, friends = [], groups = [], trips = []) {
  const meId = Number(userId || 0);
  const friendById = new Map((Array.isArray(friends) ? friends : []).map((friend) => [Number(friend.id), friend]));
  const balanceMap = new Map();
  const ensureBalance = (linkedUserId, fallbackName, friendId = null) => {
    const uid = Number(linkedUserId || 0);
    if (!(uid > 0) || uid === meId) return null;
    if (!balanceMap.has(uid)) {
      balanceMap.set(uid, {
        linked_user_id: uid,
        friend_id: Number(friendId || 0) || null,
        name: String(fallbackName || 'Friend').trim() || 'Friend',
        amount: 0,
      });
    }
    const row = balanceMap.get(uid);
    if (!row.friend_id && Number(friendId || 0) > 0) row.friend_id = Number(friendId);
    if ((!row.name || row.name === 'Friend') && fallbackName) row.name = String(fallbackName).trim() || row.name;
    return row;
  };

  (Array.isArray(groups) ? groups : []).forEach((group) => {
    const splits = Array.isArray(group?.splits) ? group.splits : [];
    const total = roundCurrencyAmount(group?.total_amount);
    const groupMode = String(group?.split_mode || '').trim().toLowerCase();
    const totalFriends = roundCurrencyAmount(splits.reduce((sum, split) => sum + Number(split?.share_amount || 0), 0));
    const selfShare = roundCurrencyAmount(total - totalFriends);
    const payerKey = String(group?.paid_by || '').trim().toLowerCase();
    const selfIsPayer = !splits.some((split) => String(split?.friend_name || '').trim().toLowerCase() === payerKey);

    splits.forEach((split) => {
      const linkedFriend = friendById.get(Number(split?.friend_id || 0));
      const linkedUserId = Number(split?.linked_user_id || linkedFriend?.linked_user_id || 0);
      const friendName = String(
        linkedFriend?.linked_user_display_name
        || linkedFriend?.linked_user_username
        || split?.friend_name
        || linkedFriend?.name
        || 'Friend'
      ).trim();
      const row = ensureBalance(linkedUserId, friendName, Number(split?.friend_id || linkedFriend?.id || 0));
      if (!row) return;
      const splitIsPayer = String(split?.friend_name || '').trim().toLowerCase() === payerKey
        || String(linkedFriend?.name || '').trim().toLowerCase() === payerKey;
      if (groupMode === 'settlement') {
        if (selfIsPayer) row.amount = roundCurrencyAmount(row.amount + Number(split?.share_amount || 0));
        else if (splitIsPayer) row.amount = roundCurrencyAmount(row.amount - Number(split?.share_amount || 0));
        return;
      }
      if (selfIsPayer) row.amount = roundCurrencyAmount(row.amount + Number(split?.share_amount || 0));
      else if (splitIsPayer && selfShare > 0) row.amount = roundCurrencyAmount(row.amount - selfShare);
    });
  });

  return {
    live_split_balances: [...balanceMap.values()]
      .map((row) => ({ ...row, amount: roundCurrencyAmount(row.amount) }))
      .sort((a, b) => Math.abs(Number(b.amount || 0)) - Math.abs(Number(a.amount || 0)) || String(a.name || '').localeCompare(String(b.name || ''))),
    live_split_recent_groups: (Array.isArray(groups) ? groups : []).slice(0, 40).map((group) => ({
      id: Number(group?.id || 0) || null,
      divide_date: aiDateKeyValue(group?.divide_date),
      details: String(group?.details || group?.heading || 'Live Split expense').trim(),
      paid_by: String(group?.paid_by || '').trim(),
      total_amount: roundCurrencyAmount(group?.total_amount),
      split_mode: String(group?.split_mode || '').trim().toLowerCase() || 'equal',
      split_count: Array.isArray(group?.splits) ? group.splits.length : 0,
    })),
    live_split_trips: (Array.isArray(trips) ? trips : []).slice(0, 20).map((trip) => ({
      id: Number(trip?.id || 0) || null,
      name: String(trip?.name || '').trim(),
      status: String(trip?.status || '').trim().toLowerCase(),
      total_amount: roundCurrencyAmount(trip?.total_amount),
      expense_count: Number(trip?.expense_count || 0),
      my_share_amount: roundCurrencyAmount(trip?.my_share_amount),
      latest_divide_date: aiDateKeyValue(trip?.latest_divide_date),
    })),
  };
}

async function enrichAiSummaryWithModules(userId, summary, question = '') {
  const currentMonth = String(summary?.current_month || new Date().toISOString().slice(0, 7));
  const dateKey = aiExtractDateKey(question, summary);
  const monthKey = aiExtractMonthKey(question, summary) || (dateKey ? dateKey.slice(0, 7) : currentMonth);
  const [habitYear, habitMonth] = String(monthKey || currentMonth).split('-').map(Number);

  const [
    petrolMonthsRaw,
    dailyTrackersRaw,
    habitTrackersRaw,
    liveSplitFriendsRaw,
    liveSplitGroupsRaw,
    liveSplitTripsRaw,
  ] = await Promise.all([
    Promise.resolve(pgPetrolDb.getPetrolDivideMonths(userId)).catch(() => []),
    Promise.resolve(pgOpsDb.getDailyTrackers(userId)).catch(() => []),
    Promise.resolve(pgOpsDb.getHabitTrackers(userId, habitYear, habitMonth)).catch(() => []),
    Promise.resolve(pgCoreDb.getLiveSplitFriends(userId)).catch(() => []),
    Promise.resolve(pgCoreDb.getLiveSplitGroups(userId)).catch(() => []),
    Promise.resolve(pgCoreDb.getLiveSplitTrips(userId)).catch(() => []),
  ]);

  const petrolMonths = (Array.isArray(petrolMonthsRaw) ? petrolMonthsRaw : []).slice(0, 18).map((row) => ({
    month_key: String(row?.month_key || ''),
    petrol_price: roundCurrencyAmount(row?.petrol_price),
    members_count: Number(row?.members_count || 0),
    entries_count: Number(row?.entries_count || 0),
    total_amount: roundCurrencyAmount(row?.total_amount),
  }));

  let petrolDetails = {};
  const targetPetrolMonth = petrolMonths.find((row) => String(row.month_key) === String(monthKey));
  if (targetPetrolMonth?.month_key) {
    const monthData = await Promise.resolve(pgPetrolDb.getPetrolDivideMonth(userId, targetPetrolMonth.month_key)).catch(() => null);
    if (monthData) petrolDetails = buildAiPetrolMonthSnapshot(monthData);
  }

  const liveSplitDetails = buildAiLiveSplitSnapshot(
    userId,
    Array.isArray(liveSplitFriendsRaw) ? liveSplitFriendsRaw : [],
    Array.isArray(liveSplitGroupsRaw) ? liveSplitGroupsRaw : [],
    Array.isArray(liveSplitTripsRaw) ? liveSplitTripsRaw : []
  );

  return {
    ...summary,
    petrol_divide_months: petrolMonths,
    petrol_by_day: Array.isArray(petrolDetails.petrol_by_day) ? petrolDetails.petrol_by_day : [],
    petrol_recent_entries: Array.isArray(petrolDetails.petrol_recent_entries) ? petrolDetails.petrol_recent_entries : [],
    petrol_month_snapshot: petrolDetails.petrol_month_snapshot || null,
    daily_trackers: (Array.isArray(dailyTrackersRaw) ? dailyTrackersRaw : []).slice(0, 40).map((tracker) => ({
      id: Number(tracker?.id || 0) || null,
      name: String(tracker?.name || '').trim(),
      unit: String(tracker?.unit || '').trim(),
      current_month_total: roundCurrencyAmount(tracker?.current_month_total),
      current_month_days: Number(tracker?.current_month_days || 0),
      price_per_unit: roundCurrencyAmount(tracker?.price_per_unit),
      auto_add_to_expense: !!tracker?.auto_add_to_expense,
      expense_category: String(tracker?.expense_category || '').trim(),
    })),
    habit_trackers: (Array.isArray(habitTrackersRaw) ? habitTrackersRaw : []).slice(0, 40).map((tracker) => ({
      id: Number(tracker?.id || 0) || null,
      name: String(tracker?.name || '').trim(),
      month_one_days: Number(tracker?.month_one_days || 0),
      month_total_days: Number(tracker?.month_total_days || 0),
      month_percent: roundCurrencyAmount(tracker?.month_percent),
      today_value: tracker?.today_value == null ? null : Number(tracker.today_value),
      is_active: !!tracker?.is_active,
    })),
    ...liveSplitDetails,
  };
}

function buildAiLookupFactBundle(question, summary, currentUser) {
  const q = String(question || '').trim();
  const normalized = q.toLowerCase();
  const tokens = aiTokens(q);
  const asksAboutExpense = aiHasAnyToken(tokens, ['expense', 'expenses', 'spend', 'spent', 'spending']);
  const asksAboutPetrol = aiHasAnyToken(tokens, ['petrol', 'fuel', 'diesel', 'kmpl', 'mileage', 'litre', 'litres', 'liter', 'liters']);
  const dateKey = aiExtractDateKey(q, summary);
  const monthKey = aiExtractMonthKey(q, summary);
  const recentExpenses = Array.isArray(summary?.recent_expenses) ? summary.recent_expenses : [];
  const recentPetrolEntries = Array.isArray(summary?.petrol_recent_entries) ? summary.petrol_recent_entries : [];
  const today = summary?.as_of || new Date().toISOString().slice(0, 10);

  if (asksAboutPetrol && dateKey) {
    const dayRow = aiFindPetrolDayRow(summary, dateKey);
    const rows = recentPetrolEntries
      .filter((row) => aiDateKeyValue(row?.entry_date) === aiDateKeyValue(dateKey))
      .slice(0, 20)
      .map((row) => ({
        remarks: row.remarks || '',
        amount_used: aiNum(row.amount_used),
        amount_label: aiCurrency(summary, currentUser, row.amount_used),
        petrol_used_litre: aiNum(row.petrol_used_litre),
        distance_km: aiNum(row.distance_km),
        entry_date: aiDateKeyValue(row.entry_date),
      }));
    return {
      query_type: 'petrol_by_day',
      found: !!dayRow,
      date: dateKey,
      date_label: aiDateLabel(dateKey),
      total_amount: dayRow ? aiNum(dayRow.total_amount) : 0,
      total_amount_label: dayRow ? aiCurrency(summary, currentUser, dayRow.total_amount) : '',
      total_litres: dayRow ? aiNum(dayRow.total_litres) : 0,
      total_distance_km: dayRow ? aiNum(dayRow.total_distance_km) : 0,
      entry_count: dayRow ? Number(dayRow.entry_count) || rows.length : rows.length,
      entries: rows,
    };
  }

  if (asksAboutPetrol && monthKey) {
    const monthRow = aiFindPetrolMonthRow(summary, monthKey);
    return {
      query_type: 'petrol_by_month',
      found: !!monthRow,
      month: monthKey,
      month_label: aiMonthLabel(monthKey),
      total_amount: monthRow ? aiNum(monthRow.total_amount) : 0,
      total_amount_label: monthRow ? aiCurrency(summary, currentUser, monthRow.total_amount) : '',
      total_litres: monthRow ? aiNum(monthRow.total_litres) : 0,
      total_distance_km: monthRow ? aiNum(monthRow.total_distance_km) : 0,
      entry_count: monthRow ? Number(monthRow.entry_count) || 0 : 0,
    };
  }

  if (asksAboutExpense && dateKey) {
    const dayRow = aiFindDayRow(summary, dateKey);
    const rows = recentExpenses
      .filter((row) => aiDateKeyValue(row?.purchase_date) === aiDateKeyValue(dateKey))
      .slice(0, 20)
      .map((row) => ({
        item_name: row.item_name || '',
        amount: aiNum(row.amount),
        amount_label: aiCurrency(summary, currentUser, row.amount),
        is_extra: !!row.is_extra,
        purchase_date: aiDateKeyValue(row.purchase_date),
      }));
    return {
      query_type: dateKey === today ? 'expense_today' : 'expense_by_day',
      found: !!dayRow,
      date: dateKey,
      date_label: aiDateLabel(dateKey),
      total: dayRow ? aiNum(dayRow.total) : 0,
      total_label: dayRow ? aiCurrency(summary, currentUser, dayRow.total) : '',
      transaction_count: dayRow ? Number(dayRow.count) || rows.length : rows.length,
      transactions: rows,
    };
  }

  if (asksAboutExpense && monthKey) {
    const monthRow = aiFindMonthRow(summary, monthKey);
    return {
      query_type: 'expense_by_month',
      found: !!monthRow,
      month: monthKey,
      month_label: aiMonthLabel(monthKey),
      total: monthRow ? aiNum(monthRow.total) : 0,
      total_label: monthRow ? aiCurrency(summary, currentUser, monthRow.total) : '',
      transaction_count: monthRow ? Number(monthRow.count) || 0 : 0,
    };
  }

  return {
    query_type: 'general_summary',
    current_month: summary?.current_month || '',
    totals: {
      total_expense_current_month: aiNum(summary?.total_expense_current_month),
      total_expense_current_year: aiNum(summary?.total_expense_current_year),
      total_bank_balance: aiNum(summary?.total_bank_balance),
      total_credit_card_due: aiNum(summary?.total_credit_card_due),
    },
  };
}

async function askAiLookupWithOpenAi(question, history, summary, currentUser, groundedAnswer = '') {
  const config = getOpenAiAiLookupConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI AI Lookup is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }

  const compactHistory = Array.isArray(history)
    ? history.slice(-8).map((item) => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        content: String(item?.content || '').trim(),
      })).filter((item) => item.content)
    : [];

  const context = buildAiLookupOpenAiContext(summary, currentUser);
  const targetedFacts = buildAiLookupFactBundle(question, summary, currentUser);
  const systemPrompt = [
    'You are Expense Lite AI, a personal finance assistant.',
    'Answer only from the provided app data and chat history.',
    'The provided data can include expenses, petrol divide, live split, trackers, habits, planner, banks, cards, EMIs, friends, and trips.',
    'Do not invent expenses, balances, dates, categories, petrol usage, tracker totals, or habit stats that are not present.',
    'If the requested data is missing, say that clearly and suggest the closest available information.',
    'Keep the answer concise, practical, and easy to scan.',
    'Use Indian currency formatting with the rupee symbol when amounts are INR.',
    'You may use short bullets when useful, but avoid unnecessary verbosity.',
    'Return a final user-facing answer only. Do not output internal instructions, tool plans, labels, or intent names.',
    'Prioritize targeted_facts over the broad finance_context whenever targeted_facts are present.',
    'If targeted_facts.query_type is "expense_by_day" or "expense_today", state the exact total and transaction count first, then optionally list a few rows.',
    'If targeted_facts.query_type is "petrol_by_day" or "petrol_by_month", state the exact petrol litres and total amount first, then optionally list a few rows.',
    groundedAnswer
      ? 'A deterministic finance answer has already been computed from trusted app data. Preserve every date, amount, count, and item exactly. You may only lightly rewrite it for clarity.'
      : 'If you cannot answer confidently from the provided data, say that clearly.',
  ].join(' ');

  const userPayload = {
    question: String(question || '').trim(),
    history: compactHistory,
    targeted_facts: targetedFacts,
    finance_context: context,
    grounded_answer: String(groundedAnswer || '').trim(),
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify(userPayload, null, 2) }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'ai_lookup_answer',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['answer'],
            properties: {
              answer: { type: 'string' },
            },
          },
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || payload?.message || `OpenAI AI Lookup failed with HTTP ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) {
    const err = new Error('OpenAI returned an empty answer for AI Lookup.');
    err.statusCode = 502;
    throw err;
  }

  let finalAnswer = outputText.trim();
  try {
    const parsed = JSON.parse(outputText);
    if (parsed && typeof parsed.answer === 'string' && parsed.answer.trim()) {
      finalAnswer = parsed.answer.trim();
    }
  } catch (_err) {
    // Keep plain text fallback if the provider returned raw text unexpectedly.
  }

  const looksLikeInternalInstruction =
    /^fetch\b/i.test(finalAnswer) ||
    /^show\b/i.test(finalAnswer) ||
    /^list\b/i.test(finalAnswer) ||
    /\bmentioned date\b/i.test(finalAnswer) ||
    /\bintent\b/i.test(finalAnswer);
  const shouldRequireExactGrounding = ['expense_by_day', 'expense_today', 'expense_by_month'].includes(String(targetedFacts?.query_type || ''));
  const missingExpectedFinanceDetail =
    shouldRequireExactGrounding &&
    groundedAnswer &&
    targetedFacts?.found &&
    !finalAnswer.includes(String(targetedFacts.total_label || ''));
  if (groundedAnswer && (looksLikeInternalInstruction || missingExpectedFinanceDetail)) {
    finalAnswer = String(groundedAnswer).trim();
  }

  return {
    answer: finalAnswer,
    model: config.model,
  };
}

async function parseExpenseMessageWithOpenAi(message, banks = [], cards = []) {
  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI parsing is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }

  const bankOptions = (banks || []).map((bank) => ({
    id: String(bank.id),
    label: `${bank.bank_name}${bank.account_name ? ` - ${bank.account_name}` : ''}`,
    bank_name: bank.bank_name || '',
    account_name: bank.account_name || '',
    is_default: !!bank.is_default,
  }));
  const cardOptions = (cards || []).map((card) => ({
    id: String(card.id),
    label: `${card.card_name} (${card.bank_name} **${card.last4})`,
    card_name: card.card_name || '',
    bank_name: card.bank_name || '',
    last4: String(card.last4 || ''),
    default_discount_pct: Number(card.default_discount_pct || 0),
  }));

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: [
      'item_name',
      'merchant',
      'amount',
      'purchase_date',
      'category',
      'source_type',
      'matched_bank_id',
      'matched_card_id',
      'card_discount_pct',
      'confidence',
      'notes',
    ],
    properties: {
      item_name: { type: 'string' },
      merchant: { type: 'string' },
      amount: { type: 'number' },
      purchase_date: { type: 'string' },
      category: { type: 'string' },
      source_type: { type: 'string', enum: ['bank', 'credit_card', 'none'] },
      matched_bank_id: { type: 'string' },
      matched_card_id: { type: 'string' },
      card_discount_pct: { type: 'number' },
      confidence: { type: 'number' },
      notes: { type: 'string' },
    },
  };

  const systemPrompt = [
    'You extract structured expense suggestions from spoken expense notes, typed expense descriptions, and bank, UPI, or credit card payment messages.',
    'Return only data that can help prefill an expense form.',
    'Treat outgoing spend/debit/purchase messages as expenses.',
    'If the user simply describes an expense in plain language, infer the most likely item name, amount, date, and category from that description.',
    'Use only the provided bank ids or card ids when matching a source. If unsure, return an empty string for the match id.',
    'If a credit card matches, prefer source_type "credit_card". Otherwise use "bank" when a bank account matches. Use "none" if no source matches.',
    'Keep purchase_date in YYYY-MM-DD format. If the exact date is missing, infer the most likely date from the message. If still missing, use today.',
    'If category is unclear, return an empty string.',
    'confidence should be between 0 and 100.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    message: String(message || ''),
    available_banks: bankOptions,
    available_cards: cardOptions,
  });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: 'system',
          content: [
            { type: 'input_text', text: systemPrompt },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userPrompt },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'smart_capture_parse',
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || payload?.message || `OpenAI request failed with HTTP ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) {
    const err = new Error('OpenAI returned an empty parse result.');
    err.statusCode = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_err) {
    const err = new Error('OpenAI returned invalid JSON for smart capture.');
    err.statusCode = 502;
    throw err;
  }

  const matchedBank = bankOptions.find((bank) => bank.id === String(parsed.matched_bank_id || '')) || null;
  const matchedCard = cardOptions.find((card) => card.id === String(parsed.matched_card_id || '')) || null;
  const sourceType = matchedCard ? 'credit_card' : (matchedBank ? 'bank' : 'none');

  return {
    raw_text: String(message || ''),
    parsed_text: normalizeSmartCaptureText(message),
    detected_type: sourceType === 'credit_card' ? 'credit_card' : 'bank',
    transaction_direction: 'debit',
    amount: Number(parsed.amount || 0) || 0,
    purchase_date: String(parsed.purchase_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    item_name: String(parsed.item_name || parsed.merchant || 'Payment').trim() || 'Payment',
    merchant: String(parsed.merchant || '').trim(),
    category: String(parsed.category || '').trim(),
    bank_account_id: matchedBank ? Number(matchedBank.id) : null,
    bank_label: matchedBank ? matchedBank.label : '',
    card_id: matchedCard ? Number(matchedCard.id) : null,
    card_label: matchedCard ? matchedCard.label : '',
    card_discount_pct: matchedCard ? Number(parsed.card_discount_pct || matchedCard.default_discount_pct || 0) : 0,
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence || 0) || 0)),
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: 'openai',
    ai_notes: String(parsed.notes || '').trim(),
  };
}

async function transcribeAudioWithOpenAi(file) {
  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI voice parsing is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }
  if (!file?.buffer || !file?.originalname) {
    const err = new Error('Audio file is required.');
    err.statusCode = 400;
    throw err;
  }

  const model = String(
    process.env.OPENAI_WHISPER_MODEL ||
    process.env.OPENAI_TRANSCRIBE_MODEL ||
    'whisper-1'
  ).trim();
  const form = new FormData();
  const blob = new Blob([file.buffer], { type: String(file.mimetype || 'application/octet-stream') });
  form.append('file', blob, String(file.originalname || 'expense-voice.webm'));
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('prompt', 'Translate the spoken expense note into English while preserving merchant names, dates, amounts, and payment sources accurately.');

  const response = await fetch('https://api.openai.com/v1/audio/translations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || payload?.message || `OpenAI transcription failed with HTTP ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  const transcript = String(payload?.text || '').trim();
  if (!transcript) {
    const err = new Error('OpenAI returned an empty transcript.');
    err.statusCode = 502;
    throw err;
  }
  return transcript;
}

function isSupportedAudioUpload(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  const name = String(file?.originalname || '').toLowerCase();
  if (mime.startsWith('audio/')) return true;
  return ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg'].some((ext) => name.endsWith(ext));
}

function normalizeMatchText(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function getMatchTokens(value) {
  return normalizeMatchText(value).split(' ').filter((token) => token.length > 1);
}

function scoreTokenOverlap(sourceTokens = [], candidateTokens = []) {
  if (!sourceTokens.length || !candidateTokens.length) return 0;
  const sourceSet = new Set(sourceTokens);
  let score = 0;
  candidateTokens.forEach((token) => {
    if (sourceSet.has(token)) score += token.length >= 5 ? 2 : 1;
  });
  return score;
}

function guessBankMatchFromText(text, bankOptions = []) {
  const source = normalizeMatchText(text);
  const sourceTokens = getMatchTokens(text);
  if (!source) return null;
  let best = null;
  let bestScore = 0;
  for (const bank of bankOptions) {
    const bankName = normalizeMatchText(bank.bank_name);
    const accountName = normalizeMatchText(bank.account_name);
    const label = normalizeMatchText(bank.label);
    let score = 0;
    if (bankName && source.includes(bankName)) score += 3;
    if (accountName && source.includes(accountName)) score += 2;
    if (label && source.includes(label)) score += 1;
    score += scoreTokenOverlap(sourceTokens, getMatchTokens(`${bank.bank_name || ''} ${bank.account_name || ''} ${bank.label || ''}`));
    if (score > bestScore) {
      best = bank;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function guessCardMatchFromText(text, cardOptions = []) {
  const source = normalizeMatchText(text);
  const sourceTokens = getMatchTokens(text);
  if (!source) return null;
  let best = null;
  let bestScore = 0;
  for (const card of cardOptions) {
    const cardName = normalizeMatchText(card.card_name);
    const bankName = normalizeMatchText(card.bank_name);
    const label = normalizeMatchText(card.label);
    const last4 = String(card.last4 || '').trim();
    let score = 0;
    if (cardName && source.includes(cardName)) score += 3;
    if (bankName && source.includes(bankName)) score += 2;
    if (label && source.includes(label)) score += 2;
    if (last4 && source.includes(last4)) score += 1;
    score += scoreTokenOverlap(sourceTokens, getMatchTokens(`${card.card_name || ''} ${card.bank_name || ''} ${card.label || ''}`));
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function normalizeVoiceExpenseDate(value) {
  const cleaned = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : new Date().toISOString().slice(0, 10);
}

function normalizeVoiceExpenseEntry(raw, transcript, bankOptions = [], cardOptions = []) {
  const lineText = [
    raw?.item_name,
    raw?.merchant,
    raw?.notes,
    transcript,
  ].filter(Boolean).join(' ');
  const explicitBank = bankOptions.find((bank) => bank.id === String(raw?.matched_bank_id || '')) || null;
  const explicitCard = cardOptions.find((card) => card.id === String(raw?.matched_card_id || '')) || null;
  const guessedCard = explicitCard || guessCardMatchFromText(lineText, cardOptions);
  const guessedBank = explicitBank || (!guessedCard ? guessBankMatchFromText(lineText, bankOptions) : null);
  const sourceType = guessedCard
    ? 'credit_card'
    : guessedBank
      ? 'bank'
      : String(raw?.source_type || '').trim().toLowerCase() === 'credit_card'
        ? 'credit_card'
        : String(raw?.source_type || '').trim().toLowerCase() === 'bank'
          ? 'bank'
          : 'none';
  const inferredExtra = /\b(extra|non essential|non-essential|luxury|treat as extra|mark as extra)\b/i.test(lineText);
  return {
    item_name: String(raw?.item_name || raw?.merchant || 'Expense').trim() || 'Expense',
    merchant: String(raw?.merchant || '').trim(),
    amount: Math.round((Number(raw?.amount || 0) || 0) * 100) / 100,
    purchase_date: normalizeVoiceExpenseDate(raw?.purchase_date),
    category: String(raw?.category || '').trim(),
    is_extra: !!raw?.is_extra || inferredExtra,
    source_type: sourceType,
    bank_account_id: guessedBank ? Number(guessedBank.id) : null,
    bank_label: guessedBank ? guessedBank.label : '',
    card_id: guessedCard ? Number(guessedCard.id) : null,
    card_label: guessedCard ? guessedCard.label : '',
    card_discount_pct: guessedCard ? Number(raw?.card_discount_pct || guessedCard.default_discount_pct || 0) : 0,
    confidence: Math.max(0, Math.min(100, Number(raw?.confidence || 0) || 0)),
    ai_notes: String(raw?.notes || '').trim(),
  };
}

async function parseVoiceExpenseEntriesWithOpenAi(message, banks = [], cards = []) {
  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI parsing is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }

  const bankOptions = (banks || []).map((bank) => ({
    id: String(bank.id),
    label: `${bank.bank_name}${bank.account_name ? ` - ${bank.account_name}` : ''}`,
    bank_name: bank.bank_name || '',
    account_name: bank.account_name || '',
    is_default: !!bank.is_default,
  }));
  const cardOptions = (cards || []).map((card) => ({
    id: String(card.id),
    label: `${card.card_name} (${card.bank_name} **${card.last4})`,
    card_name: card.card_name || '',
    bank_name: card.bank_name || '',
    last4: String(card.last4 || ''),
    default_discount_pct: Number(card.default_discount_pct || 0),
  }));

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['entries', 'notes'],
    properties: {
      notes: { type: 'string' },
      entries: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'item_name',
            'merchant',
            'amount',
            'purchase_date',
            'category',
            'is_extra',
            'source_type',
            'matched_bank_id',
            'matched_card_id',
            'card_discount_pct',
            'confidence',
            'notes',
          ],
          properties: {
            item_name: { type: 'string' },
            merchant: { type: 'string' },
            amount: { type: 'number' },
            purchase_date: { type: 'string' },
            category: { type: 'string' },
            is_extra: { type: 'boolean' },
            source_type: { type: 'string', enum: ['bank', 'credit_card', 'none'] },
            matched_bank_id: { type: 'string' },
            matched_card_id: { type: 'string' },
            card_discount_pct: { type: 'number' },
            confidence: { type: 'number' },
            notes: { type: 'string' },
          },
        },
      },
    },
  };

  const systemPrompt = [
    'You extract one or more structured expense entries from a spoken expense note.',
    'Return only data that can help prefill expense forms.',
    'If the user mentions multiple expenses, return one entry per expense item in order.',
    'Always translate the user meaning into English in item_name, merchant, category, and notes while preserving brand names and proper nouns.',
    'Capture whether the user explicitly marks an item as extra or non-essential.',
    'Use only the provided bank ids or card ids when matching a payment source. If unsure, return an empty string.',
    'If a credit card matches, prefer source_type "credit_card". Otherwise use "bank" when a bank account matches. Use "none" if no source matches.',
    'Keep purchase_date in YYYY-MM-DD format. If not stated, use today.',
    'If category is unclear, return an empty string.',
    'confidence should be between 0 and 100.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    voice_note_transcript: String(message || ''),
    available_banks: bankOptions,
    available_cards: cardOptions,
  });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'voice_expense_entries',
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || payload?.message || `OpenAI voice parse failed with HTTP ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) {
    const err = new Error('OpenAI returned an empty voice parse result.');
    err.statusCode = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_err) {
    const err = new Error('OpenAI returned invalid JSON for voice expense parsing.');
    err.statusCode = 502;
    throw err;
  }

  const entries = (Array.isArray(parsed?.entries) ? parsed.entries : [])
    .map((entry) => normalizeVoiceExpenseEntry(entry, message, bankOptions, cardOptions))
    .filter((entry) => entry.item_name && Number(entry.amount || 0) > 0);

  if (!entries.length) {
    const err = new Error('Voice parse did not find any valid expense entries.');
    err.statusCode = 422;
    throw err;
  }

  return {
    transcript: String(message || '').trim(),
    notes: String(parsed?.notes || '').trim(),
    suggestions: entries,
    suggestion: entries[0],
  };
}

function normalizeExistingVoiceEntries(entries = [], bankOptions = [], cardOptions = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeVoiceExpenseEntry({
      item_name: entry?.item_name,
      merchant: entry?.merchant,
      amount: entry?.amount,
      purchase_date: entry?.purchase_date,
      category: entry?.category,
      is_extra: entry?.is_extra,
      source_type: entry?.source_type,
      matched_bank_id: entry?.bank_account_id ? String(entry.bank_account_id) : '',
      matched_card_id: entry?.card_id ? String(entry.card_id) : '',
      card_discount_pct: entry?.card_discount_pct,
      confidence: entry?.confidence,
      notes: entry?.ai_notes || entry?.notes || '',
    }, `${entry?.item_name || ''} ${entry?.merchant || ''}`, bankOptions, cardOptions))
    .filter((entry) => entry.item_name && Number(entry.amount || 0) > 0);
}

function cloneVoiceEntry(entry) {
  return {
    ...entry,
    amount: Math.round((Number(entry?.amount || 0) || 0) * 100) / 100,
    purchase_date: normalizeVoiceExpenseDate(entry?.purchase_date),
    is_extra: !!entry?.is_extra,
    bank_account_id: entry?.bank_account_id ? Number(entry.bank_account_id) : null,
    card_id: entry?.card_id ? Number(entry.card_id) : null,
    card_discount_pct: Number(entry?.card_discount_pct || 0) || 0,
    source_type: String(entry?.source_type || '').trim().toLowerCase() || 'none',
  };
}

function getVoiceEditTargets(message, entries = []) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return [];
  const ordinalMap = {
    first: 0, '1st': 0, one: 0,
    second: 1, '2nd': 1, two: 1,
    third: 2, '3rd': 2, three: 2,
    fourth: 3, '4th': 3, four: 3,
    fifth: 4, '5th': 4, five: 4,
  };
  for (const [token, index] of Object.entries(ordinalMap)) {
    if (text.includes(token) && entries[index]) return [index];
  }
  const matches = [];
  const textTokens = getMatchTokens(text);
  entries.forEach((entry, index) => {
    const name = String(entry?.item_name || entry?.merchant || '').trim().toLowerCase();
    if (!name) return;
    if (text.includes(name)) {
      matches.push(index);
      return;
    }
    const nameTokens = getMatchTokens(name);
    const overlap = scoreTokenOverlap(textTokens, nameTokens);
    if (overlap >= Math.max(2, Math.min(3, nameTokens.length))) matches.push(index);
  });
  return matches;
}

function applyHeuristicVoiceExpenseEdit(message, currentEntries = [], banks = [], cards = []) {
  const text = String(message || '').trim().toLowerCase();
  const entries = (Array.isArray(currentEntries) ? currentEntries : []).map(cloneVoiceEntry);
  if (!text || !entries.length) return null;

  const asksExtra = /\b(extra|non essential|non-essential|mark as extra|convert .* extra|make .* extra)\b/i.test(text);
  const asksFair = /\b(fair|regular|essential|not extra|mark as fair|convert .* fair|make .* fair)\b/i.test(text);
  const mentionsCard = /\b(card|credit card)\b/i.test(text);
  const mentionsBank = /\b(bank|account)\b/i.test(text);
  const explicitAll = /\b(all|every|everything|all of them|all expenses)\b/i.test(text);
  const matchedTargets = getVoiceEditTargets(text, entries);
  const targets = explicitAll
    ? entries.map((_, index) => index)
    : matchedTargets.length
      ? matchedTargets
      : entries.length === 1
        ? [0]
        : [];
  const guessedCard = mentionsCard ? guessCardMatchFromText(text, cards) : null;
  const guessedBank = !guessedCard && mentionsBank ? guessBankMatchFromText(text, banks) : null;

  if (!targets.length) return null;
  if (!asksExtra && !asksFair && !guessedCard && !guessedBank && !mentionsCard && !mentionsBank) return null;

  const updated = entries.map((entry, index) => {
    if (!targets.includes(index)) return entry;
    const next = { ...entry };
    if (asksExtra) next.is_extra = true;
    if (asksFair) next.is_extra = false;
    if (guessedCard) {
      next.source_type = 'credit_card';
      next.card_id = Number(guessedCard.id);
      next.card_label = guessedCard.label;
      next.card_discount_pct = Number(guessedCard.default_discount_pct || next.card_discount_pct || 0);
      next.bank_account_id = null;
      next.bank_label = '';
    } else if (guessedBank) {
      next.source_type = 'bank';
      next.bank_account_id = Number(guessedBank.id);
      next.bank_label = guessedBank.label;
      next.card_id = null;
      next.card_label = '';
      next.card_discount_pct = 0;
    } else if (mentionsCard && !guessedCard) {
      next.source_type = 'credit_card';
      next.bank_account_id = null;
      next.bank_label = '';
    } else if (mentionsBank && !guessedBank) {
      next.source_type = 'bank';
      next.card_id = null;
      next.card_label = '';
      next.card_discount_pct = 0;
    }
    return next;
  });

  return {
    transcript: String(message || '').trim(),
    notes: 'Applied heuristic voice edit command.',
    suggestions: updated,
    suggestion: updated[0],
  };
}

async function applyVoiceExpenseEditsWithOpenAi(message, currentEntries = [], banks = [], cards = []) {
  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI parsing is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }

  const bankOptions = (banks || []).map((bank) => ({
    id: String(bank.id),
    label: `${bank.bank_name}${bank.account_name ? ` - ${bank.account_name}` : ''}`,
    bank_name: bank.bank_name || '',
    account_name: bank.account_name || '',
    is_default: !!bank.is_default,
  }));
  const cardOptions = (cards || []).map((card) => ({
    id: String(card.id),
    label: `${card.card_name} (${card.bank_name} **${card.last4})`,
    card_name: card.card_name || '',
    bank_name: card.bank_name || '',
    last4: String(card.last4 || ''),
    default_discount_pct: Number(card.default_discount_pct || 0),
  }));
  const normalizedCurrent = normalizeExistingVoiceEntries(currentEntries, bankOptions, cardOptions);
  const heuristicResult = applyHeuristicVoiceExpenseEdit(message, normalizedCurrent, bankOptions, cardOptions);
  if (heuristicResult) return heuristicResult;

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['notes', 'entries'],
    properties: {
      notes: { type: 'string' },
      entries: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'item_name',
            'merchant',
            'amount',
            'purchase_date',
            'category',
            'is_extra',
            'source_type',
            'matched_bank_id',
            'matched_card_id',
            'card_discount_pct',
            'confidence',
            'notes',
          ],
          properties: {
            item_name: { type: 'string' },
            merchant: { type: 'string' },
            amount: { type: 'number' },
            purchase_date: { type: 'string' },
            category: { type: 'string' },
            is_extra: { type: 'boolean' },
            source_type: { type: 'string', enum: ['bank', 'credit_card', 'none'] },
            matched_bank_id: { type: 'string' },
            matched_card_id: { type: 'string' },
            card_discount_pct: { type: 'number' },
            confidence: { type: 'number' },
            notes: { type: 'string' },
          },
        },
      },
    },
  };

  const systemPrompt = [
    'You update an existing list of structured expense entries using a new spoken instruction.',
    'Always return the full final list after applying the instruction.',
    'The instruction may add new expenses, update all expenses, update one expense by order, or update by item name.',
    'Support commands such as mark all extra, make all fair, charge all to a specific bank, charge all to a credit card, or update only one matching expense.',
    'If the instruction refers to "first", "second", "third" or similar, apply it to that numbered expense in the current list.',
    'If the instruction names an item, update only that matching entry unless the user explicitly says all or multiple entries clearly share the same item name.',
    'If the instruction does not clearly identify a target and does not explicitly say all, preserve the current entries unchanged rather than applying the change to every entry.',
    'If the instruction adds new expenses, append them after the existing ones.',
    'Preserve all existing entries unless the instruction changes them.',
    'Always translate the user meaning into English in item_name, merchant, category, and notes while preserving brand names and proper nouns.',
    'Use only the provided bank ids or card ids when matching a payment source. If unsure, keep the existing source for unchanged items or return empty for new ones.',
    'Keep purchase_date in YYYY-MM-DD format.',
    'confidence should be between 0 and 100.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    voice_note_transcript: String(message || ''),
    current_entries: normalizedCurrent,
    available_banks: bankOptions,
    available_cards: cardOptions,
  });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'voice_expense_edits',
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || payload?.message || `OpenAI voice edit failed with HTTP ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) {
    const err = new Error('OpenAI returned an empty voice edit result.');
    err.statusCode = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_err) {
    const err = new Error('OpenAI returned invalid JSON for voice expense edits.');
    err.statusCode = 502;
    throw err;
  }

  const entries = (Array.isArray(parsed?.entries) ? parsed.entries : [])
    .map((entry) => normalizeVoiceExpenseEntry(entry, message, bankOptions, cardOptions))
    .filter((entry) => entry.item_name && Number(entry.amount || 0) > 0);

  if (!entries.length) {
    const fallbackResult = applyHeuristicVoiceExpenseEdit(message, normalizedCurrent, bankOptions, cardOptions);
    if (fallbackResult) return fallbackResult;
    const err = new Error('Voice edit did not leave any valid expense entries.');
    err.statusCode = 422;
    throw err;
  }

  return {
    transcript: String(message || '').trim(),
    notes: String(parsed?.notes || '').trim(),
    suggestions: entries,
    suggestion: entries[0],
  };
}

function normalizeLiveSplitPersonName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function inferLiveSplitDetailsFromTranscript(transcript = '') {
  const text = String(transcript || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const patterns = [
    /\b(?:for|on)\s+([a-z][a-z0-9 &'\/-]{2,60}?)(?=\s+(?:of|for|rs|rupees?|inr|paid|pay|divide|split|among|between|with|to|from|on|dated?)\b|[,.]|$)/i,
    /\b(?:add|create|record)\s+split\s+(?:for\s+)?([a-z][a-z0-9 &'\/-]{2,60}?)(?=\s+(?:of|for|rs|rupees?|inr|paid|pay|divide|split|among|between|with|to|from|on|dated?)\b|[,.]|$)/i,
    /\b(?:add|create|record)\s+trip\s+split\s+(?:for\s+)?([a-z][a-z0-9 &'\/-]{2,60}?)(?=\s+(?:of|for|rs|rupees?|inr|paid|pay|divide|split|among|between|with|to|from|on|dated?)\b|[,.]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = String(match?.[1] || '').trim().replace(/\s+/g, ' ');
    if (value && !/^(split|expense|shared split|trip split)$/i.test(value)) {
      return value.replace(/^(a|an|the)\s+/i, '').trim();
    }
  }
  return '';
}

function normalizeLiveSplitDetails(rawDetails, transcript = '') {
  const details = String(rawDetails || '').trim().replace(/\s+/g, ' ');
  if (details && !/^(split|split expense|shared split|expense|trip split)$/i.test(details)) return details;
  const inferred = inferLiveSplitDetailsFromTranscript(transcript);
  return inferred || 'Split expense';
}

function inferLiveSplitVoiceMode(rawMode, participantRows = [], totalAmount = 0) {
  const explicit = String(rawMode || '').trim().toLowerCase();
  const shares = (participantRows || [])
    .map((person) => Math.round((Number(person?.share_value || 0) || 0) * 100) / 100)
    .filter((value) => value >= 0);
  const validExplicit = ['equal', 'percent', 'fraction', 'amount', 'parts'].includes(explicit) ? explicit : '';
  if (shares.length > 1) {
    const first = shares[0];
    const allEqual = shares.every((value) => Math.abs(value - first) <= 0.009);
    if (allEqual) return 'equal';
  }
  const total = Math.round((Number(totalAmount || 0) || 0) * 100) / 100;
  const sum = Math.round(shares.reduce((acc, value) => acc + value, 0) * 100) / 100;
  if (shares.length && total > 0 && Math.abs(sum - total) <= 0.02) return 'amount';
  if (validExplicit) return validExplicit;
  return shares.length > 1 ? 'amount' : 'equal';
}

function defaultLiveSplitBank(bankOptions = []) {
  const defaults = (bankOptions || []).filter((bank) => !!bank?.is_default);
  if (defaults.length === 1) return defaults[0];
  if ((bankOptions || []).length === 1) return bankOptions[0];
  return defaults[0] || null;
}

function defaultLiveSplitCard(cardOptions = []) {
  return (cardOptions || []).length === 1 ? cardOptions[0] : null;
}

function inferLiveSplitAddToExpensePreference(text = '', currentValue = null) {
  const source = String(text || '').trim().toLowerCase();
  if (!source) return currentValue;
  if (/\b(live split only|dont add to expense|do not add to expense|without expense|no expense|dont track expense|do not track expense)\b/i.test(source)) return false;
  if (/\b(add to expense|track expense|include expense|add my share|my share to expense)\b/i.test(source)) return true;
  return currentValue;
}

function inferLiveSplitExpenseType(text = '', currentValue = 'fair') {
  const source = String(text || '').trim().toLowerCase();
  if (!source) return currentValue;
  if (/\b(extra|non essential|non-essential|luxury|treat as extra|mark as extra|make .* extra|convert .* extra)\b/i.test(source)) return 'extra';
  if (/\b(fair|regular|essential|not extra|mark as fair|make .* fair|convert .* fair)\b/i.test(source)) return 'fair';
  return currentValue;
}

function inferLiveSplitFinanceIntent(text = '') {
  const source = String(text || '').trim().toLowerCase();
  return {
    mentionsCard: /\b(card|credit card|cc)\b/i.test(source),
    mentionsBank: /\b(bank|bank account|account)\b/i.test(source),
  };
}

function cloneLiveSplitVoiceEntry(entry) {
  const next = entry && typeof entry === 'object' ? { ...entry } : {};
  return {
    ...next,
    total_amount: Math.round((Number(next?.total_amount || 0) || 0) * 100) / 100,
    addExpense: !!next?.addExpense,
    expense_type: String(next?.expense_type || '').toLowerCase() === 'extra' ? 'extra' : 'fair',
    finance_target: String(next?.finance_target || 'none'),
    bank_account_id: Number(next?.bank_account_id || 0) || null,
    card_id: Number(next?.card_id || 0) || null,
    card_discount_pct: Number(next?.card_discount_pct || 0) || 0,
  };
}

function getLiveSplitVoiceEditTargets(message, entries = []) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return [];
  const ordinalMap = {
    first: 0, '1st': 0, one: 0,
    second: 1, '2nd': 1, two: 1,
    third: 2, '3rd': 2, three: 2,
    fourth: 3, '4th': 3, four: 3,
    fifth: 4, '5th': 4, five: 4,
  };
  for (const [token, index] of Object.entries(ordinalMap)) {
    if (text.includes(token) && entries[index]) return [index];
  }
  const matches = [];
  entries.forEach((entry, index) => {
    const name = String(entry?.details || entry?.trip_name || '').trim().toLowerCase();
    if (name && text.includes(name)) matches.push(index);
  });
  return matches;
}

function applyHeuristicLiveSplitVoiceEdit(message, currentEntries = [], bankOptions = [], cardOptions = []) {
  const text = String(message || '').trim();
  const entries = (Array.isArray(currentEntries) ? currentEntries : []).map(cloneLiveSplitVoiceEntry);
  if (!text || !entries.length) return null;

  const nextAddExpense = inferLiveSplitAddToExpensePreference(text, null);
  const nextExpenseType = inferLiveSplitExpenseType(text, null);
  const { mentionsCard, mentionsBank } = inferLiveSplitFinanceIntent(text);
  const guessedCard = mentionsCard ? (guessCardMatchFromText(text, cardOptions) || defaultLiveSplitCard(cardOptions)) : null;
  const guessedBank = !guessedCard && mentionsBank ? (guessBankMatchFromText(text, bankOptions) || defaultLiveSplitBank(bankOptions)) : null;
  const appliesAll = /\b(all|every|everything|all of them)\b/i.test(text) || (!getLiveSplitVoiceEditTargets(text, entries).length);
  const targets = appliesAll ? entries.map((_, index) => index) : getLiveSplitVoiceEditTargets(text, entries);

  if (!targets.length) return null;
  if (nextAddExpense === null && !nextExpenseType && !mentionsCard && !mentionsBank && !guessedCard && !guessedBank) return null;

  const updated = entries.map((entry, index) => {
    if (!targets.includes(index)) return entry;
    const next = { ...entry };
    if (nextAddExpense !== null) next.addExpense = nextAddExpense;
    if (nextExpenseType) next.expense_type = nextExpenseType;
    if (guessedCard) {
      next.finance_target = 'card';
      next.card_id = Number(guessedCard.id);
      next.card_discount_pct = Number(guessedCard.default_discount_pct || next.card_discount_pct || 0);
      next.bank_account_id = null;
    } else if (guessedBank) {
      next.finance_target = 'expense';
      next.bank_account_id = Number(guessedBank.id);
      next.card_id = null;
      next.card_discount_pct = 0;
    } else if (mentionsCard) {
      next.finance_target = 'card';
    } else if (mentionsBank) {
      next.finance_target = 'expense';
    }
    return next;
  });

  return {
    transcript: String(message || '').trim(),
    notes: 'Applied heuristic live split voice edit command.',
    suggestions: updated,
    suggestion: updated[0],
  };
}

function buildLiveSplitFriendOptions(friends = []) {
  return (friends || []).map((friend) => ({
    id: Number(friend.id),
    name: normalizeLiveSplitPersonName(friend.name || 'Friend'),
    linked_user_id: Number(friend.linked_user_id || 0) || null,
  }));
}

function buildLiveSplitTripOptions(trips = []) {
  return (trips || []).map((trip) => ({
    id: Number(trip.id),
    name: String(trip.name || '').trim(),
    start_date: normalizeVoiceExpenseDate(trip.start_date),
    end_date: trip.end_date ? normalizeVoiceExpenseDate(trip.end_date) : '',
    show_add_to_expense_option: trip.show_add_to_expense_option !== false,
    members: (trip.members || []).map((member) => normalizeLiveSplitPersonName(member.member_name || '')).filter(Boolean),
  }));
}

function findLiveSplitFriendByName(name, options = []) {
  const target = normalizeLiveSplitPersonName(name).toLowerCase();
  if (!target) return null;
  return options.find((friend) => normalizeLiveSplitPersonName(friend.name).toLowerCase() === target)
    || options.find((friend) => target.includes(normalizeLiveSplitPersonName(friend.name).toLowerCase()) || normalizeLiveSplitPersonName(friend.name).toLowerCase().includes(target))
    || null;
}

function findLiveSplitTripByName(name, options = []) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  return options.find((trip) => String(trip.name || '').trim().toLowerCase() === target)
    || options.find((trip) => target.includes(String(trip.name || '').trim().toLowerCase()) || String(trip.name || '').trim().toLowerCase().includes(target))
    || null;
}

function extractMentionedLiveSplitFriendIds(message, options = []) {
  const text = normalizeLiveSplitPersonName(message).toLowerCase();
  if (!text) return new Set();
  const mentioned = new Set();
  (options || []).forEach((friend) => {
    const name = normalizeLiveSplitPersonName(friend?.name || '').toLowerCase();
    if (!name) return;
    const first = name.split(' ')[0] || '';
    if (text.includes(name) || (first && first.length > 2 && text.includes(first))) {
      mentioned.add(Number(friend.id));
    }
  });
  return mentioned;
}

function normalizeLiveSplitVoiceDraft(raw, context = {}) {
  const {
    friendOptions = [],
    tripOptions = [],
    bankOptions = [],
    cardOptions = [],
    preferredFriendId = null,
    preferredTripId = null,
    mentionedFriendIds = new Set(),
    transcript = '',
  } = context;
  const combinedText = [
    raw?.details,
    raw?.notes,
    raw?.bank_name,
    raw?.card_name,
    raw?.category,
    transcript,
  ].filter(Boolean).join(' ');
  const participants = Array.isArray(raw?.participants) ? raw.participants : [];
  let splitValues = {};
  let selectedKeys = new Set(['self']);
  let participantRows = participants.map((person) => {
    const name = normalizeLiveSplitPersonName(person?.name || '');
    const matchedFriend = name && name.toLowerCase() !== 'me' && name.toLowerCase() !== 'self' && name.toLowerCase() !== 'you'
      ? findLiveSplitFriendByName(name, friendOptions)
      : null;
    const key = matchedFriend ? String(matchedFriend.id) : 'self';
    if (key) selectedKeys.add(key);
    if (key && person?.share_value != null) splitValues[key] = Number(person.share_value || 0);
    return {
      key,
      name: key === 'self' ? 'You' : (matchedFriend?.name || name || 'Friend'),
      share_value: Number(person?.share_value || 0),
    };
  });
  const preferredFriend = Number(preferredFriendId || 0) > 0
    ? friendOptions.find((friend) => Number(friend.id) === Number(preferredFriendId))
    : null;
  const nonSelfParticipants = participantRows.filter((person) => String(person.key) !== 'self');
  if (preferredFriend && (!mentionedFriendIds || !mentionedFriendIds.size)) {
    if (!nonSelfParticipants.length) {
      participantRows.push({
        key: String(preferredFriend.id),
        name: preferredFriend.name,
        share_value: 0,
      });
      selectedKeys.add(String(preferredFriend.id));
      splitValues[String(preferredFriend.id)] = 0;
    } else if (nonSelfParticipants.length === 1 && String(nonSelfParticipants[0].key) !== String(preferredFriend.id)) {
      const oldKey = String(nonSelfParticipants[0].key);
      const nextKey = String(preferredFriend.id);
      const shareValue = Number(nonSelfParticipants[0].share_value || 0);
      participantRows = participantRows.map((person) => (
        String(person.key) === oldKey
          ? { ...person, key: nextKey, name: preferredFriend.name, share_value: shareValue }
          : person
      ));
      selectedKeys.delete(oldKey);
      selectedKeys.add(nextKey);
      delete splitValues[oldKey];
      splitValues[nextKey] = shareValue;
    } else if (nonSelfParticipants.length > 1) {
      const nextKey = String(preferredFriend.id);
      const explicitMode = String(raw?.split_mode || '').trim().toLowerCase();
      const totalAmount = Math.round((Number(raw?.total_amount || 0) || 0) * 100) / 100;
      let preferredShare = Number(nonSelfParticipants[0]?.share_value || 0);
      if (totalAmount > 0 && ['equal', 'percent', 'fraction', 'parts'].includes(explicitMode)) {
        preferredShare = Math.round((totalAmount / 2) * 100) / 100;
      }
      participantRows = [
        { key: 'self', name: 'You', share_value: Math.max(0, Math.round((totalAmount - preferredShare) * 100) / 100) },
        { key: nextKey, name: preferredFriend.name, share_value: preferredShare },
      ];
      selectedKeys = new Set(['self', nextKey]);
      splitValues = { [nextKey]: preferredShare };
    }
  }
  const trip = raw?.trip_name
    ? findLiveSplitTripByName(raw.trip_name, tripOptions)
    : (Number(preferredTripId || 0) > 0 ? tripOptions.find((item) => Number(item.id) === Number(preferredTripId)) : null);
  const payerName = normalizeLiveSplitPersonName(raw?.paid_by_name || '');
  const payerFriend = payerName && !['me', 'self', 'you'].includes(payerName.toLowerCase()) ? findLiveSplitFriendByName(payerName, friendOptions) : null;
  const exactCard = raw?.card_name ? guessCardMatchFromText(raw.card_name, cardOptions) : null;
  const exactBank = raw?.bank_name ? guessBankMatchFromText(raw.bank_name, bankOptions) : null;
  const { mentionsCard, mentionsBank } = inferLiveSplitFinanceIntent(combinedText);
  const matchedCard = exactCard || guessCardMatchFromText(combinedText, cardOptions) || (mentionsCard ? defaultLiveSplitCard(cardOptions) : null);
  const matchedBank = !matchedCard
    ? (exactBank || guessBankMatchFromText(combinedText, bankOptions) || (mentionsBank ? defaultLiveSplitBank(bankOptions) : null))
    : null;
  const normalizedTotalAmount = Math.round((Number(raw?.total_amount || 0) || 0) * 100) / 100;
  const normalizedSplitMode = inferLiveSplitVoiceMode(raw?.split_mode, participantRows, normalizedTotalAmount);
  const inferredAddExpense = inferLiveSplitAddToExpensePreference(combinedText, !!raw?.add_to_expense);
  const inferredExpenseType = inferLiveSplitExpenseType(combinedText, String(raw?.expense_type || '').toLowerCase() === 'extra' ? 'extra' : 'fair');
  return {
    details: normalizeLiveSplitDetails(raw?.details, transcript),
    divide_date: normalizeVoiceExpenseDate(raw?.divide_date),
    total_amount: normalizedTotalAmount,
    paid_by: payerFriend ? payerFriend.name : (['me', 'self', 'you'].includes(payerName.toLowerCase()) ? 'You' : (payerName || 'You')),
    paid_by_key: payerFriend ? String(payerFriend.id) : 'self',
    split_mode: normalizedSplitMode,
    selected_keys: [...selectedKeys],
    split_values: splitValues,
    addExpense: !!inferredAddExpense,
    expense_type: inferredExpenseType,
    category: String(raw?.category || '').trim(),
    finance_target: matchedCard ? 'card' : matchedBank ? 'expense' : mentionsCard ? 'card' : mentionsBank ? 'expense' : 'none',
    bank_account_id: matchedBank ? Number(matchedBank.id) : null,
    card_id: matchedCard ? Number(matchedCard.id) : null,
    card_discount_pct: matchedCard ? Number(raw?.card_discount_pct || matchedCard.default_discount_pct || 0) : 0,
    trip_id: trip ? Number(trip.id) : null,
    trip_name: trip ? trip.name : String(raw?.trip_name || '').trim(),
    notes: String(raw?.notes || '').trim(),
    participants: participantRows,
  };
}

function normalizeLiveSplitTripDraft(raw, context = {}) {
  const friendOptions = context.friendOptions || [];
  const members = Array.isArray(raw?.members) ? raw.members : [];
  const selected = [...new Set(members
    .map((name) => findLiveSplitFriendByName(name, friendOptions))
    .filter(Boolean)
    .map((friend) => String(friend.id)))];
  const unresolvedMemberNames = [...new Set(members
    .map((name) => normalizeLiveSplitPersonName(name))
    .filter(Boolean)
    .filter((name) => !['you', 'me', 'self'].includes(name.toLowerCase()))
    .filter((name) => !findLiveSplitFriendByName(name, friendOptions)))];
  return {
    name: String(raw?.name || 'Trip').trim() || 'Trip',
    start_date: normalizeVoiceExpenseDate(raw?.start_date),
    end_date: raw?.end_date ? normalizeVoiceExpenseDate(raw.end_date) : '',
    show_add_to_expense_option: raw?.show_add_to_expense_option !== false,
    selected,
    member_names: members.map((name) => normalizeLiveSplitPersonName(name)).filter(Boolean),
    unresolved_member_names: unresolvedMemberNames,
    notes: String(raw?.notes || '').trim(),
  };
}

async function parseLiveSplitVoiceWithOpenAi({ message, mode = 'split', currentEntries = [], friendOptions = [], tripOptions = [], bankOptions = [], cardOptions = [], preferredFriendId = null, preferredTripId = null, preselectedFriendIds = [] }) {
  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI parsing is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }
  const isTripMode = mode === 'trip';
  const schema = isTripMode
    ? {
        type: 'object',
        additionalProperties: false,
        required: ['notes', 'entries'],
        properties: {
          notes: { type: 'string' },
          entries: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'start_date', 'end_date', 'show_add_to_expense_option', 'members', 'notes'],
              properties: {
                name: { type: 'string' },
                start_date: { type: 'string' },
                end_date: { type: 'string' },
                show_add_to_expense_option: { type: 'boolean' },
                members: { type: 'array', items: { type: 'string' } },
                notes: { type: 'string' },
              },
            },
          },
        },
      }
    : {
        type: 'object',
        additionalProperties: false,
        required: ['notes', 'entries'],
        properties: {
          notes: { type: 'string' },
          entries: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['details', 'divide_date', 'total_amount', 'paid_by_name', 'split_mode', 'participants', 'add_to_expense', 'expense_type', 'category', 'bank_name', 'card_name', 'card_discount_pct', 'trip_name', 'notes'],
              properties: {
                details: { type: 'string' },
                divide_date: { type: 'string' },
                total_amount: { type: 'number' },
                paid_by_name: { type: 'string' },
                split_mode: { type: 'string' },
                participants: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'share_value'],
                    properties: {
                      name: { type: 'string' },
                      share_value: { type: 'number' },
                    },
                  },
                },
                add_to_expense: { type: 'boolean' },
                expense_type: { type: 'string' },
                category: { type: 'string' },
                bank_name: { type: 'string' },
                card_name: { type: 'string' },
                card_discount_pct: { type: 'number' },
                trip_name: { type: 'string' },
                notes: { type: 'string' },
              },
            },
          },
        },
      };
  const systemPrompt = isTripMode
    ? [
        'You convert spoken instructions into one or more live-split trip drafts.',
        'Always translate the meaning into English.',
        'If current entries are provided, treat the new voice note as instructions to update that trip draft list and return the full final list.',
        'Support adding trips, changing dates, changing members, and changing the add-my-share-to-expense option.',
        'If the user mentions multiple trips in one note, return one entry per trip.',
        'Keep dates in YYYY-MM-DD.',
      ].join(' ')
    : [
        'You convert spoken instructions into one or more live-split expense drafts.',
        'Always translate the meaning into English.',
        'If current entries are provided, treat the new voice note as instructions to update that split draft list and return the full final list.',
        'Always fill details with the actual spoken item or service name such as chicken, petrol, dinner, hotel, taxi, groceries, or ticket. Do not use generic labels like "Split expense" unless the user truly never mentioned any item.',
        'Support commands like paid by me, divide equally, divide by amount, divide by percent, fraction, parts, add to expense, fair or extra, bank, credit card, trip name, and date changes.',
        'If preferred_friend_id is provided because the user tapped a specific friend microphone and the transcript does not explicitly name a different friend, keep that friend in the split.',
        'If preferred_trip_id is provided and the transcript does not explicitly name another trip, keep the split under that trip.',
        'Use participant names exactly as normal readable English names.',
        'For participants, include You when the user says me/self/you.',
        'If current entries exist and the user says mark all extra/fair or charge all to bank/card, return the full updated list.',
        'If the user mentions multiple split items in one note, return one entry per split item.',
        'Keep dates in YYYY-MM-DD.',
      ].join(' ');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        {
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify({
            today: new Date().toISOString().slice(0, 10),
            mode,
            voice_note_transcript: String(message || ''),
            current_entries: currentEntries,
            preferred_friend_id: Number(preferredFriendId || 0) || null,
            preferred_trip_id: Number(preferredTripId || 0) || null,
            preselected_friend_ids: (Array.isArray(preselectedFriendIds) ? preselectedFriendIds : []).map((value) => Number(value)).filter((value) => value > 0),
            available_friends: friendOptions,
            available_trips: tripOptions,
            available_banks: bankOptions,
            available_cards: cardOptions,
          }) }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: isTripMode ? 'live_split_trip_voice' : 'live_split_split_voice',
          strict: true,
          schema,
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || payload?.message || `OpenAI live split voice parse failed with HTTP ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }
  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) {
    const err = new Error('OpenAI returned an empty live split voice parse result.');
    err.statusCode = 502;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_err) {
    const err = new Error('OpenAI returned invalid JSON for live split voice parsing.');
    err.statusCode = 502;
    throw err;
  }
  const mentionedFriendIds = extractMentionedLiveSplitFriendIds(message, friendOptions);
  const entries = (Array.isArray(parsed?.entries) ? parsed.entries : [])
    .map((entry) => isTripMode
      ? normalizeLiveSplitTripDraft(entry, { friendOptions })
      : normalizeLiveSplitVoiceDraft(entry, {
          friendOptions,
          tripOptions,
          bankOptions,
          cardOptions,
          preferredFriendId,
          preferredTripId,
          mentionedFriendIds,
          transcript: message,
        }))
    .filter((entry) => isTripMode ? !!entry.name : (!!entry.details && Number(entry.total_amount || 0) > 0));
  if (!entries.length) {
    const err = new Error('Voice parse did not find any valid live split entries.');
    err.statusCode = 422;
    throw err;
  }
  return {
    transcript: String(message || '').trim(),
    notes: String(parsed?.notes || '').trim(),
    suggestions: entries,
    suggestion: entries[0],
  };
}

async function parseReceiptDraftWithOpenAi(ocrText, imageBuffer = null, mimeType = 'image/jpeg') {
  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) return null;

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['merchant', 'purchase_date', 'total_amount', 'items', 'notes'],
    properties: {
      merchant: { type: 'string' },
      purchase_date: { type: 'string' },
      total_amount: { type: 'number' },
      notes: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['item_name', 'amount', 'purchase_date', 'category', 'is_extra', 'selected'],
          properties: {
            item_name: { type: 'string' },
            amount: { type: 'number' },
            purchase_date: { type: 'string' },
            category: { type: 'string' },
            is_extra: { type: 'boolean' },
            selected: { type: 'boolean' },
          },
        },
      },
    },
  };

  const systemPrompt = [
    'You are an expert receipt and bill extraction engine.',
    'Your job is to read the uploaded receipt image directly and return an exact, clean expense draft.',
    'Use OCR text only as supporting context. The image is the primary source of truth.',
    'Extract real purchased line items only.',
    'Ignore handwriting, blue pen notes, circles, arrows, totals-side scribbles, desk/background objects, and any second partial receipt visible beside the main receipt.',
    'Ignore member numbers, approval text, card details, references, invoice numbers, auth numbers, store footer text, and summary labels as expense items.',
    'When a receipt shows discount lines such as TPD/..., coupon rows, instant savings, promo lines, or negative discount rows, attach that discount to the immediately preceding purchased item.',
    'The returned item amount must always be the final net paid amount after discount, never the original pre-discount shelf amount.',
    'Example: if an item is 21.99 and the next receipt line is 4.50- for that item, return amount 17.49 for that item row.',
    'Preserve legitimate repeated purchases as separate rows when they appear multiple times on the receipt.',
    'If the same item name and same amount appear on separate printed rows, keep every occurrence as a separate item row.',
    'Example: if the receipt shows COTTAGE CHSE three times at 11.99, return three separate COTTAGE CHSE rows.',
    'Example: if the receipt shows KS GRK YGRT three times at 11.99, return three separate KS GRK YGRT rows.',
    'Example: if the receipt shows RAW CASHEWS twice at 16.99, return two separate RAW CASHEWS rows.',
    'Example: if the receipt shows a short code-like line such as 100%WWSNWCH 7.19 before subtotal, include it as a real item row.',
    'Do not deduplicate repeated items unless they are clearly the same physical printed row repeated by image overlap.',
    'If a later row repeats the same item name and the same amount, keep it again as another purchased line item.',
    'Read compact uppercase product-code descriptions carefully, including names that start with numbers or percent signs such as 100%WWSNWCH.',
    'Do not drop the last purchased line item before subtotal just because it is short, abbreviated, or code-like.',
    'Do not invent quantities, categories, or extra metadata not clearly supported by the receipt.',
    'For warehouse receipts like Costco, item descriptions may be abbreviated. Keep the printed description as-is but cleaned.',
    'Return total_amount only for the final receipt total, not subtotal or tax.',
    'Keep purchase_date in YYYY-MM-DD format. If the exact date is unreadable, infer the most likely full date from the receipt. If still unknown, return an empty string.',
    'Use category only when strongly obvious from the item text, otherwise return an empty string.',
    'Set is_extra to false by default unless the item is clearly non-essential.',
    'Set selected to true for every returned line item.',
    'If you cannot confidently read one character in a compact item code, prefer the closest printed item text instead of dropping the whole purchased line.',
    'If you cannot confidently read individual rows, return the best high-confidence rows only rather than guessing.',
  ].join(' ');

  const content = [
    {
      type: 'input_text',
      text: JSON.stringify({
        ocr_text: String(ocrText || ''),
      }),
    },
  ];

  if (imageBuffer?.length) {
    const base64Image = imageBuffer.toString('base64');
    content.push({
      type: 'input_image',
      image_url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}`,
      detail: 'high',
    });
  }

  const response = await postOpenAiResponseWithTimeout({
    model: getOpenAiReceiptScanModel(),
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'receipt_scan_parse',
        strict: true,
        schema,
      },
    },
  }, config.apiKey);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `OpenAI receipt parse failed with HTTP ${response.status}`);
  }

  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) return null;

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_err) {
    throw new Error('OpenAI returned invalid JSON for receipt scan parsing.');
  }

  const draft = {
    merchant: String(parsed?.merchant || '').trim() || 'Scanned receipt',
    purchase_date: parseReceiptDateFromText(String(parsed?.purchase_date || '')) || '',
    total_amount: normalizeOcrAmount(parsed?.total_amount),
    items: sanitizeReceiptItems(parsed?.items, parseReceiptDateFromText(String(parsed?.purchase_date || '')) || ''),
    raw_text: '',
  };
  if (!Array.isArray(draft?.items) || !draft.items.length) {
    const err = new Error('AI could not extract any reliable expense rows from this receipt.');
    err.statusCode = 422;
    throw err;
  }
  return draft;
}

async function mergeReceiptDraftPagesWithOpenAi(drafts = []) {
  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) return null;
  const pages = (Array.isArray(drafts) ? drafts : []).filter(Boolean);
  if (!pages.length) return null;

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['merchant', 'purchase_date', 'total_amount', 'items', 'notes'],
    properties: {
      merchant: { type: 'string' },
      purchase_date: { type: 'string' },
      total_amount: { type: 'number' },
      notes: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['item_name', 'amount', 'purchase_date', 'category', 'is_extra', 'selected'],
          properties: {
            item_name: { type: 'string' },
            amount: { type: 'number' },
            purchase_date: { type: 'string' },
            category: { type: 'string' },
            is_extra: { type: 'boolean' },
            selected: { type: 'boolean' },
          },
        },
      },
    },
  };

  const systemPrompt = [
    'You merge multiple receipt scan drafts that may contain overlapping pages from the same bill.',
    'Return one combined receipt draft.',
    'Remove duplicate line items that appear on more than one page.',
    'Preserve distinct repeated purchases only when the item name, quantity context, or amount indicates they are truly separate bill rows.',
    'If the exact same item name and amount appears twice on the same page draft, keep both rows.',
    'Do not collapse legitimate repeated lines like RAW CASHEWS, COTTAGE CHSE, KS GRK YGRT, or LIMES 3 LB when they are separate purchases.',
    'Keep merchant and purchase date if visible across pages.',
    'Prefer the highest-confidence combined interpretation of the bill.',
    'Keep selected=true for kept rows.',
    'Do not invent rows that are not supported by the provided drafts.',
  ].join(' ');

  const response = await postOpenAiResponseWithTimeout({
    model: getOpenAiReceiptScanModel(),
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: [{
          type: 'input_text',
          text: JSON.stringify({
            drafts: pages.map((page, index) => ({
              page: index + 1,
              merchant: page?.merchant || '',
              purchase_date: page?.purchase_date || '',
              total_amount: page?.total_amount || 0,
              items: page?.items || [],
              raw_text: page?.raw_text || '',
            })),
          }),
        }],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'receipt_scan_merge',
        strict: true,
        schema,
      },
    },
  }, config.apiKey);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `OpenAI receipt merge failed with HTTP ${response.status}`);
  }
  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) return null;
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_err) {
    throw new Error('OpenAI returned invalid JSON for receipt merge.');
  }
  const purchaseDate = parseReceiptDateFromText(String(parsed?.purchase_date || '')) || '';
  return {
    merchant: String(parsed?.merchant || '').trim() || 'Scanned receipt',
    purchase_date: purchaseDate,
    total_amount: normalizeOcrAmount(parsed?.total_amount),
    items: sanitizeReceiptItems(parsed?.items, purchaseDate),
    raw_text: '',
  };
}

async function scanReceiptFile(file, options = {}) {
  if (!file) {
    const err = new Error('No image uploaded');
    err.statusCode = 400;
    throw err;
  }
  if (!String(file.mimetype || '').startsWith('image/')) {
    const err = new Error('Only image files are supported right now');
    err.statusCode = 400;
    throw err;
  }

  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI receipt scan is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }

  let aiDraft;
  try {
    aiDraft = await parseReceiptDraftWithOpenAi(
      '',
      file.buffer,
      String(file.mimetype || 'image/jpeg')
    );
  } catch (err) {
    const wrapped = new Error(err?.message || 'AI receipt parsing failed');
    wrapped.statusCode = err?.statusCode || 422;
    throw wrapped;
  }

  const draft = aiDraft;
  return {
    success: true,
    draft: {
      ...draft,
      provider: 'openai',
    },
    debug: {
      ocr_text: '',
      ocr_rows: [],
      ai_rows: Array.isArray(aiDraft?.items) ? aiDraft.items : [],
      final_rows: Array.isArray(draft?.items) ? draft.items : [],
    },
  };
}

async function matchCreditCardBillPdfWithOpenAi(file, context = {}) {
  if (!file) {
    const err = new Error('No PDF uploaded');
    err.statusCode = 400;
    throw err;
  }
  const mimeType = String(file.mimetype || '').toLowerCase();
  if (mimeType !== 'application/pdf') {
    const err = new Error('Only PDF bills are supported right now.');
    err.statusCode = 400;
    throw err;
  }

  const config = getOpenAiSmartCaptureConfig();
  if (!config.enabled) {
    const err = new Error('OpenAI bill matching is not configured. Add OPENAI_API_KEY on the server first.');
    err.statusCode = 503;
    throw err;
  }

  const cycle = context?.cycle || {};
  const card = context?.card || {};
  const pdfPassword = String(context?.password || '').trim();
  const appTransactions = Array.isArray(context?.txns) ? context.txns : [];
  const normalizedTxns = appTransactions.map((item) => ({
    app_txn_id: Number(item?.id || 0),
    txn_date: String(item?.txn_date || '').slice(0, 10),
    amount: Number(item?.amount || item?.net_amount || 0),
    description: String(item?.description || '').trim(),
  })).filter((item) => item.app_txn_id > 0 && item.amount > 0 && item.txn_date);

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['statement_rows', 'matches', 'unmatched_statement_indexes', 'unmatched_app_txn_ids', 'notes'],
    properties: {
      notes: { type: 'string' },
      statement_rows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['statement_index', 'txn_date', 'amount', 'description'],
          properties: {
            statement_index: { type: 'integer' },
            txn_date: { type: 'string' },
            amount: { type: 'number' },
            description: { type: 'string' },
          },
        },
      },
      matches: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['statement_index', 'app_txn_id', 'confidence', 'reason'],
          properties: {
            statement_index: { type: 'integer' },
            app_txn_id: { type: 'integer' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
          },
        },
      },
      unmatched_statement_indexes: {
        type: 'array',
        items: { type: 'integer' },
      },
      unmatched_app_txn_ids: {
        type: 'array',
        items: { type: 'integer' },
      },
    },
  };

  const systemPrompt = [
    'You reconcile a credit card bill PDF against existing app transactions for one billing cycle.',
    pdfPassword
      ? 'Use the provided extracted statement text from the unlocked PDF as the primary source of truth and extract actual purchase or charge rows from the statement.'
      : 'Use the uploaded PDF as the primary source of truth and extract actual purchase or charge rows from the statement.',
    'Focus mostly on transaction date and amount. Description similarity is secondary because merchant names may differ between the statement and the app.',
    'Prefer an exact amount match. A date difference of up to 3 days is acceptable when the amount matches and there is no better candidate.',
    'Match each statement row to at most one app transaction and each app transaction to at most one statement row.',
    'Ignore statement summary sections, total due, minimum due, opening balance, closing balance, available limit, rewards, fees summary, payment confirmations, EMI summary blocks, and non-transaction boilerplate.',
    'Ignore payment received rows, credits, reversals, refunds, and autopay confirmations unless they clearly represent a real purchase transaction the user would have saved as a spend.',
    'Return only rows that belong to the provided billing cycle period.',
    'Do not force a match when amounts differ materially.',
    'Keep dates in YYYY-MM-DD format. If the statement only shows day and month, infer the correct year from the billing cycle period.',
    'Return strict JSON only.',
  ].join(' ');

  let extractedStatementPages = [];
  if (pdfPassword) {
    extractedStatementPages = await extractPasswordProtectedPdfStatementText(file.buffer, pdfPassword);
  }

  const userPayload = {
    task: pdfPassword
      ? 'Extract statement transactions from this unlocked statement text and reconcile them with the provided app transactions.'
      : 'Extract statement transactions from this PDF and reconcile them with the provided app transactions.',
    billing_cycle: {
      cycle_id: Number(cycle?.id || 0) || null,
      cycle_start: String(cycle?.cycle_start || '').slice(0, 10),
      cycle_end: String(cycle?.cycle_end || '').slice(0, 10),
      due_date: String(cycle?.due_date || '').slice(0, 10),
    },
    card: {
      bank_name: String(card?.bank_name || '').trim(),
      card_name: String(card?.card_name || '').trim(),
      last4: String(card?.last4 || '').trim(),
    },
    app_transactions: normalizedTxns,
    statement_text_pages: extractedStatementPages,
  };

  const userContent = pdfPassword
    ? [{
        type: 'input_text',
        text: JSON.stringify(userPayload),
      }]
    : [
        {
          type: 'input_file',
          filename: file.originalname || 'credit-card-bill.pdf',
          file_data: `data:application/pdf;base64,${file.buffer.toString('base64')}`,
        },
        {
          type: 'input_text',
          text: JSON.stringify(userPayload),
        },
      ];

  const response = await postOpenAiResponseWithTimeout({
    model: getOpenAiCcBillMatchModel(),
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'credit_card_bill_match',
        strict: true,
        schema,
      },
    },
  }, config.apiKey, getOpenAiCcBillMatchTimeoutMs());

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || payload?.message || `OpenAI bill match failed with HTTP ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  const outputText = extractOpenAiOutputText(payload);
  if (!outputText) {
    const err = new Error('OpenAI returned an empty bill matching result.');
    err.statusCode = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (_err) {
    const err = new Error('OpenAI returned invalid JSON for bill matching.');
    err.statusCode = 502;
    throw err;
  }

  const statementRows = (Array.isArray(parsed?.statement_rows) ? parsed.statement_rows : [])
    .map((row, index) => ({
      statement_index: Number.isInteger(row?.statement_index) ? row.statement_index : index + 1,
      txn_date: String(row?.txn_date || '').slice(0, 10),
      amount: roundCurrencyAmount(row?.amount),
      description: String(row?.description || '').trim() || 'Statement transaction',
    }))
    .filter((row) => row.statement_index > 0 && row.amount > 0 && row.txn_date);

  const statementByIndex = new Map(statementRows.map((row) => [Number(row.statement_index), row]));
  const appTxnById = new Map(normalizedTxns.map((row) => [Number(row.app_txn_id), row]));
  const matchedStatementIndexes = new Set();
  const matchedAppTxnIds = new Set();
  const matches = [];

  for (const match of (Array.isArray(parsed?.matches) ? parsed.matches : [])) {
    const statementIndex = Number(match?.statement_index || 0);
    const appTxnId = Number(match?.app_txn_id || 0);
    if (!(statementByIndex.has(statementIndex) && appTxnById.has(appTxnId))) continue;
    if (matchedStatementIndexes.has(statementIndex) || matchedAppTxnIds.has(appTxnId)) continue;
    matchedStatementIndexes.add(statementIndex);
    matchedAppTxnIds.add(appTxnId);
    matches.push({
      statement_index: statementIndex,
      confidence: ['high', 'medium', 'low'].includes(String(match?.confidence || '').toLowerCase())
        ? String(match.confidence).toLowerCase()
        : 'medium',
      reason: String(match?.reason || '').trim(),
      statement: statementByIndex.get(statementIndex),
      app_transaction: appTxnById.get(appTxnId),
    });
  }

  const statementOnly = statementRows.filter((row) => !matchedStatementIndexes.has(Number(row.statement_index)));
  const appOnly = normalizedTxns.filter((row) => !matchedAppTxnIds.has(Number(row.app_txn_id)));
  const matchedAmount = matches.reduce((sum, item) => sum + Number(item?.statement?.amount || 0), 0);
  const statementAmount = statementRows.reduce((sum, item) => sum + Number(item?.amount || 0), 0);
  const appAmount = normalizedTxns.reduce((sum, item) => sum + Number(item?.amount || 0), 0);

  return {
    success: true,
    provider: 'openai',
    cycle: {
      id: Number(cycle?.id || 0) || null,
      cycle_start: String(cycle?.cycle_start || '').slice(0, 10),
      cycle_end: String(cycle?.cycle_end || '').slice(0, 10),
      due_date: String(cycle?.due_date || '').slice(0, 10),
    },
    summary: {
      matched_count: matches.length,
      statement_count: statementRows.length,
      app_count: normalizedTxns.length,
      statement_only_count: statementOnly.length,
      app_only_count: appOnly.length,
      matched_amount,
      statement_amount,
      app_amount,
    },
    notes: String(parsed?.notes || '').trim(),
    matches,
    statement_only: statementOnly,
    app_only: appOnly,
    statement_rows: statementRows,
  };
}

let pdfJsLibPromise = null;

async function getPdfJsLib() {
  if (!pdfJsLibPromise) {
    pdfJsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfJsLibPromise;
}

async function extractPasswordProtectedPdfStatementText(buffer, password = '') {
  const safePassword = String(password || '').trim();
  if (!safePassword) {
    const err = new Error('This PDF is protected. Enter the PDF password to verify it.');
    err.statusCode = 400;
    throw err;
  }

  const pdfjsLib = await getPdfJsLib();
  let pdfDocument = null;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      password: safePassword,
      disableWorker: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      stopAtErrors: false,
    });
    pdfDocument = await loadingTask.promise;
  } catch (err) {
    const errorName = String(err?.name || '');
    const errorMessage = String(err?.message || '').toLowerCase();
    if (errorName === 'PasswordException' || errorMessage.includes('password')) {
      const wrapped = new Error('Could not open this PDF. Please check the password and try again.');
      wrapped.statusCode = 400;
      throw wrapped;
    }
    const wrapped = new Error(err?.message || 'Could not read this protected PDF.');
    wrapped.statusCode = 422;
    throw wrapped;
  }

  const pages = [];
  let totalChars = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = (Array.isArray(textContent?.items) ? textContent.items : [])
        .map((item) => String(item?.str || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!pageText) continue;
      const remainingChars = 120000 - totalChars;
      if (remainingChars <= 0) break;
      const clippedText = pageText.length > remainingChars ? pageText.slice(0, remainingChars) : pageText;
      pages.push({ page_number: pageNumber, text: clippedText });
      totalChars += clippedText.length;
      if (totalChars >= 120000) break;
    }
  } finally {
    try { await pdfDocument?.destroy(); } catch (_err) {}
  }

  if (!pages.length) {
    const err = new Error('Could not extract readable statement text from this protected PDF.');
    err.statusCode = 422;
    throw err;
  }

  return pages;
}

async function ensureFeatureAccess(userId, featureKey) {
  const [user, pages] = await Promise.all([
    Promise.resolve(pgDb.findUserById(userId)),
    Promise.resolve(pgDb.getUserAccessiblePages(userId)),
  ]);
  if (user?.role === 'admin') return;
  if ((Array.isArray(pages) ? pages : []).includes(featureKey)) return;
  const err = new Error('You do not have permission to use this feature.');
  err.statusCode = 403;
  throw err;
}

function normalizeFriendName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (!value) {
    const err = new Error('Friend name is required');
    err.statusCode = 400;
    throw err;
  }
  if (value.length > 80) {
    const err = new Error('Friend name must be 80 characters or fewer');
    err.statusCode = 400;
    throw err;
  }
  if (!/^[A-Za-z0-9 ]+$/.test(value)) {
    const err = new Error('Friend name can contain only letters, numbers, and spaces');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseAdminUserIdList(raw) {
  return [...new Set((Array.isArray(raw) ? raw : []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function deriveInviteName(target) {
  const raw = String(target || '').trim();
  if (!raw) return 'Friend';
  if (raw.includes('@')) return raw.split('@')[0] || 'Friend';
  return `Friend ${raw.replace(/\D/g, '').slice(-4) || ''}`.trim();
}

function buildLiveSplitInviteRegisterUrl(baseUrl, inviteToken) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  return `${root}/register?invite=${encodeURIComponent(String(inviteToken || '').trim())}`;
}

function getCoreDb() {
  return pgCoreDb;
}

function getPetrolDb() {
  return pgPetrolDb;
}

function getOpsDb() {
  return pgOpsDb;
}

function getBillingDb() {
  return pgBillingDb;
}

function getFinanceDb() {
  return pgFinanceDb;
}

assertPostgresConfigured();

function clearTenantPortalSession(req) {
  if (!req?.session) return;
  delete req.session.tenantPortal;
  delete req.session.tenantPortalPending;
}

function requestIpAddress(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').trim();
  if (forwarded) return forwarded.split(',')[0].trim();
  return String(req?.ip || req?.socket?.remoteAddress || '').trim();
}

async function logTenantPortalAccess(req, accessKind, dashboard = null) {
  try {
    const tenantPortal = tenantPortalSessionPayload(req);
    if (!tenantPortal?.tenantId) return;
    const safeDashboard = dashboard || await pgTenantDb.getTenantPortalDashboard(tenantPortal.tenantId);
    const tenant = safeDashboard?.tenant || {};
    await pgPortalAccessDb.logPortalAccess({
      portal_type: 'tenant',
      access_kind: accessKind,
      tenant_id: Number(tenantPortal.tenantId),
      owner_user_id: Number(tenant.user_id || 0) || null,
      session_id: req?.sessionID || '',
      display_name: tenant.tenant_name || '',
      phone_number: tenant.contact_number || tenantPortal.phoneDigits || '',
      unit_label: [tenant.room_label, tenant.floor_label].filter(Boolean).join(' - '),
      property_type: 'tenant',
      location_label: tenant.building_name || tenant.building_address || '',
      ip_address: requestIpAddress(req),
      user_agent: req?.headers?.['user-agent'] || '',
    });
  } catch (err) {
    console.error('[portal-access] tenant log failed:', err?.message || err);
  }
}

function tenantPortalSessionPayload(req) {
  return req?.session?.tenantPortal && Number(req.session.tenantPortal.tenantId) > 0
    ? req.session.tenantPortal
    : null;
}

async function buildTenantPortalSessionResponse(req) {
  const tenantPortal = tenantPortalSessionPayload(req);
  if (!tenantPortal) return { authenticated: false };
  const dashboard = await pgTenantDb.getTenantPortalDashboard(tenantPortal.tenantId);
  if (!dashboard) {
    clearTenantPortalSession(req);
    return { authenticated: false };
  }
  return {
    authenticated: true,
    dashboard,
  };
}

async function requireTenantPortalAuth(req, res, next) {
  try {
    const tenantPortal = tenantPortalSessionPayload(req);
    if (!tenantPortal) {
      return res.status(401).json({ error: 'Tenant session expired. Please log in again.' });
    }
    const dashboard = await pgTenantDb.getTenantPortalDashboard(tenantPortal.tenantId);
    if (!dashboard) {
      clearTenantPortalSession(req);
      return res.status(401).json({ error: 'Tenant session expired. Please log in again.' });
    }
    req.tenantPortal = tenantPortal;
    req.tenantPortalDashboard = dashboard;
    return next();
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not verify tenant session.' });
  }
}

function normalizeTenantPortalOtp(value) {
  return String(value || '').replace(/\D+/g, '').slice(0, 6);
}

async function sendTenantPortalOtp(req, tenant, phone) {
  const appOtp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const otpMessage = `Your RentLedger tenant portal OTP is ${appOtp}. It is valid for 10 minutes.`;

  if (isMsg91FlowSmsEnabled()) {
    const smsResult = await sendMsg91FlowSms({
      phone,
      variables: {
        OTP: appOtp,
        otp: appOtp,
        CODE: appOtp,
        code: appOtp,
        APP: 'RentLedger',
        app: 'RentLedger',
      },
    });
    req.session.tenantPortalPending = {
      tenantId: Number(tenant.id),
      phoneDigits: normalizeIndianMobile(phone),
      requestId: smsResult.requestId || 'msg91-flow',
      maskedMobile: smsResult.maskedMobile,
      otpCode: appOtp,
      provider: 'msg91-flow-sms',
      sentAt: new Date().toISOString(),
    };
    return {
      success: true,
      masked_mobile: smsResult.maskedMobile,
      requires_otp: true,
    };
  }

  if (isSmsEnabled()) {
    const smsResult = await sendSms({
      to: normalizeIndianMobile(phone),
      body: otpMessage,
    });
    if (!smsResult?.sent) throw new Error('Could not send tenant OTP SMS.');
    req.session.tenantPortalPending = {
      tenantId: Number(tenant.id),
      phoneDigits: normalizeIndianMobile(phone),
      requestId: String(smsResult.sid || 'twilio-sms'),
      maskedMobile: maskIndianMobile(phone),
      otpCode: appOtp,
      provider: 'twilio-sms',
      sentAt: new Date().toISOString(),
    };
    return {
      success: true,
      masked_mobile: maskIndianMobile(phone),
      requires_otp: true,
    };
  }

  if (isMsg91OtpEnabled()) {
    const otpResult = await sendMsg91Otp({ phone });
    req.session.tenantPortalPending = {
      tenantId: Number(tenant.id),
      phoneDigits: normalizeIndianMobile(phone),
      requestId: otpResult.requestId,
      maskedMobile: otpResult.maskedMobile,
      provider: 'msg91-widget-api',
      sentAt: new Date().toISOString(),
    };
    return {
      success: true,
      masked_mobile: otpResult.maskedMobile,
      requires_otp: true,
    };
  }
  throw new Error('Tenant OTP is not configured on the server');
}

function clearSocietyPortalSession(req) {
  if (!req?.session) return;
  delete req.session.societyPortal;
  delete req.session.societyPortalPending;
}

async function logSocietyPortalAccess(req, accessKind, dashboard = null) {
  try {
    const societyPortal = societyPortalSessionPayload(req);
    if (!societyPortal?.memberId) return;
    const safeDashboard = dashboard || await pgCoreDb.getSocietyMemberPortalDashboard(societyPortal.memberId);
    const member = safeDashboard?.member || {};
    const society = safeDashboard?.society || {};
    await pgPortalAccessDb.logPortalAccess({
      portal_type: 'society',
      access_kind: accessKind,
      member_id: Number(societyPortal.memberId),
      owner_user_id: Number(society.user_id || 0) || null,
      session_id: req?.sessionID || '',
      display_name: member.member_name || '',
      phone_number: member.phone_number || societyPortal.phoneDigits || '',
      unit_label: member.unit_label || '',
      property_type: member.property_type || '',
      location_label: society.name || society.location || '',
      ip_address: requestIpAddress(req),
      user_agent: req?.headers?.['user-agent'] || '',
    });
  } catch (err) {
    console.error('[portal-access] society log failed:', err?.message || err);
  }
}

function societyPortalSessionPayload(req) {
  return req?.session?.societyPortal && Number(req.session.societyPortal.memberId) > 0
    ? req.session.societyPortal
    : null;
}

async function buildSocietyPortalSessionResponse(req) {
  const societyPortal = societyPortalSessionPayload(req);
  if (!societyPortal) return { authenticated: false };
  const dashboard = await pgCoreDb.getSocietyMemberPortalDashboard(societyPortal.memberId);
  if (!dashboard) {
    clearSocietyPortalSession(req);
    return { authenticated: false };
  }
  return {
    authenticated: true,
    dashboard,
  };
}

async function requireSocietyPortalAuth(req, res, next) {
  try {
    const societyPortal = societyPortalSessionPayload(req);
    if (!societyPortal) {
      return res.status(401).json({ error: 'Society session expired. Please log in again.' });
    }
    const dashboard = await pgCoreDb.getSocietyMemberPortalDashboard(societyPortal.memberId);
    if (!dashboard) {
      clearSocietyPortalSession(req);
      return res.status(401).json({ error: 'Society session expired. Please log in again.' });
    }
    req.societyPortal = societyPortal;
    req.societyPortalDashboard = dashboard;
    return next();
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not verify society session.' });
  }
}

function normalizeSocietyPortalOtp(value) {
  return String(value || '').replace(/\D+/g, '').slice(0, 6);
}

async function sendSocietyPortalOtp(req, member, phone) {
  const appOtp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const otpMessage = `Your SocietyLedger member portal OTP is ${appOtp}. It is valid for 10 minutes.`;

  if (isMsg91FlowSmsEnabled()) {
    const smsResult = await sendMsg91FlowSms({
      phone,
      variables: {
        OTP: appOtp,
        otp: appOtp,
        CODE: appOtp,
        code: appOtp,
        APP: 'SocietyLedger',
        app: 'SocietyLedger',
      },
    });
    req.session.societyPortalPending = {
      memberId: Number(member.id),
      phoneDigits: normalizeIndianMobile(phone),
      requestId: smsResult.requestId || 'msg91-flow',
      maskedMobile: smsResult.maskedMobile,
      otpCode: appOtp,
      provider: 'msg91-flow-sms',
      sentAt: new Date().toISOString(),
    };
    return {
      success: true,
      masked_mobile: smsResult.maskedMobile,
      requires_otp: true,
    };
  }

  if (isSmsEnabled()) {
    const smsResult = await sendSms({
      to: normalizeIndianMobile(phone),
      body: otpMessage,
    });
    if (!smsResult?.sent) throw new Error('Could not send society OTP SMS.');
    req.session.societyPortalPending = {
      memberId: Number(member.id),
      phoneDigits: normalizeIndianMobile(phone),
      requestId: String(smsResult.sid || 'twilio-sms'),
      maskedMobile: maskIndianMobile(phone),
      otpCode: appOtp,
      provider: 'twilio-sms',
      sentAt: new Date().toISOString(),
    };
    return {
      success: true,
      masked_mobile: maskIndianMobile(phone),
      requires_otp: true,
    };
  }

  if (isMsg91OtpEnabled()) {
    const otpResult = await sendMsg91Otp({ phone });
    req.session.societyPortalPending = {
      memberId: Number(member.id),
      phoneDigits: normalizeIndianMobile(phone),
      requestId: otpResult.requestId,
      maskedMobile: otpResult.maskedMobile,
      provider: 'msg91-widget-api',
      sentAt: new Date().toISOString(),
    };
    return {
      success: true,
      masked_mobile: otpResult.maskedMobile,
      requires_otp: true,
    };
  }
  throw new Error('Society OTP is not configured on the server');
}

router.post('/public/tenant-portal/send-otp', async (req, res) => {
  try {
    const phone = normalizeIndianMobile(req.body?.phone || req.body?.mobile || req.body?.contact_number || '');
    if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
    const tenant = await pgTenantDb.getTenantPortalRecordByPhone(phone);
    if (!tenant) return res.status(404).json({ error: 'No active tenant found for this mobile number.' });
    clearTenantPortalSession(req);
    const result = await sendTenantPortalOtp(req, tenant, phone);
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not send OTP.' });
  }
});

router.post('/public/tenant-portal/resend-otp', async (req, res) => {
  try {
    const pending = req.session?.tenantPortalPending || null;
    const phone = normalizeIndianMobile(req.body?.phone || pending?.phoneDigits || '');
    if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
    const tenant = await pgTenantDb.getTenantPortalRecordByPhone(phone);
    if (!tenant) return res.status(404).json({ error: 'No active tenant found for this mobile number.' });
    const result = await sendTenantPortalOtp(req, tenant, phone);
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not resend OTP.' });
  }
});

router.post('/public/tenant-portal/verify-otp', async (req, res) => {
  try {
    const pending = req.session?.tenantPortalPending || null;
    if (!pending?.tenantId) return res.status(400).json({ error: 'Send OTP first.' });
    const otp = normalizeTenantPortalOtp(req.body?.otp || req.body?.code || '');
    if (!otp) return res.status(400).json({ error: 'Enter the OTP.' });
    if (pending.otpCode) {
      if (otp !== String(pending.otpCode)) return res.status(400).json({ error: 'Invalid OTP.' });
    } else {
      await verifyMsg91Otp({ requestId: pending.requestId, otp });
    }
    req.session.tenantPortal = {
      tenantId: Number(pending.tenantId),
      phoneDigits: String(pending.phoneDigits || ''),
      verifiedAt: new Date().toISOString(),
    };
    delete req.session.tenantPortalPending;
    const response = await buildTenantPortalSessionResponse(req);
    await logTenantPortalAccess(req, 'otp_login', response?.dashboard);
    return res.json(response);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not verify OTP.' });
  }
});

router.post('/public/tenant-portal/widget-login', async (req, res) => {
  try {
    if (!isMsg91WidgetSdkEnabled()) {
      return res.status(503).json({ error: 'MSG91 widget OTP is not configured.' });
    }
    const accessToken = String(req.body?.access_token || req.body?.accessToken || req.body?.token || '').trim();
    if (!accessToken) return res.status(400).json({ error: 'OTP verification token is required.' });
    const verification = await verifyMsg91AccessToken({ accessToken });
    const raw = verification?.raw || {};
    const phone = normalizeIndianMobile(
      raw?.mobile
      || raw?.phone
      || raw?.identifier
      || raw?.identifierValue
      || raw?.data?.mobile
      || raw?.data?.phone
      || raw?.data?.identifier
      || raw?.data?.identifierValue
      || raw?.result?.mobile
      || raw?.result?.phone
      || raw?.result?.identifier
      || raw?.result?.identifierValue
      || req.body?.phone
      || req.body?.mobile
      || ''
    );
    if (!phone) return res.status(400).json({ error: 'Could not verify tenant mobile number.' });
    const tenant = await pgTenantDb.getTenantPortalRecordByPhone(phone);
    if (!tenant) return res.status(404).json({ error: 'No active tenant found for this mobile number.' });
    clearTenantPortalSession(req);
    req.session.tenantPortal = {
      tenantId: Number(tenant.id),
      phoneDigits: phone,
      verifiedAt: new Date().toISOString(),
      provider: 'msg91-widget',
    };
    const response = await buildTenantPortalSessionResponse(req);
    await logTenantPortalAccess(req, 'widget_login', response?.dashboard);
    return res.json(response);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not verify tenant OTP.' });
  }
});

router.get('/public/tenant-portal/session', async (req, res) => {
  try {
    const response = await buildTenantPortalSessionResponse(req);
    if (response?.authenticated) await logTenantPortalAccess(req, 'session_open', response?.dashboard);
    return res.json(response);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not load tenant session.' });
  }
});

router.post('/public/tenant-portal/logout', (req, res) => {
  clearTenantPortalSession(req);
  return res.json({ success: true });
});

router.post('/public/tenant-portal/invoices/:id/mark-paid', requireTenantPortalAuth, async (req, res) => {
  try {
    const request = await pgTenantDb.createTenantInvoicePaymentRequest(
      req.tenantPortal.tenantId,
      req.params.id,
      req.body || {}
    );
    const notificationContext = await pgTenantDb.getTenantInvoicePaymentRequestNotificationContext(request?.id);
    if (notificationContext) {
      try {
        await notifyAdminAboutTenantPaymentRequest(notificationContext);
      } catch (notifyErr) {
        console.error('notifyAdminAboutTenantPaymentRequest failed', notifyErr);
      }
    }
    const response = await buildTenantPortalSessionResponse(req);
    return res.json({
      success: true,
      request,
      dashboard: response.dashboard,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not submit payment request.' });
  }
});

router.post('/public/society-portal/send-otp', async (req, res) => {
  try {
    const phone = normalizeIndianMobile(req.body?.phone || req.body?.mobile || req.body?.contact_number || '');
    if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
    const member = await pgCoreDb.getSocietyMemberPortalRecordByPhone(phone);
    if (!member) return res.status(404).json({ error: 'No active society member found for this mobile number.' });
    clearSocietyPortalSession(req);
    const result = await sendSocietyPortalOtp(req, member, phone);
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not send OTP.' });
  }
});

router.post('/public/society-portal/resend-otp', async (req, res) => {
  try {
    const pending = req.session?.societyPortalPending || null;
    const phone = normalizeIndianMobile(req.body?.phone || pending?.phoneDigits || '');
    if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
    const member = await pgCoreDb.getSocietyMemberPortalRecordByPhone(phone);
    if (!member) return res.status(404).json({ error: 'No active society member found for this mobile number.' });
    const result = await sendSocietyPortalOtp(req, member, phone);
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not resend OTP.' });
  }
});

router.post('/public/society-portal/verify-otp', async (req, res) => {
  try {
    const pending = req.session?.societyPortalPending || null;
    if (!pending?.memberId) return res.status(400).json({ error: 'Send OTP first.' });
    const otp = normalizeSocietyPortalOtp(req.body?.otp || req.body?.code || '');
    if (!otp) return res.status(400).json({ error: 'Enter the OTP.' });
    if (pending.otpCode) {
      if (otp !== String(pending.otpCode)) return res.status(400).json({ error: 'Invalid OTP.' });
    } else {
      await verifyMsg91Otp({ requestId: pending.requestId, otp });
    }
    req.session.societyPortal = {
      memberId: Number(pending.memberId),
      phoneDigits: String(pending.phoneDigits || ''),
      verifiedAt: new Date().toISOString(),
    };
    delete req.session.societyPortalPending;
    const response = await buildSocietyPortalSessionResponse(req);
    await logSocietyPortalAccess(req, 'otp_login', response?.dashboard);
    return res.json(response);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not verify OTP.' });
  }
});

router.get('/public/society-portal/session', async (req, res) => {
  try {
    const response = await buildSocietyPortalSessionResponse(req);
    if (response?.authenticated) await logSocietyPortalAccess(req, 'session_open', response?.dashboard);
    return res.json(response);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not load society session.' });
  }
});

router.post('/public/society-portal/logout', (req, res) => {
  clearSocietyPortalSession(req);
  return res.json({ success: true });
});

router.post('/public/society-portal/payment-requests', requireSocietyPortalAuth, async (req, res) => {
  try {
    const request = await pgCoreDb.createSocietyContributionPaymentRequestByMember(
      req.societyPortal.memberId,
      req.body || {}
    );
    const notificationContext = await pgCoreDb.getSocietyContributionPaymentRequestNotificationContext(request?.id);
    if (notificationContext) {
      try {
        await notifyAdminAboutSocietyPaymentRequest(notificationContext);
      } catch (notifyErr) {
        console.error('notifyAdminAboutSocietyPaymentRequest failed', notifyErr);
      }
    }
    const response = await buildSocietyPortalSessionResponse(req);
    return res.json({
      success: true,
      request,
      dashboard: response.dashboard,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not submit payment request.' });
  }
});

// All API routes require auth
router.use(requireAuth);

// ─── EXPENSES ────────────────────────────────────────────────
router.get('/expenses', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    // month can arrive as 'YYYY-MM' (mobile) or 'MM' (web) — normalise to 'MM'
    const rawMonth = req.query.month;
    const month = rawMonth && rawMonth.includes('-') ? rawMonth.split('-')[1] : rawMonth;
    const expenses = await Promise.resolve(coreDb.getExpenses(req.session.userId, {
      year: req.query.year === 'all' ? null : (req.query.year || (rawMonth && rawMonth.includes('-') ? rawMonth.split('-')[0] : null)),
      month,
      search: req.query.search,
      spendType: req.query.spendType,
    }));
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    res.json({ expenses, total: Math.round(total * 100) / 100, count: expenses.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/expenses/categories', async (req, res) => {
  try {
    const categories = await Promise.resolve(getCoreDb().getExpenseCategories(req.session.userId));
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/expenses', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    const { item_name, category, amount, purchase_date, is_extra, bank_account_id } = req.body;
    if (!item_name || !amount || !purchase_date) return res.status(400).json({ error: 'Missing fields' });
    const id = await Promise.resolve(coreDb.addExpense(req.session.userId, { item_name, category, amount: parseFloat(amount), purchase_date, is_extra, bank_account_id }));
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/expenses/:id', async (req, res) => {
  try {
    const expense = await Promise.resolve(getCoreDb().getExpenseById(req.session.userId, req.params.id));
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json({ expense });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/expenses/:id', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    const { item_name, category, amount, purchase_date, is_extra, bank_account_id } = req.body;
    await Promise.resolve(coreDb.updateExpense(req.session.userId, req.params.id, { item_name, category, amount: parseFloat(amount), purchase_date, is_extra, bank_account_id }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/expenses/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteExpense(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FILE IMPORT ─────────────────────────────────────────────
const XLSX = require('xlsx');
const XlsxPopulate = require('xlsx-populate');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/expenses/scan-image', upload.single('file'), async (req, res) => {
  try {
    const result = await scanReceiptFile(req.file);
    res.json(result);
  } catch (err) {
    console.error('[expenses/scan-image]', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not scan image' });
  }
});

router.post('/expenses/scan-images-batch', upload.array('files', 8), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'No images uploaded' });

    const pageResults = [];
    for (const file of files) {
      pageResults.push(await scanReceiptFile(file));
    }

    const pageDrafts = pageResults.map((entry) => entry?.draft).filter(Boolean);
    let mergedDraft = pageDrafts[0] || null;
    if (pageDrafts.length > 1) {
      mergedDraft = await mergeReceiptDraftPagesWithOpenAi(pageDrafts);
    }
    if (!mergedDraft) {
      const err = new Error('AI could not extract any reliable expense rows from these receipts.');
      err.statusCode = 422;
      throw err;
    }
    res.json({
      success: true,
      draft: {
        ...mergedDraft,
        page_count: pageDrafts.length,
        provider: 'openai',
      },
      pages: pageDrafts,
      debug: {
        final_rows: Array.isArray(mergedDraft?.items) ? mergedDraft.items : [],
        pages: pageResults.map((entry, index) => ({
          page: index + 1,
          merchant: entry?.draft?.merchant || '',
          total_amount: entry?.draft?.total_amount || 0,
          ocr_rows: entry?.debug?.ocr_rows || [],
          ai_rows: entry?.debug?.ai_rows || [],
          final_rows: entry?.debug?.final_rows || [],
        })),
      },
    });
  } catch (err) {
    console.error('[expenses/scan-images-batch]', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not scan images' });
  }
});

router.post('/smart-capture/parse-ai', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const [banks, cards] = await Promise.all([
      Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)),
      Promise.resolve(getBillingDb().getCreditCards(req.session.userId)),
    ]);

    const suggestion = await parseExpenseMessageWithOpenAi(message, banks || [], cards || []);
    res.json({
      success: true,
      provider: 'openai',
      suggestion,
      configured: true,
    });
  } catch (err) {
    console.error('[smart-capture/parse-ai]', err?.message || err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not parse this payment message with AI.' });
  }
});

router.post('/expenses/voice-prefill', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Audio file is required' });
    if (!isSupportedAudioUpload(req.file)) {
      return res.status(400).json({ error: 'Supported audio formats are mp3, mp4, m4a, wav, webm, and related audio files.' });
    }
    const voiceAccess = await Promise.resolve(pgDb.getUserVoiceAiAccess(req.session.userId));
    if (!voiceAccess?.can_use) {
      return res.status(403).json({ error: voiceAccess?.message || 'Voice AI is not available in your current plan.' });
    }

    const transcript = await transcribeAudioWithOpenAi(req.file);
    const [banks, cards] = await Promise.all([
      Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)),
      Promise.resolve(getBillingDb().getCreditCards(req.session.userId)),
    ]);
    let currentEntries = [];
    try {
      currentEntries = req.body?.current_entries ? JSON.parse(String(req.body.current_entries || '[]')) : [];
    } catch (_err) {
      currentEntries = [];
    }
    const voiceResult = Array.isArray(currentEntries) && currentEntries.length
      ? await applyVoiceExpenseEditsWithOpenAi(transcript, currentEntries, banks || [], cards || [])
      : await parseVoiceExpenseEntriesWithOpenAi(transcript, banks || [], cards || []);
    await Promise.resolve(pgDb.consumeUserVoiceAiUsage(req.session.userId, 'expense_voice', 'expense'));
    res.json({
      success: true,
      provider: 'openai',
      configured: true,
      transcript,
      suggestion: voiceResult.suggestion,
      suggestions: voiceResult.suggestions,
      notes: voiceResult.notes || '',
    });
  } catch (err) {
    console.error('[expenses/voice-prefill]', err?.message || err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not parse this voice note into expense fields.' });
  }
});

router.post('/live-split/voice-prefill', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Audio file is required' });
    if (!isSupportedAudioUpload(req.file)) {
      return res.status(400).json({ error: 'Supported audio formats are mp3, mp4, m4a, wav, webm, and related audio files.' });
    }
    const voiceAccess = await Promise.resolve(pgDb.getUserVoiceAiAccess(req.session.userId));
    if (!voiceAccess?.can_use) {
      return res.status(403).json({ error: voiceAccess?.message || 'Voice AI is not available in your current plan.' });
    }
    const mode = String(req.body?.mode || 'split').trim().toLowerCase() === 'trip' ? 'trip' : 'split';
    const transcript = await transcribeAudioWithOpenAi(req.file);
    const [friends, trips, banks, cards] = await Promise.all([
      Promise.resolve(getCoreDb().getLiveSplitFriends(req.session.userId)),
      Promise.resolve(getCoreDb().getLiveSplitTrips(req.session.userId)),
      Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)),
      Promise.resolve(getBillingDb().getCreditCards(req.session.userId)),
    ]);
    let currentEntries = [];
    try {
      currentEntries = req.body?.current_entries ? JSON.parse(String(req.body.current_entries || '[]')) : [];
    } catch (_err) {
      currentEntries = [];
    }
    const heuristicVoiceResult = Array.isArray(currentEntries) && currentEntries.length
      ? applyHeuristicLiveSplitVoiceEdit(transcript, currentEntries, (banks || []).map((bank) => ({
          id: String(bank.id),
          label: `${bank.bank_name}${bank.account_name ? ` - ${bank.account_name}` : ''}`,
          bank_name: bank.bank_name || '',
          account_name: bank.account_name || '',
          is_default: !!bank.is_default,
        })), (cards || []).map((card) => ({
          id: String(card.id),
          label: `${card.card_name} (${card.bank_name} **${card.last4})`,
          card_name: card.card_name || '',
          bank_name: card.bank_name || '',
          last4: String(card.last4 || ''),
          default_discount_pct: Number(card.default_discount_pct || 0),
        })))
      : null;
    const preferredFriendId = Number(req.body?.preferred_friend_id || 0) || null;
    const preferredTripId = Number(req.body?.preferred_trip_id || 0) || null;
    let preselectedFriendIds = [];
    try {
      preselectedFriendIds = req.body?.preselected_friend_ids ? JSON.parse(String(req.body.preselected_friend_ids || '[]')) : [];
    } catch (_err) {
      preselectedFriendIds = [];
    }
    const bankOptions = (banks || []).map((bank) => ({
      id: String(bank.id),
      label: `${bank.bank_name}${bank.account_name ? ` - ${bank.account_name}` : ''}`,
      bank_name: bank.bank_name || '',
      account_name: bank.account_name || '',
      is_default: !!bank.is_default,
    }));
    const cardOptions = (cards || []).map((card) => ({
      id: String(card.id),
      label: `${card.card_name} (${card.bank_name} **${card.last4})`,
      card_name: card.card_name || '',
      bank_name: card.bank_name || '',
      last4: String(card.last4 || ''),
      default_discount_pct: Number(card.default_discount_pct || 0),
    }));
    const voiceResult = heuristicVoiceResult || await parseLiveSplitVoiceWithOpenAi({
      message: transcript,
      mode,
      currentEntries,
      preferredFriendId,
      preferredTripId,
      preselectedFriendIds,
      friendOptions: buildLiveSplitFriendOptions(friends || []),
      tripOptions: buildLiveSplitTripOptions(trips || []),
      bankOptions,
      cardOptions,
    });
    await Promise.resolve(pgDb.consumeUserVoiceAiUsage(req.session.userId, 'live_split_voice', mode));
    res.json({
      success: true,
      provider: 'openai',
      configured: true,
      transcript,
      suggestion: voiceResult.suggestion,
      suggestions: voiceResult.suggestions,
      notes: voiceResult.notes || '',
    });
  } catch (err) {
    console.error('[live-split/voice-prefill]', err?.message || err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not parse this live split voice note.' });
  }
});

router.post('/ai/lookup/voice', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Audio file is required' });
    if (!isSupportedAudioUpload(req.file)) {
      return res.status(400).json({ error: 'Supported audio formats are mp3, mp4, m4a, wav, webm, and related audio files.' });
    }
    const voiceAccess = await Promise.resolve(pgDb.getUserVoiceAiAccess(req.session.userId));
    if (!voiceAccess?.can_use) {
      return res.status(403).json({ error: voiceAccess?.message || 'Voice AI is not available in your current plan.' });
    }
    const transcript = await transcribeAudioWithOpenAi(req.file);
    await Promise.resolve(pgDb.consumeUserVoiceAiUsage(req.session.userId, 'ai_lookup_voice', 'ai_lookup'));
    res.json({
      success: true,
      provider: 'openai',
      configured: true,
      transcript: String(transcript || '').trim(),
    });
  } catch (err) {
    console.error('[ai/lookup/voice]', err?.message || err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not transcribe this AI Lookup voice note.' });
  }
});

router.post('/expenses/import', upload.single('file'), async (req, res) => {
  try {
    const coreDb = getCoreDb();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const text = req.file.buffer.toString('utf-8');
    const { mapping } = req.body;
    const map = JSON.parse(mapping);

    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'File has no data rows' });

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => obj[h] = vals[i] || '');
      return obj;
    });

    const expenses = rows.map(r => ({
      item_name: r[map.name] || '',
      amount: parseFloat((r[map.amount] || '0').replace(/[^0-9.-]/g, '')),
      purchase_date: parseImportDate(r[map.date] || ''),
      is_extra: map.isExtra ? ['yes','true','1','extra'].includes((r[map.isExtra]||'').toLowerCase()) : false,
    })).filter(e => e.item_name && e.amount > 0 && e.purchase_date);

    const count = await Promise.resolve(coreDb.bulkAddExpenses(req.session.userId, expenses));
    res.json({ success: true, imported: count, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: run multer and catch its errors as JSON
function withUpload(req, res, next) {
  console.log('[withUpload] called for', req.method, req.originalUrl);
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[withUpload] multer error:', err.message);
      return res.status(400).json({ error: 'Upload error: ' + err.message });
    }
    console.log('[withUpload] multer ok, file:', req.file ? req.file.originalname : 'none');
    next();
  });
}

function ensureTenantUploadDir() {
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'tenants');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  return uploadDir;
}

function sanitizeUploadBaseName(name) {
  return String(name || 'file')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'file';
}

function saveTenantUploadFile(file) {
  if (!file) throw Object.assign(new Error('No file uploaded'), { statusCode: 400 });
  const ext = path.extname(String(file.originalname || '')).slice(0, 12).toLowerCase() || '.bin';
  const baseName = sanitizeUploadBaseName(file.originalname || 'tenant-file');
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName}${ext}`;
  const uploadDir = ensureTenantUploadDir();
  const absPath = path.join(uploadDir, filename);
  fs.writeFileSync(absPath, file.buffer);
  return {
    path: `/uploads/tenants/${filename}`,
    name: String(file.originalname || filename).trim() || filename,
  };
}

// Return sheet names — uses xlsx-populate which supports AES-encrypted xlsx
router.post('/expenses/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map(s => s.name()) });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('encrypt')) {
      res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    } else {
      res.status(500).json({ error: msg || 'Failed to read file' });
    }
  }
});

// Preview — parses Excel and returns rows without saving
router.post('/expenses/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets = parseSheetParam(req.body.sheets);
    const { rows: expenses, skipped } = await parseExcelBuffer(req.file.buffer, sheets, req.body.password);
    res.json({ count: expenses.length, skipped, preview: expenses.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to parse file' });
  }
});

// Excel import — fixed column layout: B=Date, D=Description, E=Debit, F=Extras
router.post('/expenses/import-excel', withUpload, async (req, res) => {
  try {
    const coreDb = getCoreDb();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets = parseSheetParam(req.body.sheets);
    const { rows: expenses, skipped } = await parseExcelBuffer(req.file.buffer, sheets, req.body.password);
    if (expenses.length === 0) return res.status(400).json({ error: 'No valid rows found. Check the file format.' });
    const count = await Promise.resolve(coreDb.bulkAddExpenses(req.session.userId, expenses));
    res.json({ success: true, imported: count, total: expenses.length + skipped });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

function parseSheetParam(param) {
  if (!param) return null;
  try { return JSON.parse(param); } catch { return [param]; }
}

function normalizeExcelHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseExcelAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const amount = parseFloat(cleaned);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function excelCellDisplayValue(cell) {
  if (!cell) return '';
  try {
    if (typeof cell.text === 'function') {
      const textValue = String(cell.text() || '').trim();
      if (textValue) return textValue;
    }
  } catch {}
  const value = cell.value();
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (value instanceof Date) {
    return parseExcelDate(value) || '';
  }
  if (typeof value === 'object') {
    if (Array.isArray(value?.richText)) {
      const joined = value.richText.map((part) => String(part?.value || '')).join('').trim();
      if (joined) return joined;
    }
    if (typeof value?.text === 'string' && value.text.trim()) return value.text.trim();
  }
  return String(value).trim();
}

function excelCellText(sheet, row, col) {
  return excelCellDisplayValue(sheet.cell(row, col));
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function parseTripMembersCell(value) {
  return [...new Set(String(value || '')
    .split(/\r?\n|,|&/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function inferImportedTripStatus(startDate, endDate, rawStatus) {
  const normalizedStatus = String(rawStatus || '').trim().toLowerCase();
  if (['pending', 'upcoming', 'ongoing', 'completed', 'cancelled'].includes(normalizedStatus)) {
    return normalizedStatus;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const end = endDate ? new Date(`${endDate}T00:00:00`) : null;
  if (end && end < today) return 'completed';
  if (start && start > today) return 'upcoming';
  if (start && start <= today && (!end || end >= today)) return 'ongoing';
  return 'upcoming';
}

function buildTripSummaryFromRow(row, cols) {
  const destination = String(row[cols.destination] || '').trim();
  const startDate = parseExcelDate(row[cols.start_date]);
  if (!destination || !startDate) return null;
  const endDate = cols.end_date != null ? parseExcelDate(row[cols.end_date]) : null;
  return {
    destination,
    start_date: startDate,
    end_date: endDate,
    total_distance: cols.total_distance != null ? parseExcelAmount(row[cols.total_distance]) : null,
    total_expenditure: cols.total_expenditure != null ? parseExcelAmount(row[cols.total_expenditure]) || 0 : 0,
    status: inferImportedTripStatus(startDate, endDate, cols.status != null ? row[cols.status] : ''),
    category: cols.category != null ? String(row[cols.category] || '').trim() || null : null,
    transport_mode: cols.transport_mode != null ? String(row[cols.transport_mode] || '').trim() || null : null,
    members: cols.members != null ? parseTripMembersCell(row[cols.members]) : [],
    expenses: [],
  };
}

function parseTripSummarySheet(sheet) {
  const usedRange = sheet.usedRange();
  if (!usedRange) return [];
  const lastRow = usedRange.endCell().rowNumber();
  const lastCol = usedRange.endCell().columnNumber();
  const aliases = {
    destination: ['destination', 'trip', 'trip destination', 'location'],
    start_date: ['start date', 'trip start date', 'from date'],
    end_date: ['end date', 'trip end date', 'to date'],
    total_distance: ['total distance', 'distance', 'total distance travelled', 'distance travelled'],
    total_expenditure: ['total expenditure', 'expenditure', 'total expenses', 'expense total', 'total spent'],
    status: ['status', 'trip status'],
    category: ['category', 'trip category'],
    members: ['members', 'persons', 'people'],
    transport_mode: ['transport mode', 'mode', 'vehicle', 'travel mode'],
  };

  for (let row = 1; row <= Math.min(lastRow, 8); row++) {
    const headers = [];
    for (let col = 1; col <= lastCol; col++) headers.push(normalizeExcelHeader(sheet.cell(row, col).value()));
    const cols = {};
    for (const [key, names] of Object.entries(aliases)) {
      const index = headers.findIndex((header) => names.includes(header));
      if (index >= 0) cols[key] = index;
    }
    if (cols.destination != null && cols.start_date != null) {
      const trips = [];
      for (let r = row + 1; r <= lastRow; r++) {
        const values = [];
        for (let c = 1; c <= lastCol; c++) values.push(sheet.cell(r, c).value());
        const trip = buildTripSummaryFromRow(values, cols);
        if (trip) trips.push(trip);
      }
      return trips;
    }
  }
  return [];
}

function findLabelValue(sheet, labels) {
  const usedRange = sheet.usedRange();
  if (!usedRange) return null;
  const lastRow = usedRange.endCell().rowNumber();
  const lastCol = usedRange.endCell().columnNumber();
  for (let row = 1; row <= Math.min(lastRow, 25); row++) {
    for (let col = 1; col <= lastCol; col++) {
      const normalized = normalizeExcelHeader(sheet.cell(row, col).value());
      if (labels.includes(normalized)) {
        const right = sheet.cell(row, col + 1).value();
        if (right !== undefined && right !== null && String(right).trim()) return right;
        const below = sheet.cell(row + 1, col).value();
        if (below !== undefined && below !== null && String(below).trim()) return below;
      }
    }
  }
  return null;
}

function parsePersonsColumn(sheet) {
  const usedRange = sheet.usedRange();
  if (!usedRange) return [];
  const lastRow = usedRange.endCell().rowNumber();
  const lastCol = usedRange.endCell().columnNumber();
  for (let row = 1; row <= Math.min(lastRow, 40); row++) {
    for (let col = 1; col <= lastCol; col++) {
      const normalized = normalizeExcelHeader(sheet.cell(row, col).value());
      if (['persons', 'members', 'people'].includes(normalized)) {
        const names = [];
        for (let r = row + 1; r <= lastRow; r++) {
          const value = excelCellText(sheet, r, col);
          const nextNorm = normalizeExcelHeader(value);
          if (!value) break;
          if (nextNorm.includes('expenses') || nextNorm === 'total') break;
          names.push(value);
        }
        return [...new Set(names)];
      }
    }
  }
  return [];
}

function findTripExpenseHeaderRow(sheet, titleRow, startCol, lastRow) {
  const lookAheadRows = Math.min(lastRow, titleRow + 4);
  for (let row = titleRow + 1; row <= lookAheadRows; row++) {
    const c1 = normalizeExcelHeader(sheet.cell(row, startCol).value());
    const c2 = normalizeExcelHeader(sheet.cell(row, startCol + 1).value());
    const c3 = normalizeExcelHeader(sheet.cell(row, startCol + 2).value());
    const c4 = normalizeExcelHeader(sheet.cell(row, startCol + 3).value());
    const hasItem = ['things', 'thing', 'item', 'items', 'details', 'description', 'particulars'].includes(c1);
    const hasQty = ['quantity', 'qty', 'count', 'units'].includes(c2);
    const hasPrice = ['price', 'rate', 'unit price', 'cost'].includes(c3);
    const hasTotal = ['total', 'amount', 'amt'].includes(c4);
    if (hasItem && (hasQty || hasPrice || hasTotal)) return row;
  }
  return titleRow + 1;
}

function parseTripDetailExpenses(sheet) {
  const usedRange = sheet.usedRange();
  if (!usedRange) return [];
  const lastRow = usedRange.endCell().rowNumber();
  const lastCol = usedRange.endCell().columnNumber();
  const expenses = [];
  for (let row = 1; row <= lastRow; row++) {
    for (let col = 1; col <= lastCol; col++) {
      const title = excelCellText(sheet, row, col);
      const normalizedTitle = normalizeExcelHeader(title);
      if (!normalizedTitle || normalizedTitle === 'total expenses' || !normalizedTitle.endsWith('expenses')) continue;
      const type = titleCaseWords(normalizedTitle.replace(/\bexpenses\b/, '').trim() || 'Other');
      const headerRow = findTripExpenseHeaderRow(sheet, row, col, lastRow);
      let blanks = 0;
      for (let r = headerRow + 1; r <= lastRow; r++) {
        const label = excelCellText(sheet, r, col);
        const qtyVal = sheet.cell(r, col + 1).value();
        const priceVal = sheet.cell(r, col + 2).value();
        const totalVal = sheet.cell(r, col + 3).value();
        const normalizedLabel = normalizeExcelHeader(label);
        const isNextExpenseSection = normalizedLabel
          && normalizedLabel !== 'total expenses'
          && normalizedLabel.endsWith('expenses')
          && !['things', 'thing', 'item', 'items', 'details', 'description', 'particulars'].includes(normalizedLabel);
        if (isNextExpenseSection) break;
        if (!label && !qtyVal && !priceVal && !totalVal) {
          blanks++;
          if (blanks >= 2) break;
          continue;
        }
        blanks = 0;
        if (['things', 'thing', 'item', 'items', 'details', 'description', 'particulars'].includes(normalizedLabel)) continue;
        if (normalizedLabel === 'total') break;
        const amount = parseExcelAmount(totalVal) || (() => {
          const qty = parseExcelAmount(qtyVal);
          const price = parseExcelAmount(priceVal);
          return qty != null && price != null ? Math.round(qty * price * 100) / 100 : null;
        })();
        if (!label || !amount || amount <= 0) continue;
        expenses.push({
          expense_type: type,
          details: label,
          quantity: parseExcelAmount(qtyVal) || 1,
          unit_price: parseExcelAmount(priceVal) || amount,
          amount,
          expense_date: null,
          notes: null,
        });
      }
    }
  }
  return expenses;
}

function buildTripInitialMemberMap(members = []) {
  const map = new Map();
  (members || []).forEach((member) => {
    const name = String(member?.member_name || member?.name || member || '').trim();
    if (!name) return;
    const token = normalizeExcelHeader(name).split(' ')[0] || '';
    const initial = token ? token.charAt(0).toUpperCase() : '';
    if (!initial) return;
    if (!map.has(initial)) map.set(initial, []);
    map.get(initial).push(name);
  });
  return map;
}

function expandEqualDivideMembers(rawValue, memberMap) {
  const raw = String(rawValue || '').trim().toUpperCase();
  if (!raw) return [];
  const letters = [...raw].filter((char) => /[A-Z]/.test(char));
  const picked = [];
  const usedNames = new Set();
  letters.forEach((letter) => {
    const matches = memberMap.get(letter) || [];
    const next = matches.find((name) => !usedNames.has(name));
    if (next) {
      picked.push(next);
      usedNames.add(next);
    }
  });
  return picked;
}

function findSpecialTripSplitHeaderRow(sheet) {
  const usedRange = sheet.usedRange();
  if (!usedRange) return null;
  const lastRow = usedRange.endCell().rowNumber();
  const lastCol = usedRange.endCell().columnNumber();
  for (let row = 1; row <= Math.min(lastRow, 25); row++) {
    const headers = [];
    for (let col = 1; col <= lastCol; col++) headers.push(normalizeExcelHeader(sheet.cell(row, col).value()));
    const dateIndex = headers.findIndex((header) => header === 'date');
    const thingIndex = headers.findIndex((header) => ['thing', 'things', 'item', 'details'].includes(header));
    const equalDivideIndex = headers.findIndex((header) => header === 'equal divide');
    const perPersonIndex = headers.findIndex((header) => header === 'per person');
    const amountIndexes = headers
      .map((header, index) => ({ header, index }))
      .filter((entry) => entry.header === 'amount' || entry.header.startsWith('amount '))
      .map((entry) => entry.index);
    let amountIndex = amountIndexes.length ? amountIndexes[amountIndexes.length - 1] : -1;
    if (perPersonIndex >= 0) {
      const beforePerPerson = amountIndexes.filter((index) => index < perPersonIndex);
      if (beforePerPerson.length) amountIndex = beforePerPerson[beforePerPerson.length - 1];
    }
    if (dateIndex >= 0 && thingIndex >= 0 && equalDivideIndex >= 0 && amountIndex >= 0) {
      return {
        row,
        dateCol: dateIndex + 1,
        thingCol: thingIndex + 1,
        amountCol: amountIndex + 1,
        equalDivideCol: equalDivideIndex + 1,
      };
    }
  }
  return null;
}

function parseTripSharedSplitSheet(sheet, tripMembers = [], sheetName = '') {
  const header = findSpecialTripSplitHeaderRow(sheet);
  if (!header) return [];
  const usedRange = sheet.usedRange();
  if (!usedRange) return [];
  const lastRow = usedRange.endCell().rowNumber();
  const memberMap = buildTripInitialMemberMap(tripMembers);
  const fallbackMemberNames = (tripMembers || []).map((member) => String(member?.member_name || '').trim()).filter(Boolean);
  const expenses = [];
  for (let row = header.row + 1; row <= lastRow; row++) {
    const dateVal = sheet.cell(row, header.dateCol).value();
    const thingVal = sheet.cell(row, header.thingCol).value();
    const amountVal = sheet.cell(row, header.amountCol).value();
    const equalDivideVal = sheet.cell(row, header.equalDivideCol).value();
    const details = String(thingVal || '').trim();
    const amount = parseExcelAmount(amountVal);
    const expenseDate = parseExcelDate(dateVal);
    if (!details && !amount && !equalDivideVal) continue;
    if (!details || !amount || amount <= 0 || !expenseDate) continue;
    let memberNames = expandEqualDivideMembers(equalDivideVal, memberMap);
    if (!memberNames.length && fallbackMemberNames.length) memberNames = [fallbackMemberNames[0]];
    const splitCount = memberNames.length || 1;
    const baseShare = Math.round((amount / splitCount) * 100) / 100;
    const splits = memberNames.map((memberName, index) => ({
      member_name: memberName,
      share_amount: index === 0
        ? Math.round((amount - baseShare * (splitCount - 1)) * 100) / 100
        : baseShare,
    }));
    const noteMembers = memberNames.length ? `Shared with ${memberNames.join(', ')}` : 'Imported shared split';
    expenses.push({
      expense_type: 'Imported',
      details,
      quantity: 1,
      unit_price: amount,
      amount,
      expense_date: expenseDate,
      notes: `Imported from shared split sheet (${sheetName}) · ${noteMembers}`,
      split_mode: 'equal',
      split_member_names: memberNames,
      split_code: String(equalDivideVal || '').trim().toUpperCase(),
      splits,
    });
  }
  return expenses;
}

function parseTripDetailSheet(sheet) {
  const destinationRaw = findLabelValue(sheet, ['location', 'destination', 'trip destination']);
  const startRaw = findLabelValue(sheet, ['start date']);
  const endRaw = findLabelValue(sheet, ['end date']);
  const distanceRaw = findLabelValue(sheet, ['total distance travelled', 'total distance', 'distance travelled', 'distance']);
  if (!destinationRaw || !startRaw) return null;
  const destination = String(destinationRaw).trim();
  const start_date = parseExcelDate(startRaw);
  if (!destination || !start_date) return null;
  const expenses = parseTripDetailExpenses(sheet).map((expense) => ({
    ...expense,
    expense_date: start_date,
  }));
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  return {
    destination,
    start_date,
    end_date: parseExcelDate(endRaw),
    total_distance: parseExcelAmount(distanceRaw),
    total_expenditure: Math.round(total * 100) / 100,
    status: inferImportedTripStatus(start_date, parseExcelDate(endRaw), ''),
    category: null,
    transport_mode: null,
    members: parsePersonsColumn(sheet),
    expenses,
    notes: 'Imported from detailed trip sheet',
  };
}

async function parseTripsExcelBuffer(buffer, sheetNames, password) {
  const opts = password ? { password } : {};
  const wb = await XlsxPopulate.fromDataAsync(buffer, opts);
  const allSheets = wb.sheets().map((sheet) => sheet.name());
  const targets = (Array.isArray(sheetNames) && sheetNames.length > 0)
    ? sheetNames.filter((name) => allSheets.includes(name))
    : [allSheets[0]];
  const trips = [];
  let skipped = 0;
  for (const sheetName of targets) {
    const sheet = wb.sheet(sheetName);
    const summaryTrips = parseTripSummarySheet(sheet);
    if (summaryTrips.length) {
      for (const trip of summaryTrips) trips.push(trip);
      continue;
    }
    const detailTrip = parseTripDetailSheet(sheet);
    if (detailTrip) {
      trips.push(detailTrip);
      continue;
    }
    skipped++;
  }
  return { trips, skipped };
}

async function parseTripExpenseExcelBuffer(buffer, sheetNames, password, tripMembers = []) {
  const opts = password ? { password } : {};
  const wb = await XlsxPopulate.fromDataAsync(buffer, opts);
  const allSheets = wb.sheets().map((sheet) => sheet.name());
  const targets = (Array.isArray(sheetNames) && sheetNames.length > 0)
    ? sheetNames.filter((name) => allSheets.includes(name))
    : [allSheets[0]];

  const expenses = [];
  let skipped = 0;

  for (const sheetName of targets) {
    const sheet = wb.sheet(sheetName);
    const sharedSplitExpenses = parseTripSharedSplitSheet(sheet, tripMembers, sheetName);
    if (sharedSplitExpenses.length) {
      for (const expense of sharedSplitExpenses) {
        expenses.push({
          expense_type: expense.expense_type || 'Imported',
          details: expense.details,
          quantity: expense.quantity != null ? Number(expense.quantity) : 1,
          unit_price: expense.unit_price != null ? Number(expense.unit_price) : Number(expense.amount || 0),
          amount: Number(expense.amount || 0),
          expense_date: expense.expense_date || null,
          notes: expense.notes || `Imported from shared split sheet (${sheetName})`,
          split_mode: expense.split_mode || 'equal',
          split_member_names: expense.split_member_names || [],
          split_code: expense.split_code || '',
          splits: expense.splits || [],
        });
      }
      continue;
    }

    const directExpenses = parseTripDetailExpenses(sheet);
    if (directExpenses.length) {
      for (const expense of directExpenses) {
        expenses.push({
          expense_type: expense.expense_type || 'Imported',
          details: expense.details,
          quantity: expense.quantity != null ? Number(expense.quantity) : 1,
          unit_price: expense.unit_price != null ? Number(expense.unit_price) : Number(expense.amount || 0),
          amount: Number(expense.amount || 0),
          expense_date: expense.expense_date || null,
          notes: expense.notes || `Imported from trip expense sheet (${sheetName})`,
        });
      }
      continue;
    }

    const detailTrip = parseTripDetailSheet(sheet);
    if (detailTrip?.expenses?.length) {
      for (const expense of detailTrip.expenses) {
        expenses.push({
          expense_type: expense.expense_type || 'Imported',
          details: expense.details,
          quantity: expense.quantity != null ? Number(expense.quantity) : 1,
          unit_price: expense.unit_price != null ? Number(expense.unit_price) : Number(expense.amount || 0),
          amount: Number(expense.amount || 0),
          expense_date: expense.expense_date || detailTrip.start_date || null,
          notes: expense.notes || `Imported from detailed trip sheet (${sheetName})`,
        });
      }
      continue;
    }

    const generic = await parseExcelBuffer(buffer, [sheetName], password);
    if (generic.rows.length) {
      for (const row of generic.rows) {
        expenses.push({
          expense_type: 'Imported',
          details: row.item_name,
          quantity: 1,
          unit_price: Number(row.amount || 0),
          amount: Number(row.amount || 0),
          expense_date: row.purchase_date,
          notes: row.is_extra ? `Imported from Excel sheet "${sheetName}" · Extra` : `Imported from Excel sheet "${sheetName}"`,
        });
      }
      skipped += Number(generic.skipped || 0);
      continue;
    }

    skipped++;
  }

  return { expenses, skipped };
}

async function parseExcelBuffer(buffer, sheetNames, password) {
  const opts = password ? { password } : {};
  const wb = await XlsxPopulate.fromDataAsync(buffer, opts);

  // Resolve which sheets to parse
  const allSheets = wb.sheets().map(s => s.name());
  const targets = (Array.isArray(sheetNames) && sheetNames.length > 0)
    ? sheetNames.filter(n => allSheets.includes(n))
    : [allSheets[0]];

  const expenses = [];
  let skipped = 0;

  for (const sheetName of targets) {
    const sheet = wb.sheet(sheetName);
    const usedRange = sheet.usedRange();
    if (!usedRange) continue;
    const lastRow = usedRange.endCell().rowNumber();

    for (let r = 2; r <= lastRow; r++) {
      const dateVal  = sheet.cell(r, 2).value();  // Col B
      const desc     = String(sheet.cell(r, 4).value() || '').trim();  // Col D
      const amtRaw   = sheet.cell(r, 5).value();  // Col E
      const extraVal = String(sheet.cell(r, 6).value() || '').trim().toUpperCase();  // Col F

      if (!desc) { skipped++; continue; }
      const amount = parseFloat(String(amtRaw).replace(/[^0-9.-]/g, '')) || 0;
      if (amount <= 0) { skipped++; continue; }
      const purchase_date = parseExcelDate(dateVal);
      if (!purchase_date) { skipped++; continue; }

      expenses.push({ item_name: desc, amount, purchase_date, is_extra: extraVal === 'Y' });
    }
  }
  return { rows: expenses, skipped };
}

async function parseCcExcelBuffer(buffer, sheetNames, password, defaultTxnDate) {
  const opts = password ? { password } : {};
  const wb = await XlsxPopulate.fromDataAsync(buffer, opts);
  const allSheets = wb.sheets().map(s => s.name());
  const targets = (Array.isArray(sheetNames) && sheetNames.length > 0)
    ? sheetNames.filter(n => allSheets.includes(n))
    : [allSheets[0]];

  const txns = [];
  let skipped = 0;

  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const headerAliases = {
    desc: ['thing', 'description', 'details', 'detail', 'item', 'particular', 'particulars', 'merchant', 'name', 'narration'],
    amount: ['amount', 'amt', 'debit', 'value', 'price'],
    date: ['date', 'txn date', 'transaction date', 'purchase date'],
  };
  const findCol = (headers, aliases) => headers.findIndex(h => aliases.includes(h));

  for (const sheetName of targets) {
    const sheet = wb.sheet(sheetName);
    const usedRange = sheet.usedRange();
    if (!usedRange) continue;
    const lastRow = usedRange.endCell().rowNumber();
    const lastCol = usedRange.endCell().columnNumber();

    let headerRow = 1;
    let descCol = -1, amountCol = -1, dateCol = -1;
    for (let r = 1; r <= Math.min(5, lastRow); r++) {
      const headers = Array.from({ length: lastCol }, (_, i) => norm(sheet.cell(r, i + 1).value()));
      const dCol = findCol(headers, headerAliases.desc);
      const aCol = findCol(headers, headerAliases.amount);
      if (dCol >= 0 && aCol >= 0) {
        headerRow = r;
        descCol = dCol + 1;
        amountCol = aCol + 1;
        dateCol = findCol(headers, headerAliases.date) + 1;
        break;
      }
    }
    if (descCol < 0 || amountCol < 0) {
      headerRow = 1;
      descCol = 1;
      amountCol = 2;
      dateCol = 0;
    }

    for (let r = headerRow + 1; r <= lastRow; r++) {
      const description = String(sheet.cell(r, descCol).value() || '').trim();
      const amtRaw = sheet.cell(r, amountCol).value();
      const amount = parseFloat(String(amtRaw).replace(/[^0-9.-]/g, '')) || 0;
      const txnDate = dateCol ? parseExcelDate(sheet.cell(r, dateCol).value()) : defaultTxnDate;
      if (!description || amount <= 0 || !txnDate) { skipped++; continue; }
      txns.push({ txn_date: txnDate, description, amount });
    }
  }

  return { rows: txns, skipped };
}

function parseExcelDate(val) {
  if (val === null || val === undefined || val === '') return null;
  const formatLocalDate = (date) => {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  };
  // xlsx-populate returns JS Date for date-formatted cells
  if (val instanceof Date) {
    return formatLocalDate(val);
  }
  // Excel numeric serial (rare with xlsx-populate but handle it)
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const str = String(val).trim();
  const MONS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  // DD-Mon-YY  e.g. "01-Mar-26"
  let m = str.match(/^(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{2,4})$/);
  if (m) {
    const day  = m[1].padStart(2, '0');
    const mon  = MONS[m[2].toLowerCase()];
    if (!mon) return null;
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${year}-${String(mon).padStart(2,'0')}-${day}`;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // YYYY-MM-DD
  m = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  const d = new Date(str);
  const formatted = formatLocalDate(d);
  if (formatted) return formatted;
  return null;
}

function parseExpenseBucketImportAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val * 100) / 100;
  const cleaned = String(val).replace(/[^0-9.\-]/g, '').trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function parseExpenseBucketImportWorkbook(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const requestedSheet = String(options?.sheet_name || '').trim();
  const targetSheets = requestedSheet && workbook.Sheets[requestedSheet]
    ? [requestedSheet]
    : workbook.SheetNames;
  const defaultName = String(options?.name || '').trim() || 'Imported expense';
  const entryType = String(options?.entry_type || '').trim() || null;
  const rows = [];
  let skipped = 0;

  for (const sheetName of targetSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    for (const row of matrix) {
      if (!Array.isArray(row) || !row.length) continue;
      const entryDate = parseExcelDate(row[0]);
      const amount = parseExpenseBucketImportAmount(row[1]);
      if (!entryDate) {
        const hasAnyValue = row.some((cell) => String(cell || '').trim());
        if (hasAnyValue) skipped += 1;
        continue;
      }
      if (!(amount > 0)) {
        skipped += 1;
        continue;
      }
      rows.push({
        name: defaultName,
        entry_type: entryType,
        entry_date: entryDate,
        amount,
        source_sheet: sheetName,
      });
    }
  }

  rows.sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));
  return { rows, skipped, sheet_names: targetSheets };
}

function parseFixedDepositImportWorkbook(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const requestedSheet = String(options?.sheet_name || '').trim();
  const targetSheets = requestedSheet && workbook.Sheets[requestedSheet]
    ? [requestedSheet]
    : workbook.SheetNames;
  const personName = String(options?.person_name || '').trim();
  if (!personName) {
    const error = new Error('Person name is required for FD import');
    error.statusCode = 400;
    throw error;
  }

  const rows = [];
  let skipped = 0;
  for (const sheetName of targetSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    for (const row of matrix) {
      if (!Array.isArray(row) || !row.length) continue;
      const bankName = String(row[0] || '').trim();
      const fdNumber = String(row[1] || '').trim();
      const interestRate = parseExpenseBucketImportAmount(row[2]);
      const tenureMonths = Number.parseInt(String(row[3] || '').trim(), 10) || null;
      const depositDate = parseExcelDate(row[4]);
      const maturityDate = parseExcelDate(row[5]);
      const amountDeposited = parseExpenseBucketImportAmount(row[6]);
      const maturityAmount = parseExpenseBucketImportAmount(row[7]);
      const interestAmount = parseExpenseBucketImportAmount(row[8]);

      const looksLikeData = bankName || fdNumber || depositDate || maturityDate || amountDeposited || maturityAmount || interestAmount;
      if (!looksLikeData) continue;
      if (!bankName || !fdNumber || !depositDate || !maturityDate || !(amountDeposited > 0)) {
        skipped += 1;
        continue;
      }
      rows.push({
        person_name: personName,
        bank_name: bankName,
        fd_number: fdNumber,
        interest_rate: interestRate,
        tenure_months: tenureMonths,
        deposit_date: depositDate,
        maturity_date: maturityDate,
        amount_deposited: amountDeposited,
        maturity_amount: maturityAmount,
        interest_amount: interestAmount,
        source_sheet: sheetName,
      });
    }
  }

  rows.sort((a, b) => String(a.maturity_date || '').localeCompare(String(b.maturity_date || '')) || String(a.deposit_date || '').localeCompare(String(b.deposit_date || '')));
  return { rows, skipped, sheet_names: targetSheets };
}

function parseImportDate(str) {
  if (!str) return null;
  // DD-MM-YYYY or DD/MM/YYYY
  let m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // YYYY-MM-DD
  m = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // Try Date parse
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

// ─── FRIENDS ─────────────────────────────────────────────────
router.get('/friends', async (req, res) => {
  try {
    const friends = await Promise.resolve(getCoreDb().getFriends(req.session.userId));
    const netBalance = friends.reduce((s, f) => s + f.balance, 0);
    res.json({ friends, netBalance: Math.round(netBalance * 100) / 100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/friends', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    const id = await Promise.resolve(coreDb.addFriend(req.session.userId, normalizeFriendName(req.body.name)));
    res.json({ success: true, id });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/friends/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().updateFriend(req.session.userId, req.params.id, normalizeFriendName(req.body.name)));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/friends/:id/link-user', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().linkFriendToUser(req.session.userId, req.params.id, req.body?.linked_user_id || null));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/friends/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteFriend(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/push/devices', async (req, res) => {
  try {
    const result = await Promise.resolve(pgDb.upsertPushDeviceToken(req.session.userId, req.body || {}));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/push/devices', async (req, res) => {
  try {
    const removed = await Promise.resolve(pgDb.deactivatePushDeviceToken(req.session.userId, req.body?.token));
    res.json({ success: true, removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/app-update-status', async (req, res) => {
  try {
    const latestAndroidVersion = normalizeAppVersionValue(process.env.LATEST_ANDROID_APP_VERSION);
    const latestIosVersion = normalizeAppVersionValue(process.env.LATEST_IOS_APP_VERSION);
    const latestAndroidDevice = await Promise.resolve(pgDb.getLatestPushDeviceForUser(req.session.userId, 'android'));
    const latestIosDevice = await Promise.resolve(pgDb.getLatestPushDeviceForUser(req.session.userId, 'ios'));
    const currentAndroidVersion = normalizeAppVersionValue(latestAndroidDevice?.app_version);
    const currentIosVersion = normalizeAppVersionValue(latestIosDevice?.app_version);
    const transport = String(req.session?.authTransport || '').trim().toLowerCase();
    const sessionPlatform = String(
      req.session?.clientPlatform
      || req.mobileSession?.platform
      || req.headers['x-client-platform']
      || ''
    ).trim().toLowerCase();
    const isMobileSession = transport === 'mobile';
    const androidSession = isMobileSession && (sessionPlatform === 'android');
    const iosSession = isMobileSession && ['ios', 'iphone', 'ipad'].includes(sessionPlatform);
    const androidUpdateAvailable = !!latestAndroidVersion && androidSession && (
      currentAndroidVersion
        ? compareAppVersions(currentAndroidVersion, latestAndroidVersion) < 0
        : true
    );
    const iosUpdateAvailable = !!latestIosVersion && iosSession && (
      currentIosVersion
        ? compareAppVersions(currentIosVersion, latestIosVersion) < 0
        : true
    );

    res.json({
      success: true,
      android: {
        enabled: !!latestAndroidVersion,
        latest_version: latestAndroidVersion || null,
        current_version: currentAndroidVersion || null,
        update_available: androidUpdateAvailable,
        force: isTruthyEnvFlag(process.env.ANDROID_UPDATE_FORCE),
        message: String(process.env.ANDROID_UPDATE_MESSAGE || '').trim() || null,
        store_url: String(process.env.ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.expenselyt.app').trim(),
        device_name: latestAndroidDevice?.device_name || null,
        last_seen_at: latestAndroidDevice?.last_seen_at || null,
        session_transport: transport || 'web',
        session_platform: sessionPlatform || null,
      },
      ios: {
        enabled: !!latestIosVersion,
        latest_version: latestIosVersion || null,
        current_version: currentIosVersion || null,
        update_available: iosUpdateAvailable,
        force: isTruthyEnvFlag(process.env.IOS_UPDATE_FORCE),
        message: String(process.env.IOS_UPDATE_MESSAGE || '').trim() || null,
        store_url: String(process.env.IOS_APP_STORE_URL || 'https://apps.apple.com/us/app/expenselyt/id6761451207').trim(),
        device_name: latestIosDevice?.device_name || null,
        last_seen_at: latestIosDevice?.last_seen_at || null,
        session_transport: transport || 'web',
        session_platform: sessionPlatform || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load app update status' });
  }
});

router.get('/notifications/preferences', async (req, res) => {
  try {
    const preferences = await Promise.resolve(pgDb.getUserNotificationPreferences(req.session.userId));
    res.json({ preferences });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/notifications/preferences', async (req, res) => {
  try {
    const preferences = await Promise.resolve(pgDb.updateUserNotificationPreferences(req.session.userId, req.body || {}));
    res.json({ success: true, preferences });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const unread = await Promise.resolve(pgDb.getUnreadNotificationCount(req.session.userId));
    res.json({ unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const limit = Number(req.query?.limit || 50);
    const offset = Number(req.query?.offset || 0);
    const [notifications, unread] = await Promise.all([
      Promise.resolve(pgDb.listUserNotifications(req.session.userId, { limit, offset })),
      Promise.resolve(pgDb.getUnreadNotificationCount(req.session.userId)),
    ]);
    res.json({ notifications, unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/notifications/:id/read', async (req, res) => {
  try {
    const notification = await Promise.resolve(
      pgDb.markUserNotificationRead(req.session.userId, req.params.id, req.body?.is_read !== false)
    );
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    const unread = await Promise.resolve(pgDb.getUnreadNotificationCount(req.session.userId));
    res.json({ success: true, notification, unread });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    const updated = await Promise.resolve(pgDb.markAllUserNotificationsRead(req.session.userId, req.body?.is_read !== false));
    const unread = await Promise.resolve(pgDb.getUnreadNotificationCount(req.session.userId));
    res.json({ success: true, updated, unread });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── LOAN TRANSACTIONS ──────────────────────────────────────
router.get('/loans/:friendId', async (req, res) => {
  try {
    const txns = await Promise.resolve(getCoreDb().getLoanTransactions(req.session.userId, req.params.friendId));
    const totalPaid = txns.reduce((s, t) => s + t.paid, 0);
    const totalReceived = txns.reduce((s, t) => s + t.received, 0);
    res.json({ transactions: txns, totalPaid, totalReceived, balance: Math.round((totalPaid - totalReceived)*100)/100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/loans', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    const { friend_id, txn_date, details, paid, received } = req.body;
    if (!friend_id || !details) return res.status(400).json({ error: 'Missing fields' });
    const id = await Promise.resolve(coreDb.addLoanTransaction(req.session.userId, { friend_id, txn_date, details, paid: parseFloat(paid)||0, received: parseFloat(received)||0 }));
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/loans/:id', async (req, res) => {
  try {
    const { txn_date, details, paid, received } = req.body;
    await Promise.resolve(getCoreDb().updateLoanTransaction(req.session.userId, req.params.id, { txn_date, details, paid: parseFloat(paid)||0, received: parseFloat(received)||0 }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/loans/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteLoanTransaction(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DIVIDE EXPENSES ─────────────────────────────────────────
router.get('/divide', async (req, res) => {
  try {
    const groups = await Promise.resolve(getCoreDb().getDivideGroups(req.session.userId));
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/divide/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteDivideGroup(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.message === 'Not found' ? 404 : 500).json({ error: err.message });
  }
});

router.post('/divide', async (req, res) => {
  try {
    const { divide_date, details, paid_by, total_amount, splits, auto_loans, heading, session_id } = req.body;
    if (!details || !total_amount || !splits || splits.length === 0) return res.status(400).json({ error: 'Missing fields' });
    const id = await Promise.resolve(getCoreDb().addDivideGroup(req.session.userId, { divide_date, details, paid_by, total_amount: parseFloat(total_amount), splits, auto_loans, heading, session_id }));
    res.json({ success: true, id });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/divide/share-session', async (req, res) => {
  try {
    const result = await Promise.resolve(
      getCoreDb().syncDivideSessionShares(req.session.userId, req.body?.session_key, req.body?.friend_ids || [])
    );
    const targetUserIds = Array.isArray(result?.target_user_ids) ? result.target_user_ids : [];
    if (targetUserIds.length) {
      sendSplitShareEmailsToTargets(req.session.userId, targetUserIds, req.body?.session_key).catch(() => {});
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/divide/shared', async (req, res) => {
  try {
    const groups = await Promise.resolve(getCoreDb().getReceivedDivideShares(req.session.userId));
    res.json({ groups });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/divide/shared/hide', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().hideReceivedDivideShare(req.session.userId, req.body?.owner_user_id, req.body?.session_key));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Petrol Divide
router.get('/petrol-divide/months', async (req, res) => {
  try {
    const months = await Promise.resolve(getPetrolDb().getPetrolDivideMonths(req.session.userId));
    res.json({ months });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/petrol-divide/months/:month', async (req, res) => {
  try {
    const months = await Promise.resolve(getPetrolDb().deletePetrolDivideMonth(req.session.userId, req.params.month));
    res.json({ success: true, months });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/petrol-divide', async (req, res) => {
  try {
    const monthKey = String(req.query.month || new Date().toISOString().slice(0, 7));
    const data = await Promise.resolve(getPetrolDb().getPetrolDivideMonth(req.session.userId, monthKey));
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/petrol-divide/config', async (req, res) => {
  try {
    const data = await Promise.resolve(getPetrolDb().savePetrolDivideMonthConfig(req.session.userId, req.body || {}));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/petrol-divide/entries', async (req, res) => {
  try {
    const data = await Promise.resolve(getPetrolDb().addPetrolDivideEntry(req.session.userId, req.body || {}));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/petrol-divide/entries/:id(\\d+)', async (req, res) => {
  try {
    const data = await Promise.resolve(getPetrolDb().updatePetrolDivideEntry(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/petrol-divide/entries/:id(\\d+)', async (req, res) => {
  try {
    const data = await Promise.resolve(getPetrolDb().deletePetrolDivideEntry(req.session.userId, req.params.id));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/petrol-divide/fake/generate', async (req, res) => {
  try {
    const monthKey = String(req.body?.month_key || '').trim();
    const increasePct = Number(req.body?.increase_pct || 0);
    const data = await Promise.resolve(getPetrolDb().generatePetrolDivideFakeEntries(req.session.userId, monthKey, increasePct));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/petrol-divide/adjustments', async (req, res) => {
  try {
    const data = await Promise.resolve(getPetrolDb().savePetrolDivideMonthAdjustments(req.session.userId, req.body || {}));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/petrol-divide/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const monthKey = String(req.body?.month_key || '').trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return res.status(400).json({ error: 'Valid month_key is required (YYYY-MM)' });

    const defaultAverage = Number(req.body?.default_average_kmpl || req.body?.average_kmpl || 0);
    const rawSelf = String(req.body?.self_initial || '').trim().toUpperCase();
    const user = await Promise.resolve(pgDb.findUserById(req.session.userId));
    const fallbackSelf = String(user?.display_name || user?.username || 'H').trim().charAt(0).toUpperCase() || 'H';
    const selfInitial = (rawSelf || fallbackSelf).charAt(0);
    const sheets = parseSheetParam(req.body?.sheets);

    const parsed = await parsePetrolExcelBuffer(req.file.buffer, sheets, req.body?.password);
    const sourceRows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    if (!sourceRows.length) return res.status(400).json({ error: 'No valid rows found in file' });

    const monthData = await Promise.resolve(getPetrolDb().getPetrolDivideMonth(req.session.userId, monthKey));
    const monthMembers = Array.isArray(monthData?.month_members) ? monthData.month_members : [];
    const allFriends = Array.isArray(monthData?.live_split_friends) ? monthData.live_split_friends : [];
    const monthMemberIds = new Set(monthMembers.map((m) => Number(m.friend_id)).filter((id) => id > 0));
    const friends = monthMemberIds.size
      ? allFriends.filter((friend) => monthMemberIds.has(Number(friend?.id)))
      : allFriends;
    const initialsMap = new Map();
    const registerInitial = (raw, friendId) => {
      const initial = String(raw || '').trim().charAt(0).toUpperCase();
      if (!initial) return;
      if (initialsMap.has(initial) && initialsMap.get(initial) !== friendId) {
        initialsMap.set(initial, null); // ambiguous initial
        return;
      }
      if (!initialsMap.has(initial)) initialsMap.set(initial, friendId);
    };
    for (const friend of friends) {
      const friendId = Number(friend?.id);
      if (!(friendId > 0)) continue;
      registerInitial(friend?.name, friendId);
      registerInitial(friend?.linked_user_display_name, friendId);
      registerInitial(friend?.linked_user_username, friendId);
    }

    let imported = 0;
    let skipped = Number(parsed?.skipped || 0);
    const skippedRows = [];

    for (let i = 0; i < sourceRows.length; i++) {
      const row = sourceRows[i] || {};
      const rowNo = Number(row.source_row) > 0 ? Number(row.source_row) : (i + 2);
      const entryDate = String(row.entry_date || '').trim();
      if (!entryDate || entryDate.slice(0, 7) !== monthKey) {
        skipped++;
        skippedRows.push({ row: rowNo, reason: `Date ${entryDate || '-'} is outside selected month ${monthKey}` });
        continue;
      }

      const distanceKm = Number(row.distance_km || 0);
      const averageKmpl = Number(row.average_kmpl || defaultAverage || 0);
      if (!(distanceKm > 0) || !(averageKmpl > 0)) {
        skipped++;
        skippedRows.push({ row: rowNo, reason: 'Distance/average is invalid (average can be passed in import modal)' });
        continue;
      }

      const letters = [...new Set(String(row.members || '').toUpperCase().split('').filter((ch) => /[A-Z0-9]/.test(ch)))];
      const friendIds = [];
      const unknown = [];
      for (const ch of letters) {
        if (ch === selfInitial) continue;
        const mapped = initialsMap.get(ch);
        if (mapped === null) {
          unknown.push(`${ch} (ambiguous)`);
          continue;
        }
        if (!(Number(mapped) > 0)) {
          unknown.push(ch);
          continue;
        }
        friendIds.push(Number(mapped));
      }
      if (unknown.length) {
        skipped++;
        skippedRows.push({ row: rowNo, reason: `Unknown/ambiguous member initials: ${unknown.join(', ')}` });
        continue;
      }

      try {
        const petrolPrice = row.petrol_price === null || row.petrol_price === undefined || row.petrol_price === ''
          ? NaN
          : Number(row.petrol_price);
        await Promise.resolve(getPetrolDb().addPetrolDivideEntry(req.session.userId, {
          month_key: monthKey,
          entry_date: entryDate,
          remarks: String(row.remarks || '').trim(),
          ...(Number.isFinite(petrolPrice) && petrolPrice >= 0 ? { petrol_price: petrolPrice } : {}),
          distance_km: distanceKm,
          average_kmpl: averageKmpl,
          member_friend_ids: friendIds,
        }));
        imported++;
      } catch (err) {
        skipped++;
        skippedRows.push({ row: rowNo, reason: err?.message || 'Could not import row' });
      }
    }

    const latest = await Promise.resolve(getPetrolDb().getPetrolDivideMonth(req.session.userId, monthKey));
    res.json({
      success: true,
      imported,
      skipped,
      skipped_rows: skippedRows.slice(0, 25),
      self_initial: selfInitial,
      ...latest,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Import failed' });
  }
});

router.post('/petrol-divide/share-link', async (req, res) => {
  try {
    const result = await Promise.resolve(getPetrolDb().createPetrolDivideShareLink(req.session.userId, req.body || {}));
    const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${String(base || '').replace(/\/+$/, '')}/p/${encodeURIComponent(result.token)}`;
    res.json({ success: true, ...result, url });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/petrol-divide/add-to-live-split', async (req, res) => {
  try {
    const monthKey = String(req.body?.month_key || '').trim();
    const viewMode = String(req.body?.view_mode || 'real').toLowerCase();
    const data = await Promise.resolve(getPetrolDb().getPetrolDivideMonthlySettlements(req.session.userId, monthKey, viewMode));
    const settlements = Array.isArray(data?.settlements) ? data.settlements : [];
    let created = 0;
    for (const row of settlements) {
      const amount = Number(row?.amount || 0);
      const friendId = Number(row?.friend_id || 0);
      if (!(amount > 0) || !(friendId > 0)) continue;
      const sessionId = `petrol-${monthKey}-${friendId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await Promise.resolve(getCoreDb().addLiveSplitGroup(req.session.userId, {
        divide_date: getPetrolDb().monthToDate(monthKey),
        details: `Petrol share for ${monthKey}`,
        paid_by: 'You',
        total_amount: amount,
        split_mode: 'settlement',
        trip_id: null,
        heading: `Petrol ${monthKey}`,
        session_id: sessionId,
        splits: [{ friend_id: friendId, friend_name: row.friend_name, share_amount: amount }],
      }));
      await Promise.resolve(getCoreDb().syncLiveSplitSessionShares(req.session.userId, sessionId, [friendId]));
      created += 1;
    }
    res.json({ success: true, created, month_key: monthKey });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Live Split (isolated from friends/divide)
router.get('/live-split/friends', async (req, res) => {
  try {
    const [friends, liveSplitAccess] = await Promise.all([
      Promise.resolve(getCoreDb().getLiveSplitFriends(req.session.userId)),
      Promise.resolve(pgDb.getUserLiveSplitAccess(req.session.userId)),
    ]);
    const canDeleteFriend = !!liveSplitAccess?.delete_friend;
    const normalizedFriends = (friends || []).map((friend) => ({
      ...friend,
      can_delete: canDeleteFriend,
    }));
    res.json({ friends: normalizedFriends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/live-split/friends/:id/activity', async (req, res) => {
  try {
    const activities = await Promise.resolve(getCoreDb().getLiveSplitFriendActivities(req.session.userId, req.params.id, req.query?.limit));
    res.json({ activities });
  } catch (err) {
    res.status(err.message === 'Live split friend not found' ? 404 : 500).json({ error: err.message });
  }
});

router.post('/live-split/friends/:id/nudge', async (req, res) => {
  try {
    const friendId = Number(req.params.id || 0);
    if (!(friendId > 0)) return res.status(400).json({ error: 'Valid friend id is required.' });

    const amountValue = roundCurrencyAmount(req.body?.amount);
    if (!(amountValue > 0)) {
      return res.status(400).json({ error: 'Nudge amount must be greater than 0.' });
    }
    const nudgeDirection = String(req.body?.direction || 'they_owe_me').trim().toLowerCase() === 'i_owe_them'
      ? 'i_owe_them'
      : 'they_owe_me';

    const [me, friends] = await Promise.all([
      Promise.resolve(pgDb.findUserById(req.session.userId)),
      Promise.resolve(getCoreDb().getLiveSplitFriends(req.session.userId)),
    ]);
    const liveSplitAccess = await Promise.resolve(pgDb.getUserLiveSplitAccess(req.session.userId));
    const nudgeAccess = liveSplitAccess?.nudge || null;
    if (!nudgeAccess?.enabled) {
      return res.status(403).json({ error: nudgeAccess?.message || 'Live Split nudges are not included in your current plan.' });
    }
    if (!nudgeAccess?.can_use) {
      return res.status(402).json({
        error: nudgeAccess?.message || `You have used all Live Split nudges for this ${nudgeAccess?.period || 'day'}.`,
        access: liveSplitAccess,
      });
    }
    const friend = (friends || []).find((item) => Number(item?.id || 0) === friendId);
    if (!friend) return res.status(404).json({ error: 'Live Split friend not found.' });

    const targetUserId = Number(friend?.linked_user_id || 0);
    if (!(targetUserId > 0)) {
      return res.status(400).json({ error: 'This friend is not linked to an app user yet.' });
    }
    if (targetUserId === Number(req.session.userId)) {
      return res.status(400).json({ error: 'You cannot nudge yourself.' });
    }

    const actorName = String(me?.display_name || me?.username || 'Someone').trim() || 'Someone';
    const friendName = String(friend?.name || 'your friend').trim() || 'your friend';
    const targetCurrency = String(req.body?.currency_code || me?.currency_code || 'INR').trim().toUpperCase() || 'INR';
    const targetLocale = String(req.body?.locale_code || me?.locale_code || 'en-IN').trim() || 'en-IN';
    const amountLabel = formatNotificationCurrency(amountValue, targetCurrency, targetLocale);
    const sameFriendDailyLimit = Number(nudgeAccess?.same_friend_daily_limit || 1);
    if (sameFriendDailyLimit !== -1) {
      const sameFriendDayUsed = await Promise.resolve(pgDb.countUserLiveSplitNudgesForFriendOnDay(req.session.userId, friendId));
      if (sameFriendDayUsed >= sameFriendDailyLimit) {
        return res.status(429).json({
          error: `You can nudge the same person only ${sameFriendDailyLimit} time${sameFriendDailyLimit === 1 ? '' : 's'} per day on your current plan.`,
          access: liveSplitAccess,
        });
      }
    }
    const title = nudgeDirection === 'i_owe_them'
      ? `Balance update from ${actorName}`
      : `Payment reminder from ${actorName}`;
    const body = nudgeDirection === 'i_owe_them'
      ? `${actorName} nudged you in Live Split for ${amountLabel}. Open the app to review that ${actorName} owes you this amount.`
      : `${actorName} nudged you in Live Split for ${amountLabel}. Open the app to review what you owe ${friendName === actorName ? 'them' : actorName}.`;

    const result = await sendStoredNotificationToUser(targetUserId, {
      type: 'live_split_nudge',
      dedupe_key: `${req.session.userId}:${friendId}:${nudgeDirection}:${Date.now()}:${Math.floor(Math.random() * 1000000)}`,
      title,
      body,
      target_screen: 'LiveSplit',
      target_params: {
        source_user_id: Number(req.session.userId),
        source_friend_id: friendId,
      },
      data: {
        source_user_id: Number(req.session.userId),
        source_friend_id: friendId,
        amount: amountValue,
        currency_code: targetCurrency,
        direction: nudgeDirection,
      },
    });

    if (!result?.created) throw new Error('Could not create Live Split nudge notification.');

    const usageAccess = await Promise.resolve(pgDb.consumeUserLiveSplitNudgeUsage(req.session.userId, friendId, nudgeDirection)).then(() => pgDb.getUserLiveSplitAccess(req.session.userId));

    res.json({
      success: true,
      already_sent: false,
      sent_push_count: Number(result?.sent || 0),
      notification_id: Number(result?.created?.id || 0) || null,
      access: usageAccess || liveSplitAccess,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not send Live Split nudge.' });
  }
});

router.post('/live-split/friends', async (req, res) => {
  try {
    const id = await Promise.resolve(getCoreDb().addLiveSplitFriend(req.session.userId, req.body?.name));
    res.json({ success: true, id });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.put('/live-split/friends/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().updateLiveSplitFriend(req.session.userId, req.params.id, req.body?.name));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.put('/live-split/friends/:id/link-user', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().linkLiveSplitFriendToUser(req.session.userId, req.params.id, req.body?.linked_user_id ?? null));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.delete('/live-split/friends/:id', async (req, res) => {
  try {
    const liveSplitAccess = await Promise.resolve(pgDb.getUserLiveSplitAccess(req.session.userId));
    if (!liveSplitAccess?.delete_friend) {
      return res.status(403).json({ error: 'Your current plan does not allow deleting Live Split friends.' });
    }
    await Promise.resolve(getCoreDb().deleteLiveSplitFriend(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/live-split/invite', async (req, res) => {
  try {
    const targetRaw = String(req.body?.target || '').trim();
    if (!targetRaw) return res.status(400).json({ error: 'Enter email or phone to invite.' });

    const byEmail = isEmailAddress(targetRaw);
    const normalizedPhone = byEmail ? '' : normalizePhone(targetRaw);
    if (!byEmail && !normalizedPhone) {
      return res.status(400).json({ error: 'Use a valid email or phone number.' });
    }

    const me = await Promise.resolve(pgDb.findUserById(req.session.userId));
    const inviterName = String(me?.display_name || me?.username || 'A friend').trim();
    const appBase = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

    const existing = byEmail
      ? await Promise.resolve(pgDb.findUserByEmail(targetRaw.toLowerCase()))
      : await Promise.resolve(pgDb.findUserByMobile(normalizedPhone));

    if (existing?.id && Number(existing.id) === Number(req.session.userId)) {
      return res.status(400).json({ error: 'You cannot invite yourself.' });
    }

    // If app user already exists, create request so they can accept from their Live Split screen.
    if (existing?.id) {
      const targetName = String(existing.display_name || existing.username || deriveInviteName(targetRaw)).trim();
      const liveFriends = await Promise.resolve(getCoreDb().getLiveSplitFriends(req.session.userId));
      const existingLinked = liveFriends.find((item) => Number(item.linked_user_id) === Number(existing.id));
      if (!existingLinked) {
        const sameName = liveFriends.find((item) => String(item.name || '').trim().toLowerCase() === targetName.toLowerCase());
        if (!sameName) {
          await Promise.resolve(getCoreDb().addLiveSplitFriend(req.session.userId, targetName));
        }
      }
      const invite = await Promise.resolve(getCoreDb().createLiveSplitInvite({
        inviterUserId: req.session.userId,
        targetUserId: Number(existing.id),
        targetEmail: existing.email || null,
        targetPhone: existing.mobile || null,
        targetName,
      }));
      notifyLiveSplitInviteReceived(req.session.userId, Number(existing.id), Number(invite?.id || 0), { resent: false }).catch(() => {});
      return res.json({ success: true, mode: 'invite_created', message: 'Request sent. User can accept in Live Split.' });
    }

    const fallbackName = String(req.body?.fallback_name || '').trim();
    const inviteName = String(fallbackName || deriveInviteName(targetRaw))
      .replace(/[^A-Za-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Friend';
    const liveFriends = await Promise.resolve(getCoreDb().getLiveSplitFriends(req.session.userId));
    if (!liveFriends.find((item) => String(item.name || '').trim().toLowerCase() === inviteName.toLowerCase())) {
      await Promise.resolve(getCoreDb().addLiveSplitFriend(req.session.userId, inviteName));
    }
    const invite = await Promise.resolve(getCoreDb().createLiveSplitInvite({
      inviterUserId: req.session.userId,
      targetEmail: byEmail ? targetRaw.toLowerCase() : null,
      targetPhone: byEmail ? null : normalizedPhone,
      targetName: inviteName,
    }));
    const inviteLink = buildLiveSplitInviteRegisterUrl(appBase, invite?.invite_token);

    if (byEmail) {
      const emailResult = await sendLiveSplitInviteEmail({
        to: targetRaw.toLowerCase(),
        inviterName,
        inviteLink,
      });
      if (!emailResult?.sent) {
        return res.status(400).json({ error: 'Email not configured on server. Set SMTP settings first.' });
      }
      return res.json({ success: true, mode: 'invite_sent', channel: 'email', message: 'Invite email sent.' });
    }

    if (!isSmsEnabled()) {
      return res.status(400).json({ error: 'SMS not configured on server. Set Twilio settings first.' });
    }
    const smsResult = await sendSms({
      to: normalizedPhone,
      body: `${inviterName} invited you to join Live Split on Expense Lite AI. Sign up: ${inviteLink}`,
    });
    if (!smsResult?.sent) {
      return res.status(400).json({ error: 'Could not send SMS invite.' });
    }
    return res.json({ success: true, mode: 'invite_sent', channel: 'sms', message: 'Invite SMS sent.' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to send invite.' });
  }
});

router.post('/live-split/invite-user', async (req, res) => {
  try {
    const targetUserId = Number(req.body?.target_user_id || 0);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ error: 'target_user_id is required' });
    }
    if (targetUserId === Number(req.session.userId)) {
      return res.status(400).json({ error: 'You cannot invite yourself.' });
    }
    const target = await Promise.resolve(pgDb.findUserById(targetUserId));
    if (!target?.id) return res.status(404).json({ error: 'User not found' });
    const targetName = String(target.display_name || target.username || 'Friend').trim();
    const liveFriends = await Promise.resolve(getCoreDb().getLiveSplitFriends(req.session.userId));
    const existingLinked = liveFriends.find((item) => Number(item.linked_user_id) === Number(target.id));
    if (!existingLinked) {
      const sameName = liveFriends.find((item) => String(item.name || '').trim().toLowerCase() === targetName.toLowerCase());
      if (!sameName) {
        await Promise.resolve(getCoreDb().addLiveSplitFriend(req.session.userId, targetName));
      }
    }
    const invite = await Promise.resolve(getCoreDb().createLiveSplitInvite({
      inviterUserId: req.session.userId,
      targetUserId: Number(target.id),
      targetEmail: target.email || null,
      targetPhone: target.mobile || null,
      targetName,
    }));
    notifyLiveSplitInviteReceived(req.session.userId, Number(target.id), Number(invite?.id || 0), { resent: false }).catch(() => {});
    return res.json({ success: true, mode: 'invite_created', message: 'Request sent. User can accept in Live Split.' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to send request.' });
  }
});

router.get('/live-split/invites/incoming', async (req, res) => {
  try {
    const me = await Promise.resolve(pgDb.findUserById(req.session.userId));
    const invites = await Promise.resolve(getCoreDb().getIncomingLiveSplitInvites(req.session.userId, me?.email || '', me?.mobile || ''));
    return res.json({ invites });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/live-split/invites/outgoing', async (req, res) => {
  try {
    const invites = await Promise.resolve(getCoreDb().getOutgoingLiveSplitInvites(req.session.userId));
    return res.json({ invites });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/live-split/invites/:id/accept', async (req, res) => {
  try {
    const me = await Promise.resolve(pgDb.findUserById(req.session.userId));
    const result = await Promise.resolve(getCoreDb().acceptLiveSplitInvite(req.session.userId, req.params.id, me || {}));
    notifyLiveSplitInviteResponded(
      Number(result?.inviter_user_id || 0),
      Number(req.session.userId || 0),
      Number(req.params.id || 0),
      'accepted'
    ).catch(() => {});
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/live-split/invites/:id/reject', async (req, res) => {
  try {
    const me = await Promise.resolve(pgDb.findUserById(req.session.userId));
    const invite = await Promise.resolve(getCoreDb().getIncomingLiveSplitInvites(req.session.userId, me?.email || '', me?.mobile || ''));
    const currentInvite = (invite || []).find((item) => Number(item.id) === Number(req.params.id));
    await Promise.resolve(getCoreDb().rejectLiveSplitInvite(req.session.userId, req.params.id, me || {}));
    if (currentInvite?.inviter_user_id) {
      notifyLiveSplitInviteResponded(
        Number(currentInvite.inviter_user_id || 0),
        Number(req.session.userId || 0),
        Number(req.params.id || 0),
        'rejected'
      ).catch(() => {});
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/live-split/invites/:id/cancel', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().cancelLiveSplitInviteForInviter(req.session.userId, req.params.id));
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/live-split/invites/:id/resend', async (req, res) => {
  try {
    const invite = await Promise.resolve(getCoreDb().getLiveSplitInviteByIdForInviter(req.session.userId, req.params.id));
    if (!invite) return res.status(404).json({ error: 'Pending invite not found' });

    const me = await Promise.resolve(pgDb.findUserById(req.session.userId));
    const inviterName = String(me?.display_name || me?.username || 'A friend').trim();
    const appBase = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const targetUserId = Number(invite.target_user_id || 0);
    if (targetUserId > 0) {
      notifyLiveSplitInviteReceived(req.session.userId, targetUserId, Number(invite.id || 0), { resent: true }).catch(() => {});
      return res.json({ success: true, channel: 'push', message: 'Invite sent again as a push notification.' });
    }

    const targetEmail = String(invite.target_email || invite.target_user_email || '').trim().toLowerCase();
    if (targetEmail) {
      const inviteLink = buildLiveSplitInviteRegisterUrl(appBase, invite.invite_token);
      const emailResult = await sendLiveSplitInviteEmail({
        to: targetEmail,
        inviterName,
        inviteLink,
      });
      if (!emailResult?.sent) return res.status(400).json({ error: 'Email not configured on server. Set SMTP settings first.' });
      return res.json({ success: true, channel: 'email', message: 'Invite sent again by email.' });
    }

    const normalizedPhone = normalizePhone(String(invite.target_phone || invite.target_user_mobile || '').trim());
    if (normalizedPhone) {
      if (!isSmsEnabled()) return res.status(400).json({ error: 'SMS not configured on server. Set Twilio settings first.' });
      const inviteLink = buildLiveSplitInviteRegisterUrl(appBase, invite.invite_token);
      const smsResult = await sendSms({
        to: normalizedPhone,
        body: `${inviterName} invited you to join Live Split on Expense Lite AI. Sign up: ${inviteLink}`,
      });
      if (!smsResult?.sent) return res.status(400).json({ error: 'Could not send SMS invite.' });
      return res.json({ success: true, channel: 'sms', message: 'Invite sent again by SMS.' });
    }

    return res.json({ success: true, message: 'Request is still pending. User can accept in Live Split.' });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not resend invite.' });
  }
});

router.get('/live-split/groups', async (req, res) => {
  try {
    const groups = await Promise.resolve(getCoreDb().getLiveSplitGroups(req.session.userId));
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/live-split/groups/:id(\\d+)', async (req, res) => {
  try {
    const group = await Promise.resolve(getCoreDb().getLiveSplitGroupDetailForUser(req.session.userId, req.params.id));
    if (!group) return res.status(404).json({ error: 'Not found' });
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/live-split/groups/:id(\\d+)/expense-status', async (req, res) => {
  try {
    const result = await Promise.resolve(
      getCoreDb().markLiveSplitExpenseAdded(req.session.userId, req.params.id, req.body?.added !== false)
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || (err.message === 'Not found' ? 404 : 500)).json({ error: err.message });
  }
});

router.get('/live-split/trips', async (req, res) => {
  try {
    const trips = await Promise.resolve(getCoreDb().getLiveSplitTrips(req.session.userId));
    res.json({ trips });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/live-split/trips', async (req, res) => {
  try {
    const id = await Promise.resolve(
      getCoreDb().createLiveSplitTrip(req.session.userId, {
        name: req.body?.name,
        start_date: req.body?.start_date,
        end_date: req.body?.end_date,
        show_add_to_expense_option: req.body?.show_add_to_expense_option !== false,
        notes: req.body?.notes,
        members: req.body?.members || [],
      })
    );
    notifyLiveSplitTripCreated(req.session.userId, id).catch(() => {});
    res.json({ success: true, id });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/live-split/trips/:id(\\d+)', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().updateLiveSplitTrip(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/live-split/trips/:id(\\d+)', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteLiveSplitTrip(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/live-split/trips/:id(\\d+)/add-to-expense', async (req, res) => {
  try {
    const result = await Promise.resolve(
      getCoreDb().addLiveSplitTripToExpense(req.session.userId, req.params.id, {
        expense_type: req.body?.expense_type,
      })
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/live-split/trips/:id(\\d+)/members', async (req, res) => {
  try {
    const result = await Promise.resolve(
      getCoreDb().addLiveSplitTripMembers(req.session.userId, req.params.id, req.body?.members || [])
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/live-split/trips/:id(\\d+)/members/:mid(\\d+)', async (req, res) => {
  try {
    const result = await Promise.resolve(
      getCoreDb().removeLiveSplitTripMember(req.session.userId, req.params.id, req.params.mid)
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/live-split/groups', async (req, res) => {
  try {
    const { divide_date, details, paid_by, total_amount, splits, heading, session_id, split_mode, trip_id, owner_added_to_expense, allow_duplicate } = req.body;
    if (!details || !total_amount || !Array.isArray(splits)) return res.status(400).json({ error: 'Missing fields' });
    const id = await Promise.resolve(
      getCoreDb().addLiveSplitGroup(req.session.userId, {
        divide_date,
        details,
        paid_by,
        total_amount: parseFloat(total_amount),
        split_mode: String(split_mode || 'equal'),
        trip_id: trip_id || null,
        splits,
        heading,
        session_id,
        owner_added_to_expense: !!owner_added_to_expense,
        allow_duplicate: !!allow_duplicate,
      })
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/live-split/groups/:id(\\d+)', async (req, res) => {
  try {
    const { divide_date, details, paid_by, total_amount, splits, heading, split_mode, trip_id, allow_duplicate } = req.body;
    if (!details || !total_amount || !Array.isArray(splits)) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    await Promise.resolve(
      getCoreDb().updateLiveSplitGroup(req.session.userId, req.params.id, {
        divide_date,
        details,
        paid_by,
        total_amount: parseFloat(total_amount),
        split_mode: String(split_mode || 'equal'),
        trip_id: trip_id || null,
        splits,
        heading,
        allow_duplicate: !!allow_duplicate,
      })
    );
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || (err.message === 'Not found' ? 404 : 500)).json({ error: err.message });
  }
});

router.delete('/live-split/groups/:id(\\d+)', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteLiveSplitGroup(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.message === 'Not found' ? 404 : 500).json({ error: err.message });
  }
});

router.post('/live-split/groups/share-session', async (req, res) => {
  try {
    const result = await Promise.resolve(
      getCoreDb().syncLiveSplitSessionShares(req.session.userId, req.body?.session_key, req.body?.friend_ids || [])
    );
    const targetUserIds = Array.isArray(result?.target_user_ids) ? result.target_user_ids : [];
    if (targetUserIds.length) {
      sendSplitShareEmailsToTargets(req.session.userId, targetUserIds, req.body?.session_key).catch(() => {});
      notifyLiveSplitSessionShared(req.session.userId, req.body?.session_key, targetUserIds).catch(() => {});
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/live-split/groups/shared', async (req, res) => {
  try {
    const groups = await Promise.resolve(getCoreDb().getReceivedLiveSplitShares(req.session.userId));
    res.json({ groups });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/live-split/groups/shared/hide', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().hideReceivedLiveSplitShare(req.session.userId, req.body?.owner_user_id, req.body?.session_key));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ─── DASHBOARD ───────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.session.userId;
    const year = req.query.year || new Date().getFullYear();
    const dashboard = await Promise.resolve(getCoreDb().getDashboardData(userId, year));
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FRIEND EXCEL IMPORT ─────────────────────────────────────

// Load sheets + header row from each sheet
router.post('/friends/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const opts = req.body.password ? { password: req.body.password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    const sheets = wb.sheets().map(s => {
      const headers = [];
      for (let c = 1; c <= 15; c++) {
        const v = s.cell(1, c).value();
        if (v !== null && v !== undefined && v !== '') headers.push({ col: c, name: String(v).trim() });
      }
      return { name: s.name(), headers };
    });
    console.log('[friend-import] sheets:', sheets.map(s => `${s.name}(${s.headers.length} headers)`).join(', '));
    res.json({ sheets });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt'))
      return res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    res.status(500).json({ error: msg });
  }
});

// Preview rows for one sheet
router.post('/friends/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const opts = req.body.password ? { password: req.body.password } : {};
    const mapping = JSON.parse(req.body.mapping);
    const sheetName = req.body.sheet;
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    const ws = wb.sheet(sheetName) || wb.sheet(0);
    const { rows, skipped } = parseFriendSheet(ws, mapping);
    res.json({ count: rows.length, skipped, preview: rows.slice(0, 10) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Import selected sheets — each sheet = one friend
router.post('/friends/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const opts = req.body.password ? { password: req.body.password } : {};
    const mapping = JSON.parse(req.body.mapping);
    const sheetNames = JSON.parse(req.body.sheets);
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    const coreDb = getCoreDb();
    const allFriends = await Promise.resolve(coreDb.getFriends(req.session.userId));
    const results = [];
    let totalImported = 0;

    for (const sheetName of sheetNames) {
      const ws = wb.sheet(sheetName);
      if (!ws) continue;
      const { rows } = parseFriendSheet(ws, mapping);

      // Find or create friend by sheet name
      let friend = allFriends.find(f => f.name.toLowerCase() === sheetName.toLowerCase());
      if (!friend) {
        const id = await Promise.resolve(coreDb.addFriend(req.session.userId, sheetName));
        friend = { id };
      }

      for (const t of rows) {
        await Promise.resolve(coreDb.addLoanTransaction(req.session.userId, { friend_id: friend.id, txn_date: t.txn_date, details: t.details, paid: t.paid, received: t.received }));
      }
      results.push({ sheet: sheetName, imported: rows.length });
      totalImported += rows.length;
    }
    res.json({ success: true, totalImported, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parseFriendSheet(ws, mapping) {
  const usedRange = ws.usedRange();
  if (!usedRange) return { rows: [], skipped: 0 };
  const lastRow = usedRange.endCell().rowNumber();
  const rows = []; let skipped = 0;
  for (let r = 2; r <= lastRow; r++) {
    const details  = String(ws.cell(r, mapping.details).value()  || '').trim();
    const dateVal  = ws.cell(r, mapping.date).value();
    const paid     = parseFloat(String(ws.cell(r, mapping.paid).value()     || 0).replace(/[^0-9.-]/g, '')) || 0;
    const received = parseFloat(String(ws.cell(r, mapping.received).value() || 0).replace(/[^0-9.-]/g, '')) || 0;
    if (!details) { skipped++; continue; }
    const txn_date = parseExcelDate(dateVal);
    if (!txn_date) { skipped++; continue; }
    if (paid === 0 && received === 0) { skipped++; continue; }
    rows.push({ txn_date, details, paid, received });
  }
  return { rows, skipped };
}

// ─── REPORTS ─────────────────────────────────────────────────
// Year-wise summary
router.get('/reports/years', async (req, res) => {
  try {
    const rows = await Promise.resolve(getCoreDb().getReportYears(req.session.userId));
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Month-wise summary for a year
router.get('/reports/months', async (req, res) => {
  try {
    const year = req.query.year;
    const rows = await Promise.resolve(getCoreDb().getReportMonths(req.session.userId, year));
    res.json({ rows, year });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TRIPS ───────────────────────────────────────────────────
router.get('/trips', async (req, res) => {
  try { res.json({ trips: await Promise.resolve(getCoreDb().getTrips(req.session.userId)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trips', async (req, res) => {
  try {
    const { destination, start_date, end_date, status, category, transport_mode, total_distance, notes, members } = req.body;
    if (!destination || !start_date) return res.status(400).json({ error: 'Destination and start date required' });
    const id = await Promise.resolve(getCoreDb().createTrip(req.session.userId, {
      destination,
      start_date,
      end_date,
      status,
      category,
      transport_mode,
      total_distance,
      notes,
      members: members || [],
    }));
    res.json({ success: true, id });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/trips/:id', async (req, res) => {
  try {
    const trip = await Promise.resolve(getCoreDb().getTripById(req.session.userId, req.params.id));
    if (!trip) return res.status(404).json({ error: 'Not found' });
    res.json({ trip });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/trips/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().updateTrip(req.session.userId, req.params.id, req.body));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/trips/:id/itinerary', async (req, res) => {
  try {
    const id = await Promise.resolve(getCoreDb().addTripItineraryItem(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, id });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.put('/trips/:id/itinerary/:iid', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().updateTripItineraryItem(req.session.userId, req.params.iid, req.body || {}));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.delete('/trips/:id/itinerary/:iid', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteTripItineraryItem(req.session.userId, req.params.iid));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.delete('/trips/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteTrip(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trips/:id/expenses', async (req, res) => {
  try {
    const {
      expense_type,
      details,
      quantity,
      unit_price,
      amount,
      original_currency_code,
      original_amount,
      conversion_rate,
      expense_date,
      notes,
      paid_by_key,
      paid_by_name,
      split_mode,
      splits,
    } = req.body;
    if (!expense_type || !details) return res.status(400).json({ error: 'Expense type and detail are required' });
    const id = await Promise.resolve(getCoreDb().addTripExpense(req.session.userId, req.params.id, {
      expense_type,
      details,
      quantity,
      unit_price,
      amount,
      original_currency_code,
      original_amount,
      conversion_rate,
      expense_date,
      notes,
      paid_by_key,
      paid_by_name,
      split_mode,
      splits,
    }));
    res.json({ success: true, id });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/trips/:id/expenses/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map((sheet) => sheet.name()) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to read file' });
  }
});

router.post('/trips/:id/expenses/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const trip = await Promise.resolve(getCoreDb().getTripById(req.session.userId, req.params.id));
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    const sheets = parseSheetParam(req.body.sheets);
    const parsed = await parseTripExpenseExcelBuffer(req.file.buffer, sheets, req.body.password, trip.members || []);
    res.json({
      count: parsed.expenses.length,
      skipped: parsed.skipped,
      preview: parsed.expenses.slice(0, 20).map((expense) => ({
        expense_type: expense.expense_type,
        details: expense.details,
        quantity: expense.quantity,
        unit_price: expense.unit_price,
        amount: expense.amount,
        expense_date: expense.expense_date,
        notes: expense.notes,
        split_member_names: expense.split_member_names || [],
        split_code: expense.split_code || '',
      })),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to preview file' });
  }
});

router.post('/trips/:id/expenses/import-excel', withUpload, async (req, res) => {
  try {
    const coreDb = getCoreDb();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const trip = await Promise.resolve(coreDb.getTripById(req.session.userId, req.params.id));
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    const sheets = parseSheetParam(req.body.sheets);
    const parsed = await parseTripExpenseExcelBuffer(req.file.buffer, sheets, req.body.password, trip.members || []);
    if (!parsed.expenses.length) return res.status(400).json({ error: 'No valid trip expenses found in the selected sheet(s).' });
    let imported = 0;
    for (const expense of parsed.expenses) {
      const tripMemberMap = new Map((trip.members || []).map((member) => [String(member.member_name || '').trim().toLowerCase(), member]));
      const splits = Array.isArray(expense.splits) && expense.splits.length
        ? expense.splits.map((split) => {
            const matchedMember = tripMemberMap.get(String(split.member_name || '').trim().toLowerCase());
            return matchedMember ? {
              member_key: String(matchedMember.id),
              member_name: matchedMember.member_name,
              share_amount: split.share_amount,
            } : null;
          }).filter(Boolean)
        : [];
      const paidBySplit = splits[0] || null;
      await Promise.resolve(coreDb.addTripExpense(req.session.userId, req.params.id, {
        ...expense,
        paid_by_key: paidBySplit?.member_key || (trip.members?.[0] ? String(trip.members[0].id) : 'self'),
        paid_by_name: paidBySplit?.member_name || (trip.members?.[0]?.member_name || 'You'),
        split_mode: splits.length > 1 ? (expense.split_mode || 'equal') : 'equal',
        splits: splits.length ? splits : undefined,
      }));
      imported++;
    }
    res.json({ success: true, imported, skipped: parsed.skipped });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Trip expense import failed' });
  }
});

router.post('/trips/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map((sheet) => sheet.name()) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to read file' });
  }
});

router.post('/trips/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets = parseSheetParam(req.body.sheets);
    const parsed = await parseTripsExcelBuffer(req.file.buffer, sheets, req.body.password);
    res.json({
      count: parsed.trips.length,
      skipped: parsed.skipped,
      preview: parsed.trips.slice(0, 10).map((trip) => ({
        destination: trip.destination,
        start_date: trip.start_date,
        end_date: trip.end_date,
        status: trip.status,
        category: trip.category,
        transport_mode: trip.transport_mode,
        total_distance: trip.total_distance,
        members: trip.members,
        expense_count: (trip.expenses || []).length,
        total_expenditure: trip.total_expenditure || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to preview file' });
  }
});

router.post('/trips/import-excel', withUpload, async (req, res) => {
  try {
    const coreDb = getCoreDb();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets = parseSheetParam(req.body.sheets);
    const parsed = await parseTripsExcelBuffer(req.file.buffer, sheets, req.body.password);
    if (!parsed.trips.length) return res.status(400).json({ error: 'No valid trips found in the selected sheet(s).' });
    let importedTrips = 0;
    let importedExpenses = 0;
    for (const trip of parsed.trips) {
      const tripId = await Promise.resolve(coreDb.createTrip(req.session.userId, {
        destination: trip.destination,
        start_date: trip.start_date,
        end_date: trip.end_date,
        status: trip.status,
        category: trip.category,
        transport_mode: trip.transport_mode,
        total_distance: trip.total_distance,
        members: trip.members || [],
        notes: trip.notes || null,
      }));
      importedTrips++;
      for (const expense of (trip.expenses || [])) {
        await Promise.resolve(coreDb.addTripExpense(req.session.userId, tripId, expense));
        importedExpenses++;
      }
      if ((!trip.expenses || trip.expenses.length === 0) && Number(trip.total_expenditure || 0) > 0) {
        await Promise.resolve(coreDb.addTripExpense(req.session.userId, tripId, {
          expense_type: 'Imported Total',
          details: 'Imported trip total',
          quantity: 1,
          unit_price: Number(trip.total_expenditure || 0),
          amount: Number(trip.total_expenditure || 0),
          expense_date: trip.end_date || trip.start_date,
          notes: 'Created from Excel summary import',
        }));
        importedExpenses++;
      }
    }
    res.json({ success: true, imported_trips: importedTrips, imported_expenses: importedExpenses, skipped: parsed.skipped });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Trip import failed' });
  }
});

router.put('/trips/:id/expenses/:eid', async (req, res) => {
  try {
    const {
      expense_type,
      details,
      quantity,
      unit_price,
      amount,
      original_currency_code,
      original_amount,
      conversion_rate,
      expense_date,
      notes,
      paid_by_key,
      paid_by_name,
      split_mode,
      splits,
    } = req.body;
    await Promise.resolve(getCoreDb().updateTripExpense(req.session.userId, req.params.eid, {
      expense_type,
      details,
      quantity,
      unit_price,
      amount,
      original_currency_code,
      original_amount,
      conversion_rate,
      expense_date,
      notes,
      paid_by_key,
      paid_by_name,
      split_mode,
      splits,
    }));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/currencies', async (req, res) => {
  try {
    const data = await Promise.resolve(getCoreDb().getAvailableCurrencyRates(req.session.userId));
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/trips/:id/expenses', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteAllTripExpenses(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/trips/:id/expenses/bulk-share', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().bulkUpdateTripExpenseShares(req.session.userId, req.params.id, {
      split_mode: req.body?.split_mode,
      member_keys: req.body?.member_keys,
      split_values: req.body?.split_values,
    }));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.delete('/trips/:id/expenses/:eid', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteTripExpense(req.session.userId, req.params.eid));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/trips/:id/finalize', async (req, res) => {
  try {
    const result = await Promise.resolve(getCoreDb().finalizeTrip(req.session.userId, req.params.id, {
      is_extra: !!req.body?.is_extra,
      txn_date: req.body?.txn_date,
      category: req.body?.category,
      self_member_key: req.body?.self_member_key || null,
      friend_ids: req.body?.friend_ids || {},
      live_split_friend_ids: req.body?.live_split_friend_ids || {},
      add_self_expense: req.body?.add_self_expense !== false,
    }));
    sendTripFinalizedEmails(req.session.userId, req.params.id).catch(() => {});
    res.json(result || { success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/trips/:id/members/:mid/lock', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().toggleMemberLock(req.session.userId, req.params.mid));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/trips/:id/members/:mid/link', async (req, res) => {
  try {
    const { linked_user_id, permission } = req.body;
    await Promise.resolve(getCoreDb().linkTripMember(req.session.userId, req.params.mid, linked_user_id || null, permission || 'edit'));
    if (linked_user_id) {
      sendTripLinkedEmailToUser(req.session.userId, req.params.id, linked_user_id, permission || 'edit').catch(() => {});
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trips/:id/shared-users', async (req, res) => {
  try {
    const shared_users = await Promise.resolve(getCoreDb().getTripSharedUsers(req.session.userId, req.params.id));
    res.json({ shared_users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trips/:id/shared-users', async (req, res) => {
  try {
    const share_id = await Promise.resolve(getCoreDb().shareTripWithUser(
      req.session.userId,
      req.params.id,
      req.body?.linked_user_id,
      req.body?.permission || 'view'
    ));
    res.json({ success: true, share_id });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.delete('/trips/:id/shared-users/:sid', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().unshareTripWithUser(req.session.userId, req.params.id, req.params.sid));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/trips/:id/invite/:mid', async (req, res) => {
  try {
    const token = await Promise.resolve(getCoreDb().createTripInvite(req.session.userId, req.params.id, req.params.mid));
    res.json({ success: true, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trips/invite/:token', async (req, res) => {
  try {
    const invite = await Promise.resolve(getCoreDb().getTripInviteByToken(req.params.token));
    if (!invite) return res.status(404).json({ error: 'Invalid invite' });
    res.json({ invite });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trips/invite/:token/accept', async (req, res) => {
  try {
    const tripId = await Promise.resolve(getCoreDb().acceptTripInvite(req.session.userId, req.params.token));
    res.json({ success: true, tripId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── USER SEARCH ─────────────────────────────────────────────
router.get('/users/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });
    const users = await Promise.resolve(getCoreDb().searchUsers(q, req.session.userId));
    const selfId = Number(req.session.userId) || 0;
    res.json({ users: (users || []).filter((user) => Number(user?.id) !== selfId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SHARE LINKS ─────────────────────────────────────────────
router.get('/shares', async (req, res) => {
  try { res.json({ links: await Promise.resolve(getCoreDb().getShareLinks(req.session.userId)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/shares', async (req, res) => {
  try {
    const token = await Promise.resolve(getCoreDb().createShareLink(req.session.userId, req.body));
    res.json({ success: true, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/shares/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteShareLink(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EMI ROUTES ──────────────────────────────────────────────
router.get('/emi/records', async (req, res) => {
  try { res.json({ records: await Promise.resolve(getFinanceDb().getEmiRecords(req.session.userId, parseInt(req.query.for_friend) || 0)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records', async (req, res) => {
  try {
    const id = await Promise.resolve(getFinanceDb().saveEmiRecord(req.session.userId, req.body));
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/emi/records/:id', async (req, res) => {
  try {
    const record = await Promise.resolve(getFinanceDb().getEmiRecord(req.session.userId, req.params.id));
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({ record });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/records/:id', async (req, res) => {
  try { await Promise.resolve(getFinanceDb().updateEmiRecord(req.session.userId, req.params.id, req.body)); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/emi/records/:id', async (req, res) => {
  try { await Promise.resolve(getFinanceDb().deleteEmiRecord(req.session.userId, req.params.id)); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records/:id/activate', async (req, res) => {
  try {
    const { start_date, add_expenses, expense_type, expense_category } = req.body;
    if (!start_date) return res.status(400).json({ error: 'start_date required' });
    await Promise.resolve(getFinanceDb().activateEmi(
      req.session.userId,
      req.params.id,
      start_date,
      parseBooleanFlag(add_expenses, false),
      parseInt(expense_type) || 0,
      expense_category
    ));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/installments/:id/pay', async (req, res) => {
  try {
    const { paid_amount, paid_date, notes, bank_account_id } = req.body;
    await Promise.resolve(getFinanceDb().payInstallment(req.session.userId, req.params.id, parseFloat(paid_amount) || 0, paid_date, notes, bank_account_id || null));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/installments/:id/amount', async (req, res) => {
  try {
    const { emi_amount } = req.body;
    if (!emi_amount || emi_amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    await Promise.resolve(getFinanceDb().updateInstallmentAmount(req.session.userId, req.params.id, parseFloat(emi_amount)));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/installments/:id/components', async (req, res) => {
  try {
    const { emi_amount, interest_component, principal_component } = req.body;
    if (!emi_amount || emi_amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    await Promise.resolve(getFinanceDb().updateInstallmentComponents(req.session.userId, req.params.id, {
      emi_amount: parseFloat(emi_amount),
      interest_component: parseFloat(interest_component) || 0,
      principal_component: parseFloat(principal_component) || 0
    }));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/records/:id/bulk-amount', async (req, res) => {
  try {
    const { emi_amount } = req.body;
    if (!emi_amount || emi_amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    await Promise.resolve(getFinanceDb().bulkUpdateInstallmentAmount(req.session.userId, req.params.id, parseFloat(emi_amount)));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records/:id/activate-with-schedule', async (req, res) => {
  try {
    const { start_date, schedule, add_expenses, expense_type, expense_category } = req.body;
    if (!start_date) return res.status(400).json({ error: 'start_date required' });
    if (!Array.isArray(schedule) || schedule.length === 0) return res.status(400).json({ error: 'schedule required' });
    await Promise.resolve(getFinanceDb().activateEmiWithSchedule(
      req.session.userId,
      req.params.id,
      start_date,
      schedule,
      parseBooleanFlag(add_expenses, false),
      parseInt(expense_type) || 0,
      expense_category
    ));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records/:id/add-expenses', async (req, res) => {
  try {
    const expense_type = parseInt(req.body?.expense_type) || 0;
    await Promise.resolve(getFinanceDb().addEmiExpensesManual(req.session.userId, req.params.id, expense_type, req.body?.expense_category));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records/:id/add-credit-card', async (req, res) => {
  try {
    const credit_card_id = parseInt(req.body?.credit_card_id) || 0;
    const gst_month_offset = parseInt(req.body?.gst_month_offset) || 0;
    if (!credit_card_id) return res.status(400).json({ error: 'credit_card_id required' });
    await Promise.resolve(getFinanceDb().addEmiToCreditCardManual(req.session.userId, req.params.id, credit_card_id, gst_month_offset));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Return sheet names for EMI Excel
router.post('/emi/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map(s => s.name()) });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('encrypt')) {
      res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    } else {
      res.status(500).json({ error: msg || 'Failed to read file' });
    }
  }
});

// Return column headers from a specific sheet for mapping UI
router.post('/emi/import-excel/headers', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheetName = req.body.sheet || null;
    const password  = req.body.password || '';
    const opts = password ? { password } : {};
    const wb    = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    const sheet = sheetName ? (wb.sheet(sheetName) || wb.sheets()[0]) : wb.sheets()[0];
    const usedRange = sheet.usedRange();
    if (!usedRange) return res.json({ columns: [] });
    const lastCol = usedRange.endCell().columnNumber();
    // Row 3 = column headers, row 4 = first data sample
    const columns = [];
    for (let c = 1; c <= Math.min(lastCol, 30); c++) {
      const letter = _emiColLetter(c);
      const hVal   = sheet.cell(3, c).value();
      const sVal   = sheet.cell(4, c).value();
      const header = String(hVal !== null && hVal !== undefined ? hVal : '').trim() || letter;
      const sample = String(sVal !== null && sVal !== undefined ? sVal : '').trim();
      if (header !== letter || sample) columns.push({ col: c, letter, header, sample });
    }
    res.json({ columns });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

function _emiColLetter(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

// Preview EMI Excel — multiple sheets + column mapping
router.post('/emi/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets   = parseSheetParam(req.body.sheets);
    const password = req.body.password || '';
    const mapping  = req.body.mapping ? JSON.parse(req.body.mapping) : null;
    const sheetList = sheets && sheets.length > 0 ? sheets : [null];
    const results = [], errors = [];
    for (const sn of sheetList) {
      try {
        results.push({ sheet: sn, ...await parseEmiExcel(req.file.buffer, sn, password, mapping) });
      } catch (e) { errors.push({ sheet: sn, error: e.message }); }
    }
    res.json({ results, errors });
  } catch (err) { res.status(400).json({ error: err.message || 'Failed to parse file' }); }
});

// Import EMI from Excel — multiple sheets + column mapping
router.post('/emi/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets      = parseSheetParam(req.body.sheets);
    const password    = req.body.password || '';
    const mapping     = req.body.mapping ? JSON.parse(req.body.mapping) : null;
    const forFriend   = parseInt(req.body.for_friend) || 0;
    const friendName  = req.body.friend_name || null;
    const sheetList = sheets && sheets.length > 0 ? sheets : [null];
    const imported = [], errors = [];
    for (const sn of sheetList) {
      try {
        const { emiData, installments } = await parseEmiExcel(req.file.buffer, sn, password, mapping);
        emiData.for_friend  = forFriend;
        emiData.friend_name = friendName;
        const r = await Promise.resolve(getFinanceDb().importEmiFromExcel(req.session.userId, emiData, installments));
        imported.push({ sheet: sn, id: r.id, name: emiData.name });
      } catch (e) { errors.push({ sheet: sn, error: e.message }); }
    }
    if (imported.length === 0) return res.status(400).json({ error: errors[0]?.error || 'Import failed', errors });
    res.json({ success: true, imported: imported.length, details: imported, errors });
  } catch (err) { res.status(400).json({ error: err.message || 'Import failed' }); }
});

// Simple import — user provides loan amount; we infer the rate from the installment rows
router.post('/emi/import-excel/simple-preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets     = parseSheetParam(req.body.sheets);
    const password   = req.body.password || '';
    const loanAmount = parseFloat(req.body.loan_amount);
    const loanAmounts = parseSimpleLoanAmounts(req.body.loan_amounts);
    const dateCol    = parseInt(req.body.date_col) || 2;
    const srCol      = parseInt(req.body.sr_col)   || 0;
    const totalCol   = parseInt(req.body.total_col) || 0;
    const paidCol    = parseInt(req.body.paid_col)  || 0;
    const sheetList = sheets && sheets.length > 0 ? sheets : [null];
    const results = [], errors = [];
    for (const sn of sheetList) {
      try {
        const sheetLoanAmount = resolveSimpleLoanAmount(sn, loanAmount, loanAmounts);
        results.push({ sheet: sn, ...await parseEmiSimple(req.file.buffer, sn, password, sheetLoanAmount, dateCol, srCol, totalCol, paidCol) });
      } catch (e) { errors.push({ sheet: sn, error: e.message }); }
    }
    res.json({ results, errors });
  } catch (err) { res.status(400).json({ error: err.message || 'Failed' }); }
});

router.post('/emi/import-excel/simple', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets     = parseSheetParam(req.body.sheets);
    const password   = req.body.password || '';
    const loanAmount = parseFloat(req.body.loan_amount);
    const loanAmounts = parseSimpleLoanAmounts(req.body.loan_amounts);
    const dateCol    = parseInt(req.body.date_col) || 2;
    const srCol      = parseInt(req.body.sr_col)   || 0;
    const totalCol   = parseInt(req.body.total_col) || 0;
    const paidCol    = parseInt(req.body.paid_col)  || 0;
    const forFriend  = parseInt(req.body.for_friend) || 0;
    const friendName = req.body.friend_name || null;
    const sheetList = sheets && sheets.length > 0 ? sheets : [null];
    const imported = [], errors = [];
    for (const sn of sheetList) {
      try {
        const sheetLoanAmount = resolveSimpleLoanAmount(sn, loanAmount, loanAmounts);
        const { emiData, installments } = await parseEmiSimple(req.file.buffer, sn, password, sheetLoanAmount, dateCol, srCol, totalCol, paidCol);
        emiData.for_friend  = forFriend;
        emiData.friend_name = friendName;
        const r = await Promise.resolve(getFinanceDb().importEmiFromExcel(req.session.userId, emiData, installments));
        imported.push({ sheet: sn, id: r.id, name: emiData.name });
      } catch (e) { errors.push({ sheet: sn, error: e.message }); }
    }
    if (imported.length === 0) return res.status(400).json({ error: errors[0]?.error || 'Import failed', errors });
    res.json({ success: true, imported: imported.length, details: imported, errors });
  } catch (err) { res.status(400).json({ error: err.message || 'Import failed' }); }
});

async function parseEmiSimple(buffer, sheetName, password, loanAmount, dateCol, srCol, totalCol, paidCol) {
  const opts  = password ? { password } : {};
  const wb    = await XlsxPopulate.fromDataAsync(buffer, opts);
  const sheet = sheetName ? (wb.sheet(sheetName) || wb.sheets()[0]) : wb.sheets()[0];
  const usedRange = sheet.usedRange();
  if (!usedRange) throw new Error(`Sheet "${sheetName || 'Sheet1'}" is empty`);
  const lastRow = usedRange.endCell().rowNumber();

  // EMI name from row 1
  let emiName = '';
  for (let c = 1; c <= 10; c++) {
    const v = sheet.cell(1, c).value();
    if (v && String(v).trim()) { emiName = String(v).trim(); break; }
  }
  if (!emiName) emiName = sheetName || 'Imported EMI';
  emiName = normalizeImportedEmiName(emiName, loanAmount);

  // Detect data start row: scan from row 4, skip empty/header rows
  let dataStartRow = 4;
  for (let r = 4; r <= Math.min(12, lastRow); r++) {
    const dv = sheet.cell(r, dateCol).value();
    if (dv === null || dv === undefined || dv === '') continue;
    const ds = String(dv).trim().toLowerCase();
    if (ds === 'date' || /^(sr\.?\s*no|total|amount)/i.test(ds)) continue;
    dataStartRow = r;
    break;
  }

  // Collect date rows
  const rows = [];
  for (let r = dataStartRow; r <= lastRow; r++) {
    if (srCol > 0) {
      const sv = sheet.cell(r, srCol).value();
      if (sv === null || sv === undefined || sv === '') continue;
      const ss = String(sv).trim().toLowerCase();
      if (/^(total|sr\.?\s*no|amount left)/i.test(ss)) continue;
      if (isNaN(parseInt(sv))) continue;
    }
    const dateVal = sheet.cell(r, dateCol).value();
    const dueDate = parseExcelDate(dateVal);
    if (!dueDate) continue;
    const total = totalCol > 0 ? (parseFloat(sheet.cell(r, totalCol).value()) || 0) : 0;
    const paid = paidCol > 0 ? (parseFloat(sheet.cell(r, paidCol).value()) || 0) : 0;
    const scheduled = total > 0 ? total : paid;
    if (scheduled <= 0) continue;
    rows.push({ dueDate, total: scheduled, paid });
  }
  if (rows.length === 0) throw new Error(`No valid date rows found in "${sheetName || 'Sheet1'}"`);

  const rRate = inferMonthlyRateFromPayments(loanAmount, rows.map(r => r.total));
  const annualRate = Math.round(rRate * 12 * 100 * 100) / 100;

  let bal = Math.round(loanAmount * 100) / 100;
  const installments = rows.map((row, idx) => {
    const interest  = Math.round(bal * rRate * 100) / 100;
    let   principal = Math.round((row.total - interest) * 100) / 100;
    if (idx === rows.length - 1 || principal > bal) principal = Math.round(bal * 100) / 100;
    if (principal < 0) throw new Error(`Unable to derive a valid amortization from "${sheetName || 'Sheet1'}". Check the loan amount, Total column, and Total Paid column.`);
    const total     = Math.round((principal + interest) * 100) / 100;
    bal = Math.max(0, Math.round((bal - principal) * 100) / 100);
    return {
      installment_no:      idx + 1,
      due_date:            row.dueDate,
      principal_component: principal,
      interest_component:  interest,
      gst_amount:          0,
      emi_amount:          total,
      paid_amount:         row.paid,
    };
  });

  if (bal > 1) {
    throw new Error(`Calculated balance did not close for "${sheetName || 'Sheet1'}". Check the loan amount, Total column, and Total Paid column.`);
  }

  return {
    emiData: { name: emiName, annual_rate: annualRate, gst_rate: 0, start_date: installments[0].due_date },
    installments,
  };
}

function inferMonthlyRateFromPayments(principal, payments) {
  const validPayments = payments.map(p => Math.round((parseFloat(p) || 0) * 100) / 100).filter(p => p > 0);
  if (!principal || principal <= 0 || validPayments.length === 0) return 0;

  const totalPaid = validPayments.reduce((s, p) => s + p, 0);
  if (totalPaid <= principal) return 0;

  const remainingBalance = (rate) => {
    let bal = principal;
    for (let i = 0; i < validPayments.length; i++) {
      const interest = bal * rate;
      const principalPaid = validPayments[i] - interest;
      bal -= principalPaid;
    }
    return bal;
  };

  let low = 0;
  let high = 0.5;
  let balLow = remainingBalance(low);
  let balHigh = remainingBalance(high);
  let guard = 0;
  while (balLow * balHigh > 0 && guard < 40) {
    high *= 1.5;
    balHigh = remainingBalance(high);
    guard++;
  }

  if (balLow * balHigh > 0) return 0;

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    const bal = remainingBalance(mid);
    if (Math.abs(bal) < 0.0001) return mid;
    if (balLow * bal > 0) {
      low = mid;
      balLow = bal;
    } else {
      high = mid;
      balHigh = bal;
    }
  }
  return (low + high) / 2;
}

function parseSimpleLoanAmounts(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return {};
  }
}

function resolveSimpleLoanAmount(sheetName, fallbackLoanAmount, loanAmounts) {
  const key = sheetName || '__default__';
  const direct = parseFloat(loanAmounts[key]);
  if (direct > 0) return direct;
  if (sheetName) {
    const byName = parseFloat(loanAmounts[sheetName]);
    if (byName > 0) return byName;
  }
  if (fallbackLoanAmount > 0) return fallbackLoanAmount;
  throw new Error(`Enter a valid loan amount${sheetName ? ` for "${sheetName}"` : ''}`);
}

function normalizeImportedEmiName(name, principalHint) {
  const raw = String(name || '').trim();
  if (!raw) return 'Imported EMI';
  const compact = Math.round((parseFloat(principalHint) || 0) * 100) / 100;
  if (compact <= 0) return raw;

  const tailMatch = raw.match(/\s*[-–—:]\s*₹?\s*([\d,]+(?:\.\d+)?)\s*$/);
  if (!tailMatch) return raw;

  const tailAmount = parseFloat(String(tailMatch[1]).replace(/,/g, ''));
  if (!Number.isFinite(tailAmount)) return raw;
  if (Math.abs(tailAmount - compact) > 0.5) return raw;

  return raw.replace(/\s*[-–—:]\s*₹?\s*[\d,]+(?:\.\d+)?\s*$/, '').trim() || raw;
}

async function parseEmiExcel(buffer, sheetName, password, mapping) {
  const opts = password ? { password } : {};
  const wb   = await XlsxPopulate.fromDataAsync(buffer, opts);
  const sheet = sheetName ? (wb.sheet(sheetName) || wb.sheets()[0]) : wb.sheets()[0];
  const usedRange = sheet.usedRange();
  if (!usedRange) throw new Error(`Sheet "${sheetName || 'Sheet1'}" is empty`);
  const lastRow = usedRange.endCell().rowNumber();

  // Column mapping (1-indexed), 0 = not mapped.
  // Use explicit null-check so that a user-supplied 0 ("None/Skip") is NOT overridden by the default.
  const _col = (val, def) => (val !== undefined && val !== null) ? parseInt(val) : def;
  const m = {
    srNo:      _col(mapping?.srNo,      0),
    date:      _col(mapping?.date,      2),
    principal: _col(mapping?.principal, 3),
    interest:  _col(mapping?.interest,  4),  // default col 4 only when no mapping sent at all
    gst:       _col(mapping?.gst,       0),
    total:     _col(mapping?.total,     0),
    emiAmount: _col(mapping?.emiAmount, 0),
    iPaid:     _col(mapping?.iPaid,     0),
  };
  // If neither total nor emiAmount mapped, fall back to column 7
  if (m.emiAmount === 0 && m.total === 0) m.emiAmount = 7;

  // Row 1: EMI name/title (first non-empty cell)
  let emiName = '';
  for (let c = 1; c <= 10; c++) {
    const v = sheet.cell(1, c).value();
    if (v && String(v).trim()) { emiName = String(v).trim(); break; }
  }
  if (!emiName) emiName = sheetName || 'Imported EMI';

  // Row 3 = headers. GST rate from the GST column header in row 3, e.g. "GST (18%)"
  let gstRate = 18;
  if (m.gst > 0) {
    const gh = String(sheet.cell(3, m.gst).value() || '');
    const gm = gh.match(/(\d+(?:\.\d+)?)\s*%/);
    if (gm) gstRate = parseFloat(gm[1]);
  }

  // Data starts from row 4
  const dataStartRow = 4;

  // Data rows
  const installments = [];
  for (let r = dataStartRow; r <= lastRow; r++) {
    if (m.srNo > 0) {
      const sv = sheet.cell(r, m.srNo).value();
      if (sv === null || sv === undefined || sv === '') continue;
      const ss = String(sv).trim().toLowerCase();
      if (/^(total|sr\.?\s*no\.?|s\.?\s*no\.?)$/.test(ss)) continue;
      if (isNaN(parseInt(sv))) continue;
    }
    const dateVal   = sheet.cell(r, m.date).value();
    const principal = m.principal > 0 ? (parseFloat(sheet.cell(r, m.principal).value()) || 0) : 0;
    const interest  = m.interest  > 0 ? (parseFloat(sheet.cell(r, m.interest).value())  || 0) : 0;
    const gst       = m.gst   > 0 ? (parseFloat(sheet.cell(r, m.gst).value())   || 0) : 0;
    const totalExGst= m.total > 0 ? (parseFloat(sheet.cell(r, m.total).value()) || 0) : 0;
    let   emiAmt    = m.emiAmount > 0 ? (parseFloat(sheet.cell(r, m.emiAmount).value()) || 0) : 0;
    const iPaid     = m.iPaid > 0 ? (parseFloat(sheet.cell(r, m.iPaid).value()) || 0) : 0;
    const dueDate   = parseExcelDate(dateVal);

    // Derive emiAmount if not directly mapped
    if (emiAmt === 0) {
      if (totalExGst > 0) emiAmt = totalExGst + gst;          // Total ex-GST + GST
      else if (principal > 0 || interest > 0) emiAmt = principal + interest + gst; // sum components
    }

    if (!dueDate || (principal === 0 && interest === 0 && emiAmt === 0)) continue;
    installments.push({
      installment_no:      installments.length + 1,
      due_date:            dueDate,
      principal_component: Math.round(principal   * 100) / 100,
      interest_component:  Math.round(interest    * 100) / 100,
      gst_amount:          Math.round(gst         * 100) / 100,
      emi_amount:          Math.round(emiAmt      * 100) / 100,
      paid_amount:         Math.round(iPaid       * 100) / 100,
    });
  }

  if (installments.length === 0) throw new Error(`No valid data rows in "${sheetName || 'Sheet1'}". Check column mapping.`);

  const totalPrincipal = Math.round(installments.reduce((s, i) => s + i.principal_component, 0) * 100) / 100;
  emiName = normalizeImportedEmiName(emiName, totalPrincipal);
  const annualRate = totalPrincipal > 0 && installments[0].interest_component > 0
    ? Math.round((installments[0].interest_component / totalPrincipal) * 12 * 100 * 100) / 100
    : 0;

  return {
    emiData: { name: emiName, annual_rate: annualRate, gst_rate: gstRate, start_date: installments[0].due_date },
    installments,
  };
}

router.get('/emi/summary', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    res.json(await Promise.resolve(getFinanceDb().getEmiMonthSummary(req.session.userId, month)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Current user access ─────────────────────────────────────
router.get('/auth/me/access', requireAuth, (req, res) => {
  Promise.all([
    Promise.resolve(pgDb.findUserById(req.session.userId)),
    Promise.resolve(pgDb.getUserAccessiblePages(req.session.userId)),
    Promise.resolve(pgDb.getUserAiLookupModes(req.session.userId)),
    Promise.resolve(pgDb.getUserLiveSplitAccess(req.session.userId)),
    Promise.resolve(pgDb.getUserVoiceAiAccess(req.session.userId)),
  ]).then(([user, pages, aiLookupModes, liveSplitAccess, voiceAiAccess]) => {
    res.json({
      role: user?.role || 'user',
      pages,
      ai_lookup_modes: aiLookupModes || { mode: 'none', offline: false, online: false },
      live_split: liveSplitAccess || { delete_friend: false, nudge: { enabled: false, limit: 0, period: 'day', same_friend_daily_limit: 1, used: 0, remaining: 0, unlimited: false, can_use: false, is_admin: false } },
      voice_ai: voiceAiAccess || { enabled: false, limit: 0, period: 'day', used: 0, remaining: 0, unlimited: false, can_use: false, is_admin: false },
    });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

// ─── ADMIN ROUTES ────────────────────────────────────────────
router.get('/admin/videos/settings', requireAdmin, async (_req, res) => {
  try {
    const settings = await Promise.resolve(pgVideoDb.getVideoLibrarySettings());
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load video settings' });
  }
});

router.put('/admin/videos/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await Promise.resolve(pgVideoDb.saveVideoLibrarySettings(req.body || {}, req.session.userId));
    const library = await Promise.resolve(pgVideoDb.listVideoLibrary());
    res.json({
      success: true,
      settings,
      library_summary: {
        configured: !!library?.configured,
        root_exists: library?.root_exists !== false,
        video_count: Array.isArray(library?.videos) ? library.videos.length : 0,
        message: library?.message || '',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not save video settings' });
  }
});

router.post('/admin/videos/catalog/scan', requireAdmin, async (req, res) => {
  try {
    const scanPath = String(req.body?.scan_path || '').trim() || undefined;
    const result = await Promise.resolve(pgVideoDb.scanVideoCatalogPath(scanPath, req.session.userId));
    const items = await Promise.resolve(pgVideoDb.listVideoCatalogItems({ root_path: result.root_path }));
    res.json({
      success: true,
      result,
      items,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not scan the video folder' });
  }
});

router.post('/admin/videos/catalog/clear', requireAdmin, async (req, res) => {
  try {
    const root_path = String(req.body?.root_path || '').trim() || '';
    const result = await Promise.resolve(pgVideoDb.clearVideoCatalog(root_path));
    res.json({
      success: true,
      result,
      items: [],
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not clear the video catalog structure' });
  }
});

router.get('/admin/videos/catalog', requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || 'all').trim();
    const root_path = String(req.query.root_path || '').trim() || undefined;
    const items = await Promise.resolve(pgVideoDb.listVideoCatalogItems({ status, root_path }));
    res.json({ success: true, items });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load catalog items' });
  }
});

router.post('/admin/videos/catalog/ai-draft', requireAdmin, async (req, res) => {
  try {
    const requestedIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids : [];
    const root_path = String(req.body?.root_path || '').trim() || undefined;
    const sourceItems = await Promise.resolve(pgVideoDb.listVideoCatalogItems({ status: 'all', root_path }));
    const needsPosterBackfill = (item) => !String(item?.poster_relative_path || '').trim();
    const targetItems = requestedIds.length
      ? sourceItems.filter((item) => requestedIds.map(Number).includes(Number(item.id || 0)))
      : sourceItems.filter((item) => String(item.status || '') !== pgVideoDb.VIDEO_CATALOG_STATUSES.PUBLISHED || needsPosterBackfill(item));
    targetItems.sort((a, b) => {
      const scoreDiff = scoreVideoCatalogAiCandidate(a) - scoreVideoCatalogAiCandidate(b);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a.display_title || a.folder_name || '').localeCompare(String(b.display_title || b.folder_name || ''));
    });

    const updatedIds = [];
    const reusedMetadataByKey = new Map();
    for (const item of targetItems) {
      const reuseKey = buildVideoCatalogAiReuseKey(item);
      const reusedMetadata = reusedMetadataByKey.get(reuseKey);
      if (reusedMetadata) {
        await withPromiseTimeout(
          Promise.resolve(pgVideoDb.saveVideoCatalogAiMetadata(item.id, reusedMetadata, req.session.userId)),
          15000,
          'Saving reused AI metadata timed out for this title.'
        );
        updatedIds.push(Number(item.id || 0));
        continue;
      }
      let metadata;
      try {
        metadata = await withPromiseTimeout(
          fetchVideoCatalogMetadataDraft(item),
          22000,
          'AI metadata request timed out for this title.'
        );
      } catch (err) {
        const status = Number(err?.statusCode || err?.status || 0);
        if (status === 429) {
          const quotaExhausted = isOpenAiQuotaExhaustedError(err);
          const retryAfterMs = quotaExhausted ? 60000 : 30000;
          return res.json({
            success: false,
            rate_limited: true,
            quota_exhausted: quotaExhausted,
            skipped_due_to_rate_limit: !quotaExhausted,
            retry_after_ms: retryAfterMs,
            error: quotaExhausted
              ? 'OpenAI API credit appears exhausted. Please recharge or increase quota, then retry.'
              : 'OpenAI rate limit reached. Please wait a bit and retry.',
            updated_count: updatedIds.length,
            updated_ids: updatedIds,
          });
        }
        throw err;
      }
      await withPromiseTimeout(
        Promise.resolve(pgVideoDb.saveVideoCatalogAiMetadata(item.id, metadata, req.session.userId)),
        15000,
        'Saving AI metadata timed out for this title.'
      );
      if (metadata && reuseKey) {
        reusedMetadataByKey.set(reuseKey, metadata);
      }
      updatedIds.push(Number(item.id || 0));
    }

    const items = await Promise.resolve(pgVideoDb.listVideoCatalogItems({ root_path }));
    res.json({
      success: true,
      updated_count: updatedIds.length,
      updated_ids: updatedIds,
      items,
    });
  } catch (err) {
    const status = Number(err?.statusCode || err?.status || 0);
    if (status === 429) {
      const quotaExhausted = isOpenAiQuotaExhaustedError(err);
      const retryAfterMs = 30000;
      return res.json({
        success: false,
        rate_limited: true,
        quota_exhausted: quotaExhausted,
        retry_after_ms: retryAfterMs,
        error: quotaExhausted
          ? 'OpenAI API credit appears exhausted. Please recharge or increase quota, then retry.'
          : 'OpenAI rate limit reached. Please wait a bit and retry.',
        updated_count: 0,
        updated_ids: [],
      });
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not fetch AI metadata for the catalog' });
  }
});

router.put('/admin/videos/catalog/:id', requireAdmin, async (req, res) => {
  try {
    const itemId = Number(req.params.id || 0);
    if (!(itemId > 0)) {
      return res.status(400).json({ error: 'Catalog item is invalid' });
    }
    const updated = await Promise.resolve(pgVideoDb.updateVideoCatalogItem(itemId, req.body || {}, req.session.userId));
    const items = await Promise.resolve(pgVideoDb.listVideoCatalogItems({ status: 'all' }));
    res.json({ success: true, updated, items });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update catalog item' });
  }
});

router.post('/admin/videos/catalog/publish', requireAdmin, async (req, res) => {
  try {
    const itemIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids : [];
    const result = await Promise.resolve(pgVideoDb.publishVideoCatalogItems(itemIds, req.session.userId));
    const items = await Promise.resolve(pgVideoDb.listVideoCatalogItems({ status: 'all' }));
    res.json({
      success: true,
      result,
      items,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not publish catalog items' });
  }
});

router.get('/videos/library', requireAuth, async (req, res) => {
  try {
    const library = await Promise.resolve(pgVideoDb.listVideoLibrary(req.session.userId));
    const videos = Array.isArray(library?.videos)
      ? library.videos.map((video) => ({
          ...video,
          stream_url: video.available === false ? '' : `/api/videos/stream/${encodeURIComponent(video.id)}`,
          hls_url: video.available === false ? '' : `/api/videos/hls/${encodeURIComponent(video.id)}/master.m3u8`,
        }))
      : [];
    res.json({
      success: true,
      configured: !!library?.configured,
      root_exists: library?.root_exists !== false,
      message: library?.message || '',
      settings: library?.settings || null,
      subtitle_engine: library?.subtitle_engine || { available: false, message: '' },
      videos,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load videos' });
  }
});

router.post('/videos/progress', requireAuth, async (req, res) => {
  try {
    const progress = await Promise.resolve(pgVideoDb.saveVideoWatchProgress(req.session.userId, req.body || {}));
    res.json({ success: true, progress });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not save video progress' });
  }
});

router.get('/videos/hls/:token/master.m3u8', requireAuth, async (req, res) => {
  try {
    setVideoHlsCorsHeaders(res);
    const requestedAudioTrack = String(req.query.audio_stream || '').trim();
    const target = requestedAudioTrack
      ? await Promise.resolve(pgVideoDb.resolveVideoAudioTrackTarget(req.params.token, requestedAudioTrack))
      : await Promise.resolve(pgVideoDb.resolveVideoStreamTarget(req.params.token));
    if (!target) return res.status(404).json({ error: 'Video not found' });
    if (requestedAudioTrack && !target.audio_track) return res.status(404).json({ error: 'Audio track not found' });

    const mediaTools = await Promise.resolve(pgVideoDb.getMediaToolsStatus());
    if (!mediaTools?.available) {
      return res.status(503).json({ error: mediaTools?.message || 'HLS transcoding is not available right now.' });
    }

    const availableAudioTracks = Array.isArray(target?.audio_tracks) ? target.audio_tracks.filter((track) => String(track?.id || '').trim()) : [];
    if (!requestedAudioTrack && availableAudioTracks.length > 1) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.send(buildHlsMasterPlaylist(req.params.token, availableAudioTracks));
    }

    const cache = await ensureHlsCache(target, pgVideoDb.ffmpegCommand(), requestedAudioTrack);
    const rawManifest = await fs.promises.readFile(cache.masterPath, 'utf8');
    const manifestBody = rewriteHlsMediaPlaylist(rawManifest, req.params.token, requestedAudioTrack);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(manifestBody);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not prepare HLS playlist' });
  }
});

router.get('/videos/hls/:token/:segment', requireAuth, async (req, res) => {
  try {
    setVideoHlsCorsHeaders(res);
    const requestedAudioTrack = String(req.query.audio_stream || '').trim();
    const segmentName = path.basename(String(req.params.segment || '').trim());
    if (!segmentName || segmentName.includes('..')) return res.status(400).json({ error: 'Invalid HLS segment request' });

    const target = requestedAudioTrack
      ? await Promise.resolve(pgVideoDb.resolveVideoAudioTrackTarget(req.params.token, requestedAudioTrack))
      : await Promise.resolve(pgVideoDb.resolveVideoStreamTarget(req.params.token));
    if (!target) return res.status(404).json({ error: 'Video not found' });
    if (requestedAudioTrack && !target.audio_track) return res.status(404).json({ error: 'Audio track not found' });

    const mediaTools = await Promise.resolve(pgVideoDb.getMediaToolsStatus());
    if (!mediaTools?.available) {
      return res.status(503).json({ error: mediaTools?.message || 'HLS transcoding is not available right now.' });
    }

    const cache = await ensureHlsCache(target, pgVideoDb.ffmpegCommand(), requestedAudioTrack);
    const segmentPath = path.join(cache.dir, segmentName);
    const stats = await fs.promises.stat(segmentPath).catch(() => null);
    if (!(stats?.isFile())) return res.status(404).json({ error: 'HLS segment not found' });

    res.setHeader('Content-Type', segmentName.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Length', String(stats.size || 0));
    fs.createReadStream(segmentPath).pipe(res);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not serve HLS segment' });
  }
});

router.get('/videos/stream/:token', requireAuth, async (req, res) => {
  try {
    const requestedAudioTrack = String(req.query.audio_stream || '').trim();
    if (requestedAudioTrack) {
      const target = await Promise.resolve(pgVideoDb.resolveVideoAudioTrackTarget(req.params.token, requestedAudioTrack));
      if (!target?.audio_track) return res.status(404).json({ error: 'Audio track not found' });
      const startSeconds = Math.max(0, Number(req.query.start_seconds || 0) || 0);
      const audioOnly = String(req.query.audio_only || '').trim() === '1';

      if (audioOnly) {
        const cachedAudio = await ensureAudioClipCacheFile(
          target,
          pgVideoDb.ffmpegCommand(),
          Number(target.audio_track.stream_index || 0),
          startSeconds
        );
        return streamLocalFileWithRange(req, res, cachedAudio);
      }

      const cachedVideo = await ensureAlternateVideoCacheFile(
        target,
        pgVideoDb.ffmpegCommand(),
        Number(target.audio_track.stream_index || 0)
      );
      return streamLocalFileWithRange(req, res, cachedVideo);

      res.setHeader('Content-Type', audioOnly ? 'audio/mp4' : 'video/mp4');
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent((target.filename || 'video').replace(/\.[^.]+$/, '') + '.mp4')}`);

      const ffmpegArgs = [
        '-v', 'error',
      ];
      if (startSeconds > 0 && !audioOnly) {
        ffmpegArgs.push('-ss', String(startSeconds));
      }
      ffmpegArgs.push('-i', target.absolute_path);
      {
        ffmpegArgs.push(
          '-map', '0:v:0',
          '-map', `0:${Number(target.audio_track.stream_index || 0)}`,
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-movflags', 'frag_keyframe+empty_moov+faststart',
          '-f', 'mp4',
          'pipe:1',
        );
      }

      const ffmpeg = spawn(pgVideoDb.ffmpegCommand(), ffmpegArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      ffmpeg.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });
      ffmpeg.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: err.message || 'Could not switch audio track' });
        } else {
          res.end();
        }
      });
      ffmpeg.on('close', (code) => {
        if (code && !res.headersSent) {
          res.status(500).json({ error: stderr.trim() || 'Could not switch audio track' });
        } else if (code && !res.writableEnded) {
          res.end();
        }
      });
      req.on('close', () => {
        if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
      });
      return ffmpeg.stdout.pipe(res);
    }

    const target = await Promise.resolve(pgVideoDb.resolveVideoStreamTarget(req.params.token));
    if (!target) return res.status(404).json({ error: 'Video not found' });

    const ext = String(path.extname(target.absolute_path || target.filename || '') || '').toLowerCase();
    const needsBrowserCompatibleTranscode = ['.mkv', '.avi', '.webm', '.ogg', '.ogv', '.wmv', '.flv', '.ts', '.m2ts', '.mpeg', '.mpg'].includes(ext);
    if (needsBrowserCompatibleTranscode) {
      const mediaTools = await Promise.resolve(pgVideoDb.getMediaToolsStatus());
      if (!mediaTools?.available) {
        return res.status(503).json({ error: mediaTools?.message || 'Browser-compatible transcoding is not available right now.' });
      }
      const cachedTarget = await ensureMobileVideoCacheFile(target, pgVideoDb.ffmpegCommand());
      return streamLocalFileWithRange(req, res, cachedTarget);
    }

    const fileSize = Number(target.stats?.size || 0);
    const range = String(req.headers.range || '').trim();
    const contentType = target.mime_type || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(target.filename || 'video')}`);

    if (!range) {
      res.setHeader('Content-Length', fileSize);
      return fs.createReadStream(target.absolute_path).pipe(res);
    }

    const match = range.match(/bytes=(\d*)-(\d*)/i);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    let start = match[1] === '' ? NaN : Number(match[1]);
    let end = match[2] === '' ? NaN : Number(match[2]);

    if (Number.isNaN(start) && !Number.isNaN(end)) {
      start = Math.max(fileSize - end, 0);
      end = fileSize - 1;
    } else {
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= fileSize) end = fileSize - 1;
    }

    if (start < 0 || end < start || start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(target.absolute_path, { start, end }).pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Could not stream video' });
    } else {
      res.end();
    }
  }
});

router.get('/videos/mobile-stream/:token', requireAuth, async (req, res) => {
  try {
    const target = await Promise.resolve(pgVideoDb.resolveVideoStreamTarget(req.params.token));
    if (!target) return res.status(404).json({ error: 'Video not found' });

    const ext = String(path.extname(target.absolute_path || target.filename || '') || '').toLowerCase();
    const platform = String(req.query.platform || '').trim().toLowerCase();
    const forceTranscode = ['1', 'true', 'yes'].includes(String(req.query.transcode || '').trim().toLowerCase());
    const needsIosTranscode = ['.mkv', '.avi', '.webm', '.ogg', '.ogv', '.wmv', '.flv', '.ts', '.m2ts', '.mpeg', '.mpg'].includes(ext);
    const canDirectPlay = !forceTranscode && (['.mp4', '.m4v', '.mov'].includes(ext) || (platform !== 'ios' && !needsIosTranscode));

    if (canDirectPlay) {
      return streamLocalFileWithRange(req, res, target);
    }

    const mediaTools = await Promise.resolve(pgVideoDb.getMediaToolsStatus());
    if (!mediaTools?.available) {
      return res.status(503).json({ error: mediaTools?.message || 'Mobile transcoding is not available right now.' });
    }
    return streamTranscodedMp4ToResponse(req, res, target, pgVideoDb.ffmpegCommand());
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Could not stream video for mobile' });
    } else {
      res.end();
    }
  }
});

router.get('/videos/poster/:token', requireAuth, async (req, res) => {
  try {
    const target = await Promise.resolve(pgVideoDb.resolvePosterStreamTarget(req.params.token));
    if (!target) return res.status(404).json({ error: 'Poster not found' });
    res.setHeader('Content-Type', target.mime_type || 'image/jpeg');
    res.setHeader('Content-Length', String(target.stats.size || 0));
    fs.createReadStream(target.absolute_path).pipe(res);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load poster' });
  }
});

router.get('/videos/subtitles/:token', requireAuth, async (req, res) => {
  try {
    const target = await Promise.resolve(pgVideoDb.resolveSubtitleStreamTarget(req.params.token));
    if (!target) return res.status(404).json({ error: 'Subtitle file not found' });

    const raw = await fs.promises.readFile(target.absolute_path, 'utf8');
    const body = target.extension === '.srt'
      ? pgVideoDb.convertSrtToVtt(raw)
      : String(raw || '').replace(/^\uFEFF/, '');

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load subtitles' });
  }
});

router.get('/admin/public-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.resolve(getCoreDb().getPublicSiteStats());
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/currencies', requireAdmin, async (_req, res) => {
  try {
    const currencies = await Promise.resolve(getCoreDb().getAdminCurrencyRates());
    res.json({ currencies });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/admin/currencies', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().upsertAdminCurrencyRate(req.body || {}));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/admin/currencies/:code', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().upsertAdminCurrencyRate({ ...(req.body || {}), currency_code: req.params.code }));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/admin/currencies/:code', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteAdminCurrencyRate(req.params.code));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/admin/currencies/sync-latest', requireAdmin, async (_req, res) => {
  try {
    const currencies = await Promise.resolve(getCoreDb().getAdminCurrencyRates());
    const targets = (currencies || [])
      .map((item) => String(item.currency_code || '').toUpperCase())
      .filter((code) => code && code !== 'INR');

    if (!targets.length) {
      return res.json({ success: true, updated: 0, message: 'No non-INR currencies to update.' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(`https://api.frankfurter.dev/v1/latest?base=INR&symbols=${encodeURIComponent(targets.join(','))}`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Rate provider failed with status ${response.status}`);
    }

    const payload = await response.json();
    const rates = payload?.rates && typeof payload.rates === 'object' ? payload.rates : {};
    let updated = 0;

    await Promise.resolve(getCoreDb().upsertAdminCurrencyRate({
      currency_code: 'INR',
      rate_to_inr: 1,
      is_active: 1,
    }));

    for (const code of targets) {
      const perInr = Number(rates[code]);
      if (!Number.isFinite(perInr) || perInr <= 0) continue;
      const rateToInr = Math.round((1 / perInr) * 1000000) / 1000000;
      await Promise.resolve(getCoreDb().upsertAdminCurrencyRate({
        currency_code: code,
        rate_to_inr: rateToInr,
        is_active: currencies.find((item) => String(item.currency_code || '').toUpperCase() === code)?.is_active ? 1 : 0,
      }));
      updated += 1;
    }

    res.json({
      success: true,
      updated,
      provider: 'Frankfurter',
      base: 'INR',
      rate_date: payload?.date || null,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not sync currency rates.' });
  }
});

router.get('/admin/expense-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.resolve(getCoreDb().getAdminExpenseStats());
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/public-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.resolve(getCoreDb().upsertPublicSiteMetrics({
      app_downloads: req.body?.app_downloads,
      daily_visitors: req.body?.daily_visitors,
    }));
    res.json({ success: true, stats });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    res.json({ users: await Promise.resolve(pgDb.getAllUsers()) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/users', requireAdmin, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const displayName = String(req.body?.display_name || '').trim();
    const password = String(req.body?.password || '');
    const mobile = String(req.body?.mobile || '').trim();
    const role = String(req.body?.role || 'user').toLowerCase() === 'admin' ? 'admin' : 'user';
    const isActive = req.body?.is_active === undefined ? true : !!req.body?.is_active;

    if (!username || !email || !displayName || !password) {
      return res.status(400).json({ error: 'Username, email, display name, and password are required.' });
    }
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (!/^[a-z0-9._-]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can include only letters, numbers, dot, underscore, and hyphen' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

    if (await Promise.resolve(pgDb.findUserByUsername(username))) return res.status(400).json({ error: 'Username already taken' });
    if (await Promise.resolve(pgDb.findUserByEmail(email))) return res.status(400).json({ error: 'Email already registered' });
    if (mobile && await Promise.resolve(pgDb.findUserByMobile(mobile))) return res.status(400).json({ error: 'Phone number already registered' });

    const userId = await Promise.resolve(pgDb.createUser(username, email, password, displayName, {}, mobile || null));
    await Promise.resolve(pgDb.assignSignupPlanToUser(userId));
    await Promise.resolve(pgDb.updateUserAdmin(userId, { role, is_active: isActive ? 1 : 0 }, req.session.userId));

    res.json({ success: true, id: Number(userId) });
  } catch (err) {
    if (err?.code === '23505') {
      if (String(err.constraint || '').includes('username')) return res.status(400).json({ error: 'Username already taken' });
      if (String(err.constraint || '').includes('email')) return res.status(400).json({ error: 'Email already registered' });
      return res.status(400).json({ error: 'That account information is already in use' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.updateUserAdmin(req.params.id, req.body, req.session.userId));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.softDeleteUser(req.params.id, req.session.userId));
    res.json({ success: true });
  }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/admin/users/:id/restore', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.restoreUser(req.params.id, req.session.userId));
    res.json({ success: true });
  }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/admin/users/:id/set-password', requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password too short (min 6)' });
    const bcrypt = require('bcryptjs');
    await Promise.resolve(pgDb.resetUserPassword(req.params.id, bcrypt.hashSync(password, 10)));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/users/:id/reset-link', requireAdmin, async (req, res) => {
  try {
    const token = await Promise.resolve(pgDb.createPasswordReset(req.params.id));
    const link = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
    res.json({ success: true, token, link });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/users/:id/otp', requireAdmin, async (req, res) => {
  try {
    const { purpose, channel } = req.body;
    const code = await Promise.resolve(pgDb.generateOtp(req.params.id, purpose || 'login', channel || 'email'));
    res.json({ success: true, otp: code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/v1/admin/push-notifications/dashboard', requireAdmin, async (_req, res) => {
  try {
    const summary = await Promise.resolve(pgAdminNotificationsDb.getDashboardSummary());
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/v1/admin/push-notifications/users', requireAdmin, async (req, res) => {
  try {
    const result = await Promise.resolve(pgAdminNotificationsDb.listUsersForTargeting({
      page: req.query.page,
      page_size: req.query.page_size,
      search: req.query.search,
      role: req.query.role,
      plan_id: req.query.plan_id,
      active_only: req.query.active_only,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/v1/admin/push-notifications/devices', requireAdmin, async (req, res) => {
  try {
    const result = await Promise.resolve(pgAdminNotificationsDb.listDeviceTokens({
      page: req.query.page,
      page_size: req.query.page_size,
      search: req.query.search,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/v1/admin/push-notifications/templates', requireAdmin, async (req, res) => {
  try {
    const templates = await Promise.resolve(pgAdminNotificationsDb.listTemplates({ search: req.query.search }));
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/v1/admin/push-notifications/templates', requireAdmin, async (req, res) => {
  try {
    const template = await Promise.resolve(pgAdminNotificationsDb.upsertTemplate(req.body || {}, req.user?.id || null));
    res.json({ success: true, template });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/v1/admin/push-notifications/templates/:id', requireAdmin, async (req, res) => {
  try {
    const template = await Promise.resolve(pgAdminNotificationsDb.upsertTemplate(req.body || {}, req.user?.id || null, req.params.id));
    res.json({ success: true, template });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/v1/admin/push-notifications/templates/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgAdminNotificationsDb.softDeleteTemplate(req.params.id, req.user?.id || null));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/v1/admin/push-notifications/campaigns', requireAdmin, async (req, res) => {
  try {
    const result = await Promise.resolve(pgAdminNotificationsDb.listCampaigns({
      page: req.query.page,
      page_size: req.query.page_size,
      status: req.query.status,
      search: req.query.search,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/v1/admin/push-notifications/campaigns', requireAdmin, async (req, res) => {
  try {
    const campaign = await Promise.resolve(pgAdminNotificationsDb.saveCampaign(req.body || {}, req.user?.id || null));
    if (String(campaign?.status || '').toLowerCase() !== 'draft') {
      setTimeout(() => { pgAdminNotificationsDb.processDueNotifications().catch(() => {}); }, 50);
    }
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/v1/admin/push-notifications/campaigns/:id', requireAdmin, async (req, res) => {
  try {
    const campaign = await Promise.resolve(pgAdminNotificationsDb.getCampaignById(req.params.id));
    if (!campaign) return res.status(404).json({ error: 'Notification not found' });
    res.json({ campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/v1/admin/push-notifications/campaigns/:id', requireAdmin, async (req, res) => {
  try {
    const campaign = await Promise.resolve(pgAdminNotificationsDb.saveCampaign(req.body || {}, req.user?.id || null, req.params.id));
    if (String(campaign?.status || '').toLowerCase() !== 'draft') {
      setTimeout(() => { pgAdminNotificationsDb.processDueNotifications().catch(() => {}); }, 50);
    }
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/v1/admin/push-notifications/campaigns/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgAdminNotificationsDb.softDeleteCampaign(req.params.id, req.user?.id || null));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/v1/admin/push-notifications/campaigns/:id/duplicate', requireAdmin, async (req, res) => {
  try {
    const campaign = await Promise.resolve(pgAdminNotificationsDb.duplicateCampaign(req.params.id, req.user?.id || null));
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/v1/admin/push-notifications/campaigns/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const campaign = await Promise.resolve(pgAdminNotificationsDb.cancelScheduledCampaign(req.params.id, req.user?.id || null));
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/v1/admin/push-notifications/campaigns/:id/process-now', requireAdmin, async (req, res) => {
  try {
    const outcome = await Promise.resolve(pgAdminNotificationsDb.processDueNotifications());
    res.json({ success: true, outcome });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/v1/admin/push-notifications/process-now', requireAdmin, async (req, res) => {
  try {
    const outcome = await Promise.resolve(pgAdminNotificationsDb.processDueNotifications());
    res.json({ success: true, outcome });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/v1/admin/push-notifications/test', requireAdmin, async (req, res) => {
  try {
    const result = await Promise.resolve(pgAdminNotificationsDb.sendTestNotification(req.body || {}, req.user?.id || null));
    res.json({ success: result.success, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/v1/admin/push-notifications/logs', requireAdmin, async (req, res) => {
  try {
    const result = await Promise.resolve(pgAdminNotificationsDb.listDeliveryLogs({
      page: req.query.page,
      page_size: req.query.page_size,
      search: req.query.search,
      status: req.query.status,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      notification_id: req.query.notification_id,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/v1/admin/push-notifications/logs/export.csv', requireAdmin, async (req, res) => {
  try {
    const csv = await Promise.resolve(pgAdminNotificationsDb.exportDeliveryLogsCsv({
      search: req.query.search,
      status: req.query.status,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      notification_id: req.query.notification_id,
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="notification-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/portal-access-logs', requireAdmin, async (req, res) => {
  try {
    const result = await Promise.resolve(pgPortalAccessDb.listPortalAccessLogs({
      page: req.query.page,
      page_size: req.query.page_size,
      portal_type: req.query.portal_type,
      access_kind: req.query.access_kind,
      search: req.query.search,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load portal access logs' });
  }
});

router.get('/admin/notifications/users', requireAdmin, async (req, res) => {
  try {
    const planId = req.query.plan_id ? Number(req.query.plan_id) : null;
    const users = await Promise.resolve(pgDb.getAdminPushUsers(req.query.search || '', planId));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/notifications/send', requireAdmin, async (req, res) => {
  try {
    const userIds = parseAdminUserIdList(req.body?.user_ids);
    if (!userIds.length) return res.status(400).json({ error: 'Select at least one user' });

    const message = normalizeMessagePayload({
      title: req.body?.title,
      body: req.body?.message,
      data: req.body?.data || {},
    });

    const createdNotifications = [];
    for (const userId of userIds) {
      const notification = await Promise.resolve(pgDb.createUserNotification(userId, {
        type: 'admin_broadcast',
        title: message.title,
        body: message.body,
        data: message.data || {},
      }));
      if (notification) createdNotifications.push(notification);
    }

    const notificationByUserId = new Map(
      createdNotifications.map((item) => [Number(item.user_id), item])
    );

    const tokenRows = await Promise.resolve(pgDb.getPushTokensForUsers(userIds));

    const tokenUsers = new Set(tokenRows.map((row) => row.user_id));
    const missingUserIds = userIds.filter((id) => !tokenUsers.has(id));
    const delivery = tokenRows.length
      ? await sendExpoPushNotifications(tokenRows.map((row) => ({
          to: row.token,
          title: message.title,
          body: message.body,
          user_id: row.user_id,
          notification_id: notificationByUserId.get(Number(row.user_id))?.id || null,
          platform: row.platform,
          data: {
            ...message.data,
            user_id: row.user_id,
            notificationId: notificationByUserId.get(Number(row.user_id))?.id || null,
          },
        })))
      : { ok: true, sent: 0, chunks: [], errors: [], tickets: [], receipts: [] };

    for (const ticketRow of (delivery.tickets || [])) {
      if (ticketRow?.ticket?.status !== 'ok') continue;
      const userId = Number(ticketRow?.meta?.user_id || 0);
      const notificationId = Number(ticketRow?.meta?.notification_id || 0);
      if (userId > 0 && notificationId > 0) {
        await Promise.resolve(pgDb.markUserNotificationPushed(userId, notificationId));
      }
    }

    res.json({
      success: delivery.errors.length === 0,
      requested_user_count: userIds.length,
      created_count: createdNotifications.length,
      delivered_user_count: tokenUsers.size,
      device_count: tokenRows.length,
      skipped_user_ids: missingUserIds,
      sent_count: delivery.sent,
      errors: delivery.errors,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/admin/plans', requireAdmin, async (req, res) => {
  try {
    res.json({ plans: await Promise.resolve(pgDb.getPlans()) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/plans', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, id: await Promise.resolve(pgDb.createPlan(req.body)) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/plans/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.updatePlan(req.params.id, req.body));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/plans/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.deletePlan(req.params.id));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/subscriptions', requireAdmin, async (req, res) => {
  try {
    res.json({ subscriptions: await Promise.resolve(pgDb.getSubscriptions()) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/subscriptions', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, id: await Promise.resolve(pgDb.createSubscription(req.body)) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.updateSubscription(req.params.id, req.body));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.deleteSubscription(req.params.id));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── BANK ACCOUNTS ────────────────────────────────────────────
router.get('/admin/ai-learning/report', requireAdmin, async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const report = await Promise.resolve(getOpsDb().getAiLearningReport(days));
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/ai-learning/teach', requireAdmin, async (req, res) => {
  try {
    const normalizedQuestion = String(req.body?.normalized_question || '').trim().toLowerCase();
    const detectedIntent = String(req.body?.detected_intent || '').trim();
    if (!normalizedQuestion || !detectedIntent) {
      return res.status(400).json({ error: 'normalized_question and detected_intent are required' });
    }
    const result = await Promise.resolve(getOpsDb().teachAiIntent(normalizedQuestion, detectedIntent, req.session.userId));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/ai-learning/test', requireAdmin, async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Question is required' });

    let [summary, currentUser] = await Promise.all([
      Promise.resolve(getFinanceDb().getUserFinancialSummary(req.session.userId)),
      Promise.resolve(pgDb.findUserById(req.session.userId)),
    ]);
    const requestedDateKey = aiExtractDateKey(question, summary);
    if (requestedDateKey) {
      summary = await ensureAiSummaryForDate(req.session.userId, summary, requestedDateKey);
    }
    summary = await enrichAiSummaryWithModules(req.session.userId, summary, question);

    const normalizedQuestion = aiNormalizeQuestion(question);
    const trainedAnswer = lookupMode === 'online'
      ? null
      : await Promise.resolve(getOpsDb().findAiTrainingExample(normalizedQuestion));
    if (trainedAnswer?.ideal_answer) {
      return res.json({
        success: true,
        question,
        normalized_question: normalizedQuestion,
        answer: trainedAnswer.ideal_answer,
        ai_meta: {
          detected_intent: trainedAnswer.detected_intent || 'trained_answer',
          detected_confidence: 1,
          resolved_intent: trainedAnswer.detected_intent || 'trained_answer',
          resolved_confidence: 1,
          resolution_method: 'admin_training_store',
          learned_match: null,
          answer_type: 'admin_trained_answer',
        },
      });
    }

    const detectedResolution = aiResolveIntent(question, summary);
    const detectedIntent = detectedResolution.intent;
    let resolvedIntent = detectedIntent;
    let learnedMatch = null;
    let questionForAnswer = question;
    let resolvedConfidence = Number(detectedResolution.confidence || 0);
    let resolutionMethod = detectedResolution.method || 'concept_rule';

    if (resolvedIntent === 'unknown') {
      const examples = await Promise.resolve(getOpsDb().getAiIntentLearningExamples(400));
      learnedMatch = aiInferIntentFromExamples(question, examples);
      if (learnedMatch?.intent) {
        resolvedIntent = learnedMatch.intent;
        questionForAnswer = aiCanonicalQuestionForIntent(resolvedIntent, question);
        resolvedConfidence = Number(learnedMatch.score || 0);
        resolutionMethod = learnedMatch.method || 'similar_log_match';
      }
    }

    const answer = aiAnswerFromSummary(questionForAnswer, summary, currentUser);
    const wasFallback = aiIsFallbackAnswer(answer);
    const answerType = learnedMatch?.intent && !wasFallback ? 'learned_rule' : (wasFallback ? 'fallback' : 'structured_rule');
    res.json({
      success: true,
      question,
      normalized_question: normalizedQuestion,
      answer,
      ai_meta: {
        detected_intent: detectedIntent,
        detected_confidence: Number(detectedResolution.confidence || 0),
        resolved_intent: wasFallback ? detectedIntent : resolvedIntent,
        resolved_confidence: wasFallback ? Number(detectedResolution.confidence || 0) : resolvedConfidence,
        resolution_method: wasFallback ? (detectedResolution.method || 'unknown') : resolutionMethod,
        learned_match: learnedMatch ? {
          method: learnedMatch.method,
          score: learnedMatch.score,
          example: learnedMatch.example,
        } : null,
        answer_type: answerType,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/ai-learning/training-example', requireAdmin, async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim();
    const normalizedQuestion = aiNormalizeQuestion(req.body?.normalized_question || question);
    const detectedIntent = String(req.body?.detected_intent || '').trim();
    const idealAnswer = String(req.body?.ideal_answer || '').trim();
    const notes = String(req.body?.notes || '').trim();
    const trainingPayload = req.body?.training_payload && typeof req.body.training_payload === 'object'
      ? req.body.training_payload
      : null;

    if (!normalizedQuestion) {
      return res.status(400).json({ error: 'Question is required' });
    }
    if (!idealAnswer) {
      return res.status(400).json({ error: 'Ideal answer is required' });
    }

    const result = await Promise.resolve(getOpsDb().saveAiTrainingExample({
      question,
      normalized_question: normalizedQuestion,
      detected_intent: detectedIntent || null,
      ideal_answer: idealAnswer,
      notes,
      training_payload: trainingPayload,
    }, req.session.userId));

    res.json({ success: true, training_example: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/banks', (req, res) => {
  Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)).then((accounts) => {
    res.json({ accounts });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.post('/banks', (req, res) => {
  Promise.resolve(getOpsDb().addBankAccount(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/banks/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateBankAccount(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.delete('/banks/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteBankAccount(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.patch('/banks/:id/balance', (req, res) => {
  try {
    const balance = parseFloat(req.body.balance);
    if (isNaN(balance) || balance < 0) return res.status(400).json({ error: 'Invalid balance' });
    Promise.resolve(getOpsDb().updateBankBalance(req.session.userId, req.params.id, balance)).then(() => {
      res.json({ success: true });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/banks/:id/default', (req, res) => {
  Promise.resolve(getOpsDb().setDefaultBankAccount(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

// ─── DEFAULT PAYMENTS ─────────────────────────────────────────
router.get('/planner/defaults', (req, res) => {
  Promise.resolve(getOpsDb().getDefaultPayments(req.session.userId)).then((defaults) => {
    res.json({ defaults });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.post('/planner/defaults', (req, res) => {
  Promise.resolve(getOpsDb().addDefaultPayment(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/planner/defaults/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateDefaultPayment(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.delete('/planner/defaults/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteDefaultPayment(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

// ─── PLANNER PREVIEW (future month, read-only) ────────────────
router.get('/planner/preview', (req, res) => {
  try {
    const month    = req.query.month || new Date().toISOString().slice(0, 7);
    Promise.all([
      Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)),
      Promise.resolve(getFinanceDb().getPreviewDataForMonth(req.session.userId, month, getBillingDb())),
    ]).then(([accounts, preview]) => {
      res.json({ accounts, ...preview });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── MONTHLY PAYMENTS ─────────────────────────────────────────
router.get('/planner/monthly', (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    Promise.all([
      Promise.resolve(getOpsDb().getMonthlyPayments(req.session.userId, month)),
      Promise.resolve(getOpsDb().getSkippedPayments(req.session.userId, month)),
      Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)),
      Promise.resolve(getBillingDb().getCcDuesForMonth(req.session.userId, month)),
      Promise.resolve(getFinanceDb().getEmiDuesForMonth(req.session.userId, month)),
    ]).then(([payments, skipped, accounts, ccDues, emiDues]) => {
      res.json({ payments, skipped, accounts, ccDues, emiDues });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/planner/monthly', (req, res) => {
  Promise.resolve(getOpsDb().addMonthlyPayment(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/planner/monthly/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateMonthlyPayment(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.delete('/planner/monthly/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteMonthlyPayment(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/planner/monthly/:id/restore', (req, res) => {
  Promise.resolve(getOpsDb().restoreMonthlyPayment(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.delete('/planner/monthly/:id/hard', (req, res) => {
  Promise.resolve(getOpsDb().hardDeleteMonthlyPayment(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/planner/monthly/:id/pay', (req, res) => {
  Promise.resolve(getOpsDb().payMonthlyPayment(req.session.userId, req.params.id, req.body.paid_amount, req.body.paid_date, req.body.bank_account_id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

// ─── CREDIT CARDS ─────────────────────────────────────────────
router.get('/cc/cards', (req, res) => {
  Promise.resolve(getBillingDb().getCreditCards(req.session.userId)).then((cards) => {
    res.json({ cards });
  }).catch((err) => {
    console.error('[cc/cards] failed for user', req.session?.userId, err?.stack || err?.message || err);
    res.status(500).json({ error: err.message });
  });
});

router.post('/cc/cards', (req, res) => {
  Promise.resolve(getBillingDb().addCreditCard(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.put('/cc/cards/:id', (req, res) => {
  Promise.resolve(getBillingDb().updateCreditCard(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.delete('/cc/cards/:id', (req, res) => {
  Promise.resolve(getBillingDb().deleteCreditCard(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/current', (req, res) => {
  Promise.resolve(getBillingDb().getCcCurrentCycle(req.session.userId, req.params.id)).then((data) => {
    res.json(data);
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/cycles', (req, res) => {
  Promise.resolve(getBillingDb().getCcCycles(req.session.userId, req.params.id)).then((cycles) => {
    res.json({ cycles });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/monthly', (req, res) => {
  const year = req.query.year || null;
  Promise.resolve(getBillingDb().getCcMonthlySummary(req.session.userId, req.params.id, year)).then((months) => {
    res.json({ months });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/yearly', (req, res) => {
  Promise.resolve(getBillingDb().getCcYearlySummary(req.session.userId, req.params.id)).then((years) => {
    res.json({ years });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/years', (req, res) => {
  Promise.resolve(getBillingDb().getCcAvailableYears(req.session.userId, req.params.id)).then((years) => {
    res.json({ years });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/txns/by-source', (req, res) => {
  const { source, source_id } = req.query;
  if (!source || !source_id) return res.status(400).json({ error: 'source and source_id required' });
  Promise.resolve(getBillingDb().getCcTxnBySource(req.session.userId, source, parseInt(source_id)))
    .then(txn => res.json({ txn: txn || null }))
    .catch(err => res.status(500).json({ error: err.message }));
});

router.post('/cc/txns', (req, res) => {
  Promise.resolve(getBillingDb().addCcTxn(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/cc/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map(s => s.name()) });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('encrypt')) {
      res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    } else {
      res.status(500).json({ error: msg || 'Failed to read file' });
    }
  }
});

router.post('/cc/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets = parseSheetParam(req.body.sheets);
    const defaultTxnDate = req.body.default_txn_date || null;
    const { rows, skipped } = await parseCcExcelBuffer(req.file.buffer, sheets, req.body.password, defaultTxnDate);
    res.json({ count: rows.length, skipped, preview: rows.slice(0, 15) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to parse file' });
  }
});

router.post('/cc/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const cycleId = parseInt(req.body.cycle_id);
    const discountPct = req.body.discount_pct !== undefined && req.body.discount_pct !== '' ? parseFloat(req.body.discount_pct) : null;
    if (!cycleId) return res.status(400).json({ error: 'cycle_id required' });
    const sheets = parseSheetParam(req.body.sheets);
    const defaultTxnDate = req.body.default_txn_date || null;
    const { rows, skipped } = await parseCcExcelBuffer(req.file.buffer, sheets, req.body.password, defaultTxnDate);
    if (!rows.length) return res.status(400).json({ error: 'No valid rows found. Check the file format.' });
    const count = await Promise.resolve(getBillingDb().bulkAddCcTxnsToCycle(req.session.userId, cycleId, rows, discountPct));
    res.json({ success: true, imported: count, total: rows.length + skipped });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

router.put('/cc/txns/:id', (req, res) => {
  try { Promise.resolve(getBillingDb().updateCcTxn(req.session.userId, req.params.id, req.body)).then(() => res.json({ success: true })).catch((err) => res.status(500).json({ error: err.message })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/cc/txns/:id', (req, res) => {
  try { Promise.resolve(getBillingDb().deleteCcTxn(req.session.userId, req.params.id)).then(() => res.json({ success: true })).catch((err) => res.status(500).json({ error: err.message })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Static route must be before dynamic /:id/close to avoid conflict
router.post('/cc/cycles/import', (req, res) => {
  try {
    const { card_id, rows } = req.body;
    if (!card_id || !Array.isArray(rows)) return res.status(400).json({ error: 'card_id and rows required' });
    Promise.resolve(getBillingDb().importHistoricalCycles(req.session.userId, card_id, rows)).then((count) => {
      res.json({ success: true, imported: count });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cc/cycles/:id/txns', (req, res) => {
  try {
    Promise.resolve(getBillingDb().addCcTxnToCycle(req.session.userId, req.params.id, req.body)).then((id) => {
      res.json({ success: true, id });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cc/cycles/:id/bill-match', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    await ensureFeatureAccess(req.session.userId, 'creditcard_bill_match');
    const cycleData = await Promise.resolve(getBillingDb().getCcCycleById(req.session.userId, req.params.id));
    if (!cycleData?.cycle) return res.status(404).json({ error: 'Cycle not found' });
    const result = await matchCreditCardBillPdfWithOpenAi(req.file, {
      ...cycleData,
      password: String(req.body?.password || '').trim(),
    });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not match this bill PDF.' });
  }
});

router.put('/cc/cycles/:id', (req, res) => {
  try {
    Promise.resolve(getBillingDb().updateCcCycle(req.session.userId, req.params.id, req.body)).then(() => {
      res.json({ success: true });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/cc/cycles/:id', (req, res) => {
  try {
    Promise.resolve(getBillingDb().deleteCcCycle(req.session.userId, req.params.id)).then(() => {
      res.json({ success: true });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/cc/cycles/:id/close', (req, res) => {
  try {
    Promise.resolve(getBillingDb().closeCcCycle(req.session.userId, req.params.id, req.body.paid_amount, req.body.paid_date, req.body.bank_account_id)).then(() => {
      res.json({ success: true });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── AI LOOKUP ───────────────────────────────────────────────────────────────
function aiNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function aiCurrency(summary, currentUser, value) {
  const currency = currentUser?.currency_code || 'USD';
  const locale = currentUser?.locale_code || 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(aiNum(value));
  } catch (_err) {
    return `${currency} ${aiNum(value).toFixed(2)}`;
  }
}

function aiMonthLabel(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || 'this month';
  const date = new Date(`${raw}-01T00:00:00Z`);
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  } catch (_err) {
    return raw;
  }
}

function aiExtractYear(question, fallbackMonth) {
  const match = String(question || '').match(/\b(20\d{2})\b/);
  if (match) return match[1];
  return String(fallbackMonth || '').slice(0, 4) || String(new Date().getFullYear());
}

function aiMonthShift(monthKey, delta) {
  const raw = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return '';
  const [year, month] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function aiExtractMonthKey(question, summary) {
  const normalized = String(question || '').toLowerCase();
  if (normalized.includes('last month') || normalized.includes('previous month')) {
    return aiMonthShift(summary?.current_month, -1);
  }
  if (normalized.includes('this month') || normalized.includes('current month')) {
    return String(summary?.current_month || '');
  }

  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const year = aiExtractYear(question, summary?.current_month);
  for (let idx = 0; idx < monthNames.length; idx += 1) {
    if (normalized.includes(monthNames[idx])) {
      return `${year}-${String(idx + 1).padStart(2, '0')}`;
    }
  }
  return '';
}

function aiDateLabel(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || 'that day';
  const date = new Date(`${raw}T00:00:00Z`);
  try {
    return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  } catch (_err) {
    return raw;
  }
}

function aiDateKeyValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  if (!raw) return '';
  const isoMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return raw.slice(0, 10);
}

function aiExtractDateKey(question, summary) {
  const raw = String(question || '').trim();
  const normalized = raw.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const today = String(summary?.as_of || new Date().toISOString().slice(0, 10));

  if (/\btoday\b/.test(normalized)) return today;
  if (/\byesterday\b/.test(normalized)) {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  const isoMatch = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const monthNames = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
  };

  const dayMonthYearMatch = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(20\d{2})\b/);
  if (dayMonthYearMatch) {
    const [, day, monthName, year] = dayMonthYearMatch;
    return `${year}-${String(monthNames[monthName]).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const monthDayYearMatch = normalized.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(20\d{2})\b/);
  if (monthDayYearMatch) {
    const [, monthName, day, year] = monthDayYearMatch;
    return `${year}-${String(monthNames[monthName]).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const dayMonthMatch = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b/);
  if (dayMonthMatch) {
    const [, day, monthName] = dayMonthMatch;
    const fallbackYear = aiExtractYear(question, summary?.current_month);
    return `${fallbackYear}-${String(monthNames[monthName]).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return '';
}

function aiFindDayRow(summary, dateKey) {
  const rows = Array.isArray(summary?.expense_by_day) ? summary.expense_by_day : [];
  const target = aiDateKeyValue(dateKey);
  return rows.find((row) => aiDateKeyValue(row.day) === target) || null;
}

function aiFindPetrolDayRow(summary, dateKey) {
  const rows = Array.isArray(summary?.petrol_by_day) ? summary.petrol_by_day : [];
  const target = aiDateKeyValue(dateKey);
  return rows.find((row) => aiDateKeyValue(row.day) === target) || null;
}

async function ensureAiSummaryForDate(userId, summary, dateKey) {
  const target = aiDateKeyValue(dateKey);
  if (!target) return summary;
  if (aiFindDayRow(summary, target)) return summary;

  const exactDay = await Promise.resolve(pgFinanceDb.getExpensesForDate(userId, target));
  if (!exactDay || !Array.isArray(exactDay.expenses) || !exactDay.expenses.length) return summary;

  const expenseByDay = Array.isArray(summary?.expense_by_day) ? [...summary.expense_by_day] : [];
  expenseByDay.unshift({
    day: target,
    total: aiNum(exactDay.total),
    count: Number(exactDay.count) || exactDay.expenses.length,
  });

  const recentExpenses = Array.isArray(summary?.recent_expenses) ? [...summary.recent_expenses] : [];
  const mergedExpenses = [...exactDay.expenses, ...recentExpenses.filter((row) => aiDateKeyValue(row?.purchase_date) !== target)];

  return {
    ...summary,
    expense_by_day: expenseByDay,
    recent_expenses: mergedExpenses,
  };
}

function aiFindMonthRow(summary, monthKey) {
  const rows = Array.isArray(summary?.expense_last_6_months) ? summary.expense_last_6_months : [];
  return rows.find((row) => String(row.month) === String(monthKey)) || null;
}

function aiFindPetrolMonthRow(summary, monthKey) {
  const rows = Array.isArray(summary?.petrol_divide_months) ? summary.petrol_divide_months : [];
  const monthlySummary = summary?.petrol_month_snapshot;
  if (monthlySummary && String(monthlySummary.month_key) === String(monthKey)) return monthlySummary;
  return rows.find((row) => String(row.month_key) === String(monthKey)) || null;
}

function aiFindFriendByName(summary, question) {
  const friends = Array.isArray(summary?.friends_loan_summary) ? summary.friends_loan_summary : [];
  const normalized = String(question || '').toLowerCase();
  return friends.find((row) => String(row.name || '').toLowerCase() && normalized.includes(String(row.name || '').toLowerCase())) || null;
}

function aiFindCategoryRow(summary, question) {
  const rows = Array.isArray(summary?.expense_by_category) ? summary.expense_by_category : [];
  const normalized = String(question || '').toLowerCase();
  return rows.find((row) => String(row.category || '').toLowerCase() && normalized.includes(String(row.category || '').toLowerCase())) || null;
}

function aiFindTrip(summary, question) {
  const trips = Array.isArray(summary?.active_trips) ? summary.active_trips : [];
  const normalized = String(question || '').toLowerCase();
  return trips.find((row) => String(row.name || '').toLowerCase() && normalized.includes(String(row.name || '').toLowerCase())) || null;
}

function aiFindCard(summary, question) {
  const cards = Array.isArray(summary?.credit_cards) ? summary.credit_cards : [];
  const normalized = String(question || '').toLowerCase();
  return cards.find((row) => {
    const cardName = String(row.card_name || '').toLowerCase();
    const bankName = String(row.bank_name || '').toLowerCase();
    const last4 = String(row.last4 || '').toLowerCase();
    return (cardName && normalized.includes(cardName)) || (bankName && normalized.includes(bankName)) || (last4 && normalized.includes(last4));
  }) || null;
}

function aiRecentMonthsTotal(summary, count) {
  const rows = Array.isArray(summary?.expense_last_6_months) ? summary.expense_last_6_months : [];
  return rows.slice(0, count).reduce((sum, row) => sum + aiNum(row.total), 0);
}

function aiLines(items) {
  return items.filter(Boolean).join('\n');
}

const AI_SYNONYM_TO_CANONICAL = Object.entries(AI_SYNONYM_GROUPS).reduce((acc, [canonical, values]) => {
  values.forEach((value) => {
    acc[value] = canonical;
  });
  return acc;
}, {});

function aiSingularizeToken(token) {
  const value = String(token || '').trim().toLowerCase();
  if (!value) return '';
  if (value.endsWith('ies') && value.length > 3) return `${value.slice(0, -3)}y`;
  if (value.endsWith('es') && value.length > 3) return value.slice(0, -2);
  if (value.endsWith('s') && value.length > 3) return value.slice(0, -1);
  return value;
}

function aiCanonicalToken(token) {
  const base = aiSingularizeToken(token);
  return AI_SYNONYM_TO_CANONICAL[base] || base;
}

function aiTokens(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .map(aiCanonicalToken)
    .filter(Boolean);
}

function aiHasAnyToken(tokens, values) {
  return values.some((value) => tokens.includes(value));
}

function aiHasAllTokens(tokens, values) {
  return values.every((value) => tokens.includes(value));
}

function aiTopExpenseYear(summary) {
  const rows = Array.isArray(summary?.expense_by_year) ? summary.expense_by_year : [];
  if (!rows.length) return null;
  return rows.reduce((best, row) => (aiNum(row.total) > aiNum(best?.total) ? row : best), rows[0]);
}

function aiNormalizeQuestion(question) {
  return aiTokens(question).join(' ');
}

function aiIsFallbackAnswer(answer) {
  const text = String(answer || '').trim();
  return text.startsWith('I can answer structured questions about your expenses')
    || text.startsWith('I can answer structured questions across ');
}

function aiResolveIntent(question, summary) {
  const q = String(question || '').trim();
  const normalized = q.toLowerCase();
  const tokens = aiTokens(q);
  const concepts = {
    expense: aiHasAnyToken(tokens, ['expense']),
    item: aiHasAnyToken(tokens, ['item']),
    expensive: aiHasAnyToken(tokens, ['expensive']),
    top: aiHasAnyToken(tokens, ['top']),
    year: aiHasAnyToken(tokens, ['year']),
    month: aiHasAnyToken(tokens, ['month']),
    compare: aiHasAnyToken(tokens, ['compare']),
    category: aiHasAnyToken(tokens, ['category']),
    friend: aiHasAnyToken(tokens, ['friend']),
    owe: aiHasAnyToken(tokens, ['owe']),
    trip: aiHasAnyToken(tokens, ['trip']),
    card: aiHasAnyToken(tokens, ['card']),
    due: aiHasAnyToken(tokens, ['due']),
    bank: aiHasAnyToken(tokens, ['bank']),
    recurring: aiHasAnyToken(tokens, ['recurring']),
    emi: aiHasAnyToken(tokens, ['emi']),
    petrol: aiHasAnyToken(tokens, ['petrol']),
    tracker: aiHasAnyToken(tokens, ['tracker']),
    habit: aiHasAnyToken(tokens, ['habit']),
    live_split: aiHasAnyToken(tokens, ['live_split']),
    active: aiHasAnyToken(tokens, ['active']),
    recent: aiHasAnyToken(tokens, ['recent']),
    summary: aiHasAnyToken(tokens, ['summary']),
    fair: aiHasAnyToken(tokens, ['fair']),
    extra: aiHasAnyToken(tokens, ['extra']),
  };
  const context = {
    question: q,
    normalized,
    tokens,
    concepts,
    dateKey: aiExtractDateKey(q, summary),
    monthKey: aiExtractMonthKey(q, summary),
    namedFriend: aiFindFriendByName(summary, q),
    namedTrip: aiFindTrip(summary, q),
    namedCard: aiFindCard(summary, q),
    categoryRow: aiFindCategoryRow(summary, q),
  };
  const matchedRule = AI_INTENT_RULES.find((rule) => {
    try {
      return !!rule.match(context);
    } catch (error) {
      return false;
    }
  });
  if (matchedRule) {
    return {
      intent: matchedRule.intent,
      confidence: matchedRule.confidence || 0.8,
      method: matchedRule.method || 'concept_rule',
    };
  }
  return { intent: 'unknown', confidence: 0.1, method: 'unknown' };
}

function aiDetectIntent(question, summary) {
  return aiResolveIntent(question, summary).intent;
}

function aiCanonicalQuestionForIntent(intent, originalQuestion) {
  return AI_CANONICAL_QUESTIONS[String(intent || '')] || originalQuestion;
}

function aiFilteredTokens(question) {
  const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'am', 'i', 'me', 'my', 'with', 'what', 'which', 'show', 'tell', 'give', 'do', 'did', 'to', 'of', 'for', 'in', 'on', 'at', 'this', 'that', 'it', 'be', 'have', 'has']);
  return aiTokens(question).filter((token) => !stopWords.has(token));
}

function aiTokenSimilarity(questionA, questionB) {
  const a = new Set(aiFilteredTokens(questionA));
  const b = new Set(aiFilteredTokens(questionB));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });
  const union = new Set([...a, ...b]).size || 1;
  return intersection / union;
}

function aiInferIntentFromExamples(question, examples) {
  const normalizedQuestion = aiNormalizeQuestion(question);
  const exact = examples.find((row) => String(row.normalized_question || '') === normalizedQuestion);
  if (exact) {
    return { intent: exact.detected_intent, score: 1, method: 'exact_log_match', example: exact.normalized_question };
  }

  let best = null;
  for (const row of examples) {
    const exampleQuestion = String(row.normalized_question || '');
    if (!exampleQuestion) continue;
    const score = aiTokenSimilarity(normalizedQuestion, exampleQuestion);
    const weightedScore = score + Math.min(Number(row.use_count || 0), 10) * 0.01;
    if (!best || weightedScore > best.weightedScore) {
      best = { intent: row.detected_intent, score, weightedScore, example: exampleQuestion };
    }
  }
  if (best && best.score >= 0.5) {
    return { intent: best.intent, score: best.score, method: 'similar_log_match', example: best.example };
  }
  return null;
}

async function parsePetrolExcelBuffer(buffer, sheetNames, password) {
  const opts = password ? { password } : {};
  const wb = await XlsxPopulate.fromDataAsync(buffer, opts);
  const allSheets = wb.sheets().map((s) => s.name());
  const targets = (Array.isArray(sheetNames) && sheetNames.length > 0)
    ? sheetNames.filter((n) => allSheets.includes(n))
    : [allSheets[0]];

  const rows = [];
  let skipped = 0;

  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const aliases = {
    date: ['date', 'entry date'],
    remarks: ['remarks', 'remark', 'details', 'description'],
    price: ['petrol price', 'petrolprice', 'price'],
    distance: ['distance', 'distance (in km)', 'distance in km', 'km'],
    members: ['members', 'member', 'initials'],
    average: ['average', 'avg', 'average (km/l)', 'average km/l', 'average kmpl'],
  };
  const findCol = (headers, names) => headers.findIndex((h) => names.includes(h));

  for (const sheetName of targets) {
    const sheet = wb.sheet(sheetName);
    const usedRange = sheet.usedRange();
    if (!usedRange) continue;
    const lastRow = usedRange.endCell().rowNumber();
    const lastCol = usedRange.endCell().columnNumber();

    let headerRow = 1;
    let dateCol = -1;
    let remarksCol = -1;
    let priceCol = -1;
    let distanceCol = -1;
    let membersCol = -1;
    let averageCol = -1;

    for (let r = 1; r <= Math.min(8, lastRow); r++) {
      const headers = Array.from({ length: lastCol }, (_, i) => norm(sheet.cell(r, i + 1).value()));
      const d = findCol(headers, aliases.date);
      const rem = findCol(headers, aliases.remarks);
      const p = findCol(headers, aliases.price);
      const dist = findCol(headers, aliases.distance);
      const mem = findCol(headers, aliases.members);
      const avg = findCol(headers, aliases.average);
      if (d >= 0 && dist >= 0 && mem >= 0) {
        headerRow = r;
        dateCol = d + 1;
        remarksCol = rem >= 0 ? rem + 1 : -1;
        priceCol = p >= 0 ? p + 1 : -1;
        distanceCol = dist + 1;
        membersCol = mem + 1;
        averageCol = avg >= 0 ? avg + 1 : -1;
        break;
      }
    }

    if (dateCol < 0 || distanceCol < 0 || membersCol < 0) {
      continue;
    }

    for (let r = headerRow + 1; r <= lastRow; r++) {
      const rawDateCell = sheet.cell(r, dateCol);
      const rawDate = rawDateCell.value();
      const rawDateText = String(rawDateCell.text ? rawDateCell.text() : '').trim();
      const rawDistance = sheet.cell(r, distanceCol).value();
      const rawMembers = sheet.cell(r, membersCol).value();

      const entryDate = parseExcelDate(rawDateText || rawDate);
      const distanceKm = parseFloat(String(rawDistance ?? '').replace(/[^0-9.-]/g, ''));
      const members = String(rawMembers || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const hasAnyData = String(rawDateText || rawDate || '').trim() || String(rawDistance || '').trim() || String(rawMembers || '').trim();
      if (!hasAnyData) continue;

      if (!entryDate || !(distanceKm >= 0) || !members) {
        skipped++;
        continue;
      }

      const remarks = remarksCol > 0 ? String(sheet.cell(r, remarksCol).value() || '').trim() : '';
      const rawPrice = priceCol > 0 ? sheet.cell(r, priceCol).value() : '';
      const rawAverage = averageCol > 0 ? sheet.cell(r, averageCol).value() : '';
      const petrolPrice = parseFloat(String(rawPrice ?? '').replace(/[^0-9.-]/g, ''));
      const averageKmpl = parseFloat(String(rawAverage ?? '').replace(/[^0-9.-]/g, ''));

      rows.push({
        source_row: r,
        source_sheet: sheetName,
        entry_date: entryDate,
        remarks,
        petrol_price: Number.isFinite(petrolPrice) ? petrolPrice : null,
        distance_km: distanceKm,
        average_kmpl: Number.isFinite(averageKmpl) ? averageKmpl : null,
        members,
      });
    }
  }

  return { rows, skipped };
}

function aiAnswerFromSummary(question, summary, currentUser) {
  const q = String(question || '').trim();
  const normalized = q.toLowerCase();
  const tokens = aiTokens(q);
  const asksAboutExpense = aiHasAnyToken(tokens, ['expense', 'expenses', 'spend', 'spent', 'spending']);
  const asksAboutPetrol = aiHasAnyToken(tokens, ['petrol', 'fuel', 'diesel', 'kmpl', 'mileage', 'litre', 'litres', 'liter', 'liters']);
  const asksAboutItem = aiHasAnyToken(tokens, ['item', 'items', 'thing', 'things', 'stuff', 'purchase', 'purchases']);
  const asksAboutExpensive = aiHasAnyToken(tokens, ['expensive', 'costly', 'costliest']);
  const asksAboutYear = aiHasAnyToken(tokens, ['year', 'years']);
  const asksAboutTop = aiHasAnyToken(tokens, ['top', 'highest', 'largest', 'most', 'max']);
  const currentMonth = summary?.current_month || '';
  const year = aiExtractYear(q, currentMonth);
  const expenseYears = Array.isArray(summary?.expense_by_year) ? summary.expense_by_year : [];
  const yearRow = expenseYears.find((row) => String(row.year) === String(year));
  const friends = Array.isArray(summary?.friends_loan_summary) ? summary.friends_loan_summary : [];
  const emis = Array.isArray(summary?.emis) ? summary.emis : [];
  const cards = Array.isArray(summary?.credit_cards) ? summary.credit_cards : [];
  const trips = Array.isArray(summary?.active_trips) ? summary.active_trips : [];
  const recurring = Array.isArray(summary?.recurring_defaults) ? summary.recurring_defaults : [];
  const planner = Array.isArray(summary?.current_month_planner) ? summary.current_month_planner : [];
  const banks = Array.isArray(summary?.bank_accounts) ? summary.bank_accounts : [];
  const monthKey = aiExtractMonthKey(q, summary);
  const dateKey = aiExtractDateKey(q, summary);
  const dayRow = aiFindDayRow(summary, dateKey);
  const monthRow = aiFindMonthRow(summary, monthKey);
  const previousMonthKey = monthKey ? aiMonthShift(monthKey, -1) : aiMonthShift(currentMonth, -1);
  const previousMonthRow = aiFindMonthRow(summary, previousMonthKey);
  const namedFriend = aiFindFriendByName(summary, q);
  const categoryRow = aiFindCategoryRow(summary, q);
  const namedTrip = aiFindTrip(summary, q);
  const namedCard = aiFindCard(summary, q);
  const recentExpenses = Array.isArray(summary?.recent_expenses) ? summary.recent_expenses : [];
  const petrolDayRow = aiFindPetrolDayRow(summary, dateKey);
  const petrolMonthRow = aiFindPetrolMonthRow(summary, monthKey);
  const petrolRecentEntries = Array.isArray(summary?.petrol_recent_entries) ? summary.petrol_recent_entries : [];
  const dailyTrackers = Array.isArray(summary?.daily_trackers) ? summary.daily_trackers : [];
  const habitTrackers = Array.isArray(summary?.habit_trackers) ? summary.habit_trackers : [];
  const liveSplitBalances = Array.isArray(summary?.live_split_balances) ? summary.live_split_balances : [];
  const today = summary?.as_of || new Date().toISOString().slice(0, 10);
  const todayExpenses = recentExpenses.filter((row) => aiDateKeyValue(row?.purchase_date) === aiDateKeyValue(today));
  const dayExpenses = dateKey ? recentExpenses.filter((row) => aiDateKeyValue(row?.purchase_date) === aiDateKeyValue(dateKey)) : [];
  const dayPetrolEntries = dateKey ? petrolRecentEntries.filter((row) => aiDateKeyValue(row?.entry_date) === aiDateKeyValue(dateKey)) : [];

  if (asksAboutPetrol && dateKey) {
    if (!petrolDayRow) return `You do not have any saved petrol divide entries for ${aiDateLabel(dateKey)}.`;
    return aiLines([
      `Your petrol divide totals for ${aiDateLabel(dateKey)} are ${Number(petrolDayRow.total_litres || 0).toFixed(2)} litre(s) and ${aiCurrency(summary, currentUser, petrolDayRow.total_amount)} across ${Number(petrolDayRow.entry_count) || 0} entry(s).`,
      ...dayPetrolEntries.slice(0, 5).map((row) => `- ${row.remarks || 'Petrol entry'}: ${Number(row.petrol_used_litre || 0).toFixed(2)} L, ${aiCurrency(summary, currentUser, row.amount_used)}${row.distance_km ? ` for ${Number(row.distance_km).toFixed(2)} km` : ''}`),
    ]);
  }

  if (asksAboutPetrol && monthKey) {
    if (!petrolMonthRow) return `You do not have any saved petrol divide totals for ${aiMonthLabel(monthKey)}.`;
    return aiLines([
      `Your petrol divide totals for ${aiMonthLabel(monthKey)} are ${Number(petrolMonthRow.total_litres || 0).toFixed(2)} litre(s) and ${aiCurrency(summary, currentUser, petrolMonthRow.total_amount)} across ${Number(petrolMonthRow.entry_count || 0)} entry(s).`,
      petrolMonthRow.total_distance_km ? `Total distance: ${Number(petrolMonthRow.total_distance_km || 0).toFixed(2)} km.` : '',
      petrolMonthRow.petrol_price ? `Petrol price: ${aiCurrency(summary, currentUser, petrolMonthRow.petrol_price)} per litre.` : '',
    ]);
  }

  if (asksAboutExpense && dateKey && dateKey !== today) {
    if (!dayRow) return `You do not have any saved expenses for ${aiDateLabel(dateKey)}.`;
    return aiLines([
      `Your total expenses for ${aiDateLabel(dateKey)} are ${aiCurrency(summary, currentUser, dayRow.total)} across ${Number(dayRow.count) || 0} transaction(s).`,
      ...dayExpenses.slice(0, 5).map((row) => `- ${row.item_name}: ${aiCurrency(summary, currentUser, row.amount)}${row.is_extra ? ' (extra)' : ''}`),
    ]);
  }

  if (asksAboutExpense && (normalized.includes('today') || tokens.includes('today'))) {
    if (!todayExpenses.length) return `You do not have any saved expenses for ${today}.`;
    const todayTotal = todayExpenses.reduce((sum, row) => sum + aiNum(row.amount), 0);
    return aiLines([
      `Your total expenses for ${today} are ${aiCurrency(summary, currentUser, todayTotal)} across ${todayExpenses.length} transaction(s).`,
      ...todayExpenses.slice(0, 5).map((row) => `- ${row.item_name}: ${aiCurrency(summary, currentUser, row.amount)}${row.is_extra ? ' (extra)' : ''}`),
    ]);
  }

  if ((normalized.includes('last 3 month') || normalized.includes('last three month')) && (normalized.includes('expense') || normalized.includes('spent'))) {
    const total = aiRecentMonthsTotal(summary, 3);
    const recentMonths = (Array.isArray(summary?.expense_last_6_months) ? summary.expense_last_6_months : []).slice(0, 3);
    if (!recentMonths.length) return 'I do not have expense totals for the last 3 months yet.';
    return aiLines([
      `Your total spending across the last 3 recorded months is ${aiCurrency(summary, currentUser, total)}.`,
      ...recentMonths.map((row) => `- ${aiMonthLabel(row.month)}: ${aiCurrency(summary, currentUser, row.total)}`),
    ]);
  }

  if ((normalized.includes('last 6 month') || normalized.includes('last six month')) && (normalized.includes('expense') || normalized.includes('spent'))) {
    const rows = Array.isArray(summary?.expense_last_6_months) ? summary.expense_last_6_months : [];
    if (!rows.length) return 'I do not have expense totals for the last 6 months yet.';
    const total = rows.reduce((sum, row) => sum + aiNum(row.total), 0);
    return aiLines([
      `Your total spending across the last 6 recorded months is ${aiCurrency(summary, currentUser, total)}.`,
      ...rows.map((row) => `- ${aiMonthLabel(row.month)}: ${aiCurrency(summary, currentUser, row.total)}`),
    ]);
  }

  if ((normalized.includes('recent expense') || normalized.includes('recent transaction') || normalized.includes('latest expense') || normalized.includes('latest transaction') || normalized.includes('last expense')) && recentExpenses.length) {
    return aiLines([
      'Your recent expenses:',
      ...recentExpenses.slice(0, 5).map((row) => `- ${row.item_name} on ${row.purchase_date}: ${aiCurrency(summary, currentUser, row.amount)}${row.is_extra ? ' (extra)' : ''}`),
    ]);
  }

  if (normalized.includes('biggest expense') || normalized.includes('highest expense') || normalized.includes('largest expense') || normalized.includes('top expenses') || ((asksAboutExpense || asksAboutItem) && (asksAboutExpensive || asksAboutTop))) {
    const sortedRecent = [...recentExpenses].sort((a, b) => aiNum(b.amount) - aiNum(a.amount));
    if (!sortedRecent.length) return 'I could not find any recent expenses yet.';
    if (normalized.includes('top expenses') || (asksAboutTop && (asksAboutExpense || asksAboutItem))) {
      return aiLines([
        'Your highest recent expenses:',
        ...sortedRecent.slice(0, 5).map((row) => `- ${row.item_name}: ${aiCurrency(summary, currentUser, row.amount)} on ${row.purchase_date}${row.is_extra ? ' (extra)' : ''}`),
      ]);
    }
    const biggest = sortedRecent[0];
    return `Your biggest recent expense is ${biggest.item_name} on ${biggest.purchase_date} for ${aiCurrency(summary, currentUser, biggest.amount)}${biggest.is_extra ? ' and it was marked as extra.' : '.'}`;
  }

  if (asksAboutExpense && asksAboutYear && asksAboutTop) {
    const topYear = aiTopExpenseYear(summary);
    if (!topYear) return 'I could not find any yearly expense totals yet.';
    return `You spent the most in ${topYear.year}, with total expenses of ${aiCurrency(summary, currentUser, topYear.total)}.`;
  }

  if ((normalized.includes('month') || monthKey) && (normalized.includes('expense') || normalized.includes('spent')) && monthRow) {
    return `Your total expenses for ${aiMonthLabel(monthKey)} are ${aiCurrency(summary, currentUser, monthRow.total)} across ${Number(monthRow.count) || 0} transaction(s).`;
  }

  if ((normalized.includes('compare') || normalized.includes('vs') || normalized.includes('versus')) && (normalized.includes('month') || normalized.includes('spent') || normalized.includes('expense'))) {
    const currentCompareRow = monthRow || aiFindMonthRow(summary, currentMonth);
    const previousCompareRow = previousMonthRow || aiFindMonthRow(summary, aiMonthShift((monthKey || currentMonth), -1));
    if (currentCompareRow && previousCompareRow) {
      const diff = aiNum(currentCompareRow.total) - aiNum(previousCompareRow.total);
      const direction = diff > 0.005 ? 'higher' : diff < -0.005 ? 'lower' : 'the same';
      return aiLines([
        `${aiMonthLabel(currentCompareRow.month)}: ${aiCurrency(summary, currentUser, currentCompareRow.total)}.`,
        `${aiMonthLabel(previousCompareRow.month)}: ${aiCurrency(summary, currentUser, previousCompareRow.total)}.`,
        direction === 'the same'
          ? 'Your spending was the same across both months.'
          : `Your spending in ${aiMonthLabel(currentCompareRow.month)} was ${aiCurrency(summary, currentUser, Math.abs(diff))} ${direction} than ${aiMonthLabel(previousCompareRow.month)}.`,
      ]);
    }
  }

  if (categoryRow && (normalized.includes('category') || normalized.includes('spent') || normalized.includes('expense'))) {
    return `Your total spending in category "${categoryRow.category}" is ${aiCurrency(summary, currentUser, categoryRow.total)} across ${Number(categoryRow.count) || 0} transaction(s).`;
  }

  if (normalized.includes('top category') || normalized.includes('highest category') || normalized.includes('most spent category') || (asksAboutTop && aiHasAnyToken(tokens, ['category', 'categories']) && asksAboutExpense)) {
    const categories = Array.isArray(summary?.expense_by_category) ? summary.expense_by_category : [];
    const topCategory = categories[0];
    if (!topCategory) return 'No expense categories are available yet.';
    return `Your top spending category is "${topCategory.category}" with ${aiCurrency(summary, currentUser, topCategory.total)} across ${Number(topCategory.count) || 0} transaction(s).`;
  }

  if (namedFriend && (normalized.includes('friend') || normalized.includes('owe') || normalized.includes('balance') || normalized.includes('loan'))) {
    const net = aiNum(namedFriend.net_balance);
    if (net > 0.005) return `${namedFriend.name} owes you ${aiCurrency(summary, currentUser, net)}.`;
    if (net < -0.005) return `You owe ${namedFriend.name} ${aiCurrency(summary, currentUser, Math.abs(net))}.`;
    return `You and ${namedFriend.name} are settled right now.`;
  }

  if (namedTrip && (normalized.includes('trip') || normalized.includes('spent') || normalized.includes('expense'))) {
    return aiLines([
      `Trip "${namedTrip.name}" has ${namedTrip.status || 'unknown'} status.`,
      `Total recorded trip expense: ${aiCurrency(summary, currentUser, namedTrip.total_amount)}.`,
      `${Number(namedTrip.expense_count) || 0} expense item(s) are saved for it.`,
    ]);
  }

  if (normalized.includes('trip') && (normalized.includes('total') || normalized.includes('active'))) {
    if (!trips.length) return 'You do not have any saved trips right now.';
    return aiLines([
      'Recent trips:',
      ...trips.map((row) => `- ${row.name}: ${aiCurrency(summary, currentUser, row.total_amount)} across ${Number(row.expense_count) || 0} expense item(s), status ${row.status}`),
    ]);
  }

  if (namedCard && (normalized.includes('card') || normalized.includes('credit') || normalized.includes('limit') || normalized.includes('spent') || normalized.includes('due'))) {
    const due = aiNum(namedCard?.current_cycle?.net_payable);
    const spent = aiNum(namedCard?.current_cycle?.total_spent);
    const limit = aiNum(namedCard.credit_limit);
    if (!namedCard.current_cycle) {
      return aiLines([
        `${namedCard.card_name} (${namedCard.bank_name} ending ${namedCard.last4}) does not have a current cycle summary yet.`,
        `Credit limit: ${aiCurrency(summary, currentUser, limit)}.`,
      ]);
    }
    return aiLines([
      `${namedCard.card_name} (${namedCard.bank_name} ending ${namedCard.last4}) current cycle spent: ${aiCurrency(summary, currentUser, spent)}.`,
      `Current due: ${aiCurrency(summary, currentUser, due)}.`,
      `Credit limit: ${aiCurrency(summary, currentUser, limit)}.`,
      `${namedCard.current_cycle?.due_date ? `Due date: ${namedCard.current_cycle.due_date}.` : ''}`,
    ]);
  }

  if ((normalized.includes('total expense') || normalized.includes('total spend') || normalized.includes('spent this year') || normalized.includes('expense this year')) && yearRow) {
    return aiLines([
      `Your total expenses for ${year} are ${aiCurrency(summary, currentUser, yearRow.total)}.`,
      `Fair spending: ${aiCurrency(summary, currentUser, yearRow.fair)}.`,
      `Extra spending: ${aiCurrency(summary, currentUser, yearRow.extra)}.`,
      `${Number(yearRow.count) || 0} transaction(s) were recorded.`,
    ]);
  }

  if ((normalized.includes('fair') || normalized.includes('regular')) && normalized.includes('expense') && yearRow) {
    return `Your fair expenses for ${year} are ${aiCurrency(summary, currentUser, yearRow.fair)}.`;
  }

  if (normalized.includes('extra') && normalized.includes('expense') && yearRow) {
    return `Your extra expenses for ${year} are ${aiCurrency(summary, currentUser, yearRow.extra)}.`;
  }

  if (normalized.includes('owes me') || normalized.includes('who owes me') || normalized.includes('loan balance')) {
    const owesYou = friends.filter((row) => aiNum(row.net_balance) > 0.005);
    if (!owesYou.length) return 'No friends currently owe you money based on the saved loan transactions.';
    return aiLines([
      'These friends currently owe you money:',
      ...owesYou.sort((a, b) => aiNum(b.net_balance) - aiNum(a.net_balance)).map((row) => `- ${row.name}: ${aiCurrency(summary, currentUser, row.net_balance)}`),
    ]);
  }

  if (normalized.includes('i owe') || normalized.includes('do i owe')) {
    const youOwe = friends.filter((row) => aiNum(row.net_balance) < -0.005);
    if (!youOwe.length) return 'You do not currently owe money to any friend based on the saved loan transactions.';
    return aiLines([
      'You currently owe these friends:',
      ...youOwe.sort((a, b) => aiNum(a.net_balance) - aiNum(b.net_balance)).map((row) => `- ${row.name}: ${aiCurrency(summary, currentUser, Math.abs(aiNum(row.net_balance)))}`),
    ]);
  }

  if ((normalized.includes('emi') || normalized.includes('loan')) && (normalized.includes('active') || normalized.includes('which emi') || normalized.includes('what emi'))) {
    const activeEmis = emis.filter((row) => ['active', 'pending'].includes(String(row.status || '').toLowerCase()));
    if (!activeEmis.length) return 'You do not have any active EMI records right now.';
    return aiLines([
      'Active EMI records:',
      ...activeEmis.map((row) => `- ${row.name}: ${aiCurrency(summary, currentUser, row.monthly_emi)} per month, remaining ${aiCurrency(summary, currentUser, row.remaining_amount)}, paid ${Number(row.paid_count) || 0}/${Number(row.total_installments) || 0}`),
    ]);
  }

  if ((normalized.includes('credit card') || normalized.includes('card due') || normalized.includes('cards due')) && (normalized.includes('due') || normalized.includes('payable') || normalized.includes('this month'))) {
    const openCards = cards.filter((row) => aiNum(row?.current_cycle?.net_payable) > 0.005);
    if (!openCards.length) return `You do not have any credit card dues for ${aiMonthLabel(currentMonth)}.`;
    const totalDue = openCards.reduce((sum, row) => sum + aiNum(row.current_cycle.net_payable), 0);
    return aiLines([
      `Your total credit card due for ${aiMonthLabel(currentMonth)} is ${aiCurrency(summary, currentUser, totalDue)}.`,
      ...openCards.map((row) => `- ${row.card_name} (${row.bank_name} ending ${row.last4}): ${aiCurrency(summary, currentUser, row.current_cycle.net_payable)} due ${row.current_cycle?.due_date || ''}`.trim()),
    ]);
  }

  if (normalized.includes('recurring') || normalized.includes('monthly payments') || normalized.includes('default payments')) {
    if (!recurring.length && !planner.length) return 'You do not have any recurring or default monthly payments saved right now.';
    return aiLines([
      recurring.length ? 'Recurring defaults:' : '',
      ...recurring.map((row) => `- ${row.name}: ${aiCurrency(summary, currentUser, row.amount)}${row.due_day ? ` on day ${row.due_day}` : ''}${row.category ? ` (${row.category})` : ''}`),
      recurring.length && planner.length ? '' : '',
      planner.length ? `Planner items for ${aiMonthLabel(currentMonth)}:` : '',
      ...planner.map((row) => `- ${row.name}: ${aiCurrency(summary, currentUser, row.amount)} due ${row.due_date || ''}`.trim()),
    ]);
  }

  if (normalized.includes('bank') && (normalized.includes('balance') || normalized.includes('balances') || normalized.includes('spendable'))) {
    if (!banks.length) return 'No bank accounts are saved yet.';
    return aiLines([
      `Total bank balance: ${aiCurrency(summary, currentUser, summary.total_bank_balance)}.`,
      `Total spendable balance: ${aiCurrency(summary, currentUser, summary.total_spendable)}.`,
      'Bank accounts:',
      ...banks.map((row) => `- ${row.bank_name}${row.account_name ? ` - ${row.account_name}` : ''}: balance ${aiCurrency(summary, currentUser, row.balance)}, minimum ${aiCurrency(summary, currentUser, row.min_balance || 0)}`),
    ]);
  }

  if (normalized.includes('summary') || normalized.includes('overview') || normalized.includes('financial overview') || aiHasAllTokens(tokens, ['financial', 'status'])) {
    const topYear = aiTopExpenseYear(summary);
    return aiLines([
      `As of ${summary?.as_of || 'today'}, your total bank balance is ${aiCurrency(summary, currentUser, summary.total_bank_balance)} and spendable balance is ${aiCurrency(summary, currentUser, summary.total_spendable)}.`,
      topYear ? `Your highest recorded expense year is ${topYear.year} with ${aiCurrency(summary, currentUser, topYear.total)} spent.` : '',
      `You have ${emis.filter((row) => ['active', 'pending'].includes(String(row.status || '').toLowerCase())).length} active or pending EMI record(s).`,
      `You have ${cards.filter((row) => aiNum(row?.current_cycle?.net_payable) > 0.005).length} credit card(s) with dues in ${aiMonthLabel(currentMonth)}.`,
      `You have ${friends.filter((row) => aiNum(row.net_balance) > 0.005).length} friend balance(s) where money is owed to you.`,
    ]);
  }

  if ((normalized.includes('tracker') || normalized.includes('daily tracker')) && dailyTrackers.length) {
    return aiLines([
      `Daily tracker snapshot for ${aiMonthLabel(currentMonth)}:`,
      ...dailyTrackers.slice(0, 8).map((row) => `- ${row.name}: ${aiCurrency(summary, currentUser, row.current_month_total)} across ${Number(row.current_month_days || 0)} day(s)`),
    ]);
  }

  if ((normalized.includes('habit') || normalized.includes('streak')) && habitTrackers.length) {
    return aiLines([
      `Habit tracker snapshot for ${aiMonthLabel(currentMonth)}:`,
      ...habitTrackers.slice(0, 8).map((row) => `- ${row.name}: ${Number(row.month_one_days || 0)}/${Number(row.month_total_days || 0)} days (${Number(row.month_percent || 0).toFixed(2)}%)`),
    ]);
  }

  if ((normalized.includes('live split') || normalized.includes('livesplit')) && liveSplitBalances.length) {
    return aiLines([
      'Live Split balances:',
      ...liveSplitBalances.slice(0, 8).map((row) => Number(row.amount || 0) > 0
        ? `- ${row.name} owes you ${aiCurrency(summary, currentUser, row.amount)}`
        : `- You owe ${row.name} ${aiCurrency(summary, currentUser, Math.abs(Number(row.amount || 0)))}`),
    ]);
  }

  return aiLines([
    'I can answer structured questions across expenses, petrol divide, live split, trackers, habits, friend balances, active EMIs, credit card dues, recurring payments, planner items, banks, and trips.',
    'Try asking things like:',
    '- What is my total expense this year?',
    '- How much petrol used and amount on 9 May 2026?',
    '- Show my daily tracker totals this month',
    '- Show my habit progress this month',
    '- Who owes me money?',
    '- Which EMIs are active?',
    '- How much is my credit card due this month?',
    '- Show my bank account balances',
    '- Show my recent transactions',
    '- What are my top expenses?',
  ]);
}

router.get('/ai/lookup/status', (req, res) => {
  Promise.resolve(getOpsDb().getAiLookupStatus(req.session.userId)).then((status) => {
    res.json({
      success: true,
      ...enrichAiLookupStatus(status),
    });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

router.get('/ai/lookup/history', (req, res) => {
  const limit = Number(req.query.limit || 30);
  Promise.resolve(getOpsDb().getAiQueryHistory(req.session.userId, limit)).then((history) => {
    res.json({ success: true, history });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

router.post('/ai/lookup', async (req, res) => {
  try {
    const { question, history, mode } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });
    const lookupMode = String(mode || 'offline').toLowerCase() === 'online' ? 'online' : 'offline';

    const aiStatus = enrichAiLookupStatus(await Promise.resolve(getOpsDb().getAiLookupStatus(req.session.userId)));
    if (!aiStatus?.modes?.[lookupMode]) {
      return res.status(403).json({
        error: lookupMode === 'online'
          ? 'Online AI Lookup is not included in your current plan.'
          : 'Offline AI Lookup is not included in your current plan.',
        ai_status: aiStatus,
      });
    }
    if (!aiStatus.canAsk) {
      return res.status(402).json({
        error: `You have used all ${aiStatus.dailyFreeLimit} free AI lookups for today. Buy a paid plan for more queries.`,
        ai_status: aiStatus,
      });
    }

    let [summary, currentUser] = await Promise.all([
      Promise.resolve(getFinanceDb().getUserFinancialSummary(req.session.userId)),
      Promise.resolve(pgDb.findUserById(req.session.userId)),
    ]);
    const requestedDateKey = aiExtractDateKey(question, summary);
    if (requestedDateKey) {
      summary = await ensureAiSummaryForDate(req.session.userId, summary, requestedDateKey);
    }
    summary = await enrichAiSummaryWithModules(req.session.userId, summary, question);

    const normalizedQuestion = aiNormalizeQuestion(question);
    const trainedAnswer = lookupMode === 'online'
      ? null
      : await Promise.resolve(getOpsDb().findAiTrainingExample(normalizedQuestion));
    if (trainedAnswer?.ideal_answer) {
      await Promise.resolve(getOpsDb().logAiLookupQuery(req.session.userId, {
        question,
        normalized_question: normalizedQuestion,
        detected_intent: trainedAnswer.detected_intent || 'trained_answer',
        answer_type: 'admin_trained_answer',
        was_fallback: false,
        response_preview: trainedAnswer.ideal_answer,
      }));
      const nextStatus = enrichAiLookupStatus(await Promise.resolve(getOpsDb().recordAiLookupUsage(req.session.userId)));
      return res.json({
        success: true,
        answer: trainedAnswer.ideal_answer,
        ai_status: nextStatus,
        lookup_mode: lookupMode,
        ai_meta: {
          detected_intent: trainedAnswer.detected_intent || 'trained_answer',
          detected_confidence: 1,
          resolved_intent: trainedAnswer.detected_intent || 'trained_answer',
          resolved_confidence: 1,
          resolution_method: 'admin_training_store',
          learned_match: null,
          answer_type: 'admin_trained_answer',
          provider: 'training',
        },
      });
    }

    const detectedResolution = aiResolveIntent(question, summary);
    const detectedIntent = detectedResolution.intent;
    const groundedAnswer = aiAnswerFromSummary(question, summary, currentUser);
    if (lookupMode === 'online') {
      const online = await askAiLookupWithOpenAi(question, history, summary, currentUser, groundedAnswer);
      await Promise.resolve(getOpsDb().logAiLookupQuery(req.session.userId, {
        question,
        normalized_question: normalizedQuestion,
        detected_intent: detectedIntent,
        answer_type: 'openai_online',
        was_fallback: false,
        response_preview: online.answer,
      }));
      const nextStatus = enrichAiLookupStatus(await Promise.resolve(getOpsDb().recordAiLookupUsage(req.session.userId)));
      return res.json({
        success: true,
        answer: online.answer,
        ai_status: nextStatus,
        lookup_mode: lookupMode,
        ai_meta: {
          detected_intent: detectedIntent,
          detected_confidence: Number(detectedResolution.confidence || 0),
          resolved_intent: detectedIntent,
          resolved_confidence: Number(detectedResolution.confidence || 0),
          resolution_method: 'openai_online',
          learned_match: null,
          answer_type: 'openai_online',
          provider: 'openai',
          model: online.model,
        },
      });
    }

    let resolvedIntent = detectedIntent;
    let learnedMatch = null;
    let questionForAnswer = question;
    let resolvedConfidence = Number(detectedResolution.confidence || 0);
    let resolutionMethod = detectedResolution.method || 'concept_rule';

    if (resolvedIntent === 'unknown') {
      const examples = await Promise.resolve(getOpsDb().getAiIntentLearningExamples(400));
      learnedMatch = aiInferIntentFromExamples(question, examples);
      if (learnedMatch?.intent) {
        resolvedIntent = learnedMatch.intent;
        questionForAnswer = aiCanonicalQuestionForIntent(resolvedIntent, question);
        resolvedConfidence = Number(learnedMatch.score || 0);
        resolutionMethod = learnedMatch.method || 'similar_log_match';
      }
    }

    const answer = questionForAnswer === question ? groundedAnswer : aiAnswerFromSummary(questionForAnswer, summary, currentUser);
    const wasFallback = aiIsFallbackAnswer(answer);
    const answerType = learnedMatch?.intent && !wasFallback ? 'learned_rule' : (wasFallback ? 'fallback' : 'structured_rule');
    await Promise.resolve(getOpsDb().logAiLookupQuery(req.session.userId, {
      question,
      normalized_question: normalizedQuestion,
      detected_intent: wasFallback ? detectedIntent : resolvedIntent,
      answer_type: answerType,
      was_fallback: wasFallback,
      response_preview: answer,
    }));
    const nextStatus = enrichAiLookupStatus(await Promise.resolve(getOpsDb().recordAiLookupUsage(req.session.userId)));
    res.json({
      success: true,
      answer,
      ai_status: nextStatus,
      lookup_mode: lookupMode,
      ai_meta: {
        detected_intent: detectedIntent,
        detected_confidence: Number(detectedResolution.confidence || 0),
        resolved_intent: wasFallback ? detectedIntent : resolvedIntent,
        resolved_confidence: wasFallback ? Number(detectedResolution.confidence || 0) : resolvedConfidence,
        resolution_method: wasFallback ? (detectedResolution.method || 'unknown') : resolutionMethod,
        learned_match: learnedMatch ? {
          method: learnedMatch.method,
          score: learnedMatch.score,
          example: learnedMatch.example,
        } : null,
        answer_type: answerType,
        provider: 'offline',
      },
    });
  } catch (err) {
    console.error('[AI lookup]', err.message);
    res.status(500).json({ error: err.message });
  }
});
// ─── DAILY TRACKERS ──────────────────────────────────────────
const HABIT_IMPORT_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function detectHabitImportHeader(sheet) {
  const usedRange = sheet.usedRange();
  if (!usedRange) return null;
  const lastCol = Math.min(24, usedRange.endCell().columnNumber());
  let best = null;
  for (let row = 1; row <= Math.min(8, usedRange.endCell().rowNumber()); row++) {
    const monthCols = [];
    for (let col = 1; col <= lastCol; col++) {
      const normalized = normalizeExcelHeader(sheet.cell(row, col).value());
      const monthIndex = HABIT_IMPORT_MONTHS.indexOf(normalized);
      if (monthIndex >= 0) monthCols.push({ month: monthIndex + 1, col });
    }
    if (monthCols.length >= 3 && (!best || monthCols.length > best.monthCols.length)) best = { row, monthCols };
  }
  return best;
}

function detectHabitImportYear(sheet, headerRow) {
  const usedRange = sheet.usedRange();
  if (!usedRange) return { year: null, explicit: false };
  for (let row = Math.max(1, headerRow - 1); row <= headerRow; row++) {
    for (let col = 1; col <= Math.min(24, usedRange.endCell().columnNumber()); col++) {
      const raw = sheet.cell(row, col).value();
      const match = String(raw == null ? '' : raw).match(/\b(20\d{2})\b/);
      if (match) return { year: Number(match[1]), explicit: true };
      const num = Number(raw);
      if (Number.isInteger(num) && num >= 2000 && num <= 2100) return { year: num, explicit: true };
    }
  }
  return { year: null, explicit: false };
}

function parseHabitImportCellValue(value) {
  if (value == null || value === '') return 0;
  const normalized = String(value).trim();
  if (!normalized) return 0;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return 0;
  return numeric >= 1 ? 1 : 0;
}

async function parseHabitTrackerExcelBuffer(buffer, password, importYear) {
  const opts = password ? { password } : {};
  const wb = await XlsxPopulate.fromDataAsync(buffer, opts);
  const requestedYear = Number(importYear);
  const hasYearOverride = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100;
  const fallbackYear = hasYearOverride ? requestedYear : new Date().getFullYear();
  const candidates = [];
  for (const sheet of wb.sheets()) {
    const header = detectHabitImportHeader(sheet);
    if (!header) continue;
    const yearInfo = detectHabitImportYear(sheet, header.row);
    const year = hasYearOverride ? requestedYear : (yearInfo.year || fallbackYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) continue;
    const entriesMap = new Map();
    const monthMap = new Map();
    let nonBlankCells = 0;
    for (const item of header.monthCols) {
      const totalDays = new Date(year, item.month, 0).getDate();
      let oneDays = 0;
      for (let day = 1; day <= totalDays; day++) {
        const rawValue = sheet.cell(header.row + day, item.col).value();
        if (rawValue != null && String(rawValue).trim() !== '') nonBlankCells++;
        const entryValue = parseHabitImportCellValue(rawValue);
        const entryDate = `${year}-${String(item.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        entriesMap.set(entryDate, entryValue);
        if (entryValue === 1) oneDays++;
      }
      monthMap.set(`${year}-${String(item.month).padStart(2, '0')}`, {
        year,
        month: item.month,
        one_days: oneDays,
        total_days: totalDays,
        percent: totalDays ? Math.round((oneDays / totalDays) * 10000) / 100 : 0,
      });
    }
    candidates.push({
      sheetName: typeof sheet.name === 'function' ? sheet.name() : String(sheet.name || ''),
      year,
      explicitYear: !!yearInfo.explicit,
      monthCount: header.monthCols.length,
      nonBlankCells,
      months: [...monthMap.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month)),
      entries: [...entriesMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([entry_date, entry_value]) => ({ entry_date, entry_value })),
    });
  }
  if (!candidates.length) throw new Error('Could not find month columns like January to December in the workbook');
  candidates.sort((a, b) => {
    if (b.nonBlankCells !== a.nonBlankCells) return b.nonBlankCells - a.nonBlankCells;
    if (b.monthCount !== a.monthCount) return b.monthCount - a.monthCount;
    if (Number(b.explicitYear) !== Number(a.explicitYear)) return Number(b.explicitYear) - Number(a.explicitYear);
    return a.sheetName.localeCompare(b.sheetName);
  });
  const selected = candidates[0];
  const months = selected.months;
  if (!months.length) throw new Error('Could not find month columns like January to December in the workbook');
  const entries = selected.entries;
  const yearGroups = new Map();
  months.forEach((month) => {
    if (!yearGroups.has(month.year)) yearGroups.set(month.year, { one_days: 0, total_days: 0 });
    const bucket = yearGroups.get(month.year);
    bucket.one_days += month.one_days;
    bucket.total_days += month.total_days;
  });
  const years = [...yearGroups.entries()].map(([year, totals]) => ({
    year,
    one_days: totals.one_days,
    total_days: totals.total_days,
    percent: totals.total_days ? Math.round((totals.one_days / totals.total_days) * 10000) / 100 : 0,
  })).sort((a, b) => a.year - b.year);
  return { entries, months, years, count: entries.length, sheet_name: selected.sheetName, year: selected.year };
}

router.get('/trackers', (req, res) => {
  Promise.resolve(getOpsDb().getDailyTrackers(req.session.userId)).then((trackers) => {
    res.json({ trackers });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/trackers', (req, res) => {
  try {
    const { name, unit, price_per_unit, default_qty, is_active, auto_add_to_expense, expense_bank_account_id, expense_category } = req.body;
    if (!name || !price_per_unit) return res.status(400).json({ error: 'Missing required fields' });
    Promise.resolve(getOpsDb().addDailyTracker(req.session.userId, {
      name,
      unit,
      price_per_unit,
      default_qty,
      is_active,
      auto_add_to_expense,
      expense_bank_account_id,
      expense_category,
    })).then((id) => {
      res.json({ success: true, id });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/trackers/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateDailyTracker(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.delete('/trackers/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteDailyTracker(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/trackers/:id/entries', (req, res) => {
  try {
    const { year, month } = req.query;
    Promise.resolve(getOpsDb().getDailyEntries(req.session.userId, req.params.id, year, month)).then((entries) => {
      res.json({ entries });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trackers/:id/entries', (req, res) => {
  try {
    const { date, qty, is_auto } = req.body;
    if (!date || qty == null) return res.status(400).json({ error: 'Missing date or qty' });
    Promise.resolve(getOpsDb().upsertDailyEntry(req.session.userId, req.params.id, date, qty, is_auto ? 1 : 0)).then((r) => {
      res.json({ success: true, amount: r.amount });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trackers/:id/autofill', (req, res) => {
  try {
    const { year, month } = req.body;
    Promise.resolve(getOpsDb().autoFillDailyEntries(req.session.userId, req.params.id, year, month)).then((filled) => {
      res.json({ success: true, filled });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trackers/:id/summary', (req, res) => {
  try {
    const { year, month } = req.query;
    Promise.resolve(getOpsDb().getDailyMonthSummary(req.session.userId, req.params.id, year, month)).then((summary) => {
      res.json({ summary });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trackers/:id/month-expense', (req, res) => {
  try {
    const { year, month, bank_account_id, expense_month, expense_category } = req.body;
    Promise.resolve(getOpsDb().addTrackerMonthToExpense(req.session.userId, req.params.id, year, month, { bank_account_id, expense_month, expense_category })).then((amount) => {
      sendTrackerExpenseAppliedEmailForUser(req.session.userId, req.params.id, Number(year), Number(month), { expense_month }).catch(() => {});
      res.json({ success: true, amount });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── RECURRING ENTRIES ───────────────────────────────────────
router.get('/expense-buckets', (req, res) => {
  Promise.resolve(getOpsDb().getExpenseBuckets(req.session.userId)).then((buckets) => {
    res.json({ buckets });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.post('/expense-buckets', (req, res) => {
  Promise.resolve(getOpsDb().addExpenseBucket(req.session.userId, req.body || {})).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.put('/expense-buckets/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateExpenseBucket(req.session.userId, req.params.id, req.body || {})).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.delete('/expense-buckets/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteExpenseBucket(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.get('/expense-buckets/:id/entries', (req, res) => {
  Promise.resolve(getOpsDb().getExpenseBucketEntries(req.session.userId, req.params.id)).then((entries) => {
    res.json({ entries });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.post('/expense-buckets/:id/entries', (req, res) => {
  Promise.resolve(getOpsDb().addExpenseBucketEntry(req.session.userId, req.params.id, req.body || {})).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.put('/expense-buckets/:id/entries/:entryId', (req, res) => {
  Promise.resolve(getOpsDb().updateExpenseBucketEntry(req.session.userId, req.params.id, req.params.entryId, req.body || {})).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.delete('/expense-buckets/:id/entries/:entryId', (req, res) => {
  Promise.resolve(getOpsDb().deleteExpenseBucketEntry(req.session.userId, req.params.id, req.params.entryId)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.post('/expense-buckets/:id/import-excel/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = parseExpenseBucketImportWorkbook(req.file.buffer, {
      sheet_name: req.body?.sheet_name || '',
      name: req.body?.name || '',
      entry_type: req.body?.entry_type || '',
    });
    res.json({
      success: true,
      count: parsed.rows.length,
      skipped: parsed.skipped,
      sheet_names: parsed.sheet_names,
      preview: parsed.rows.slice(0, 50),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/expense-buckets/:id/import-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const bucketId = Number(req.params.id || 0);
    const parsed = parseExpenseBucketImportWorkbook(req.file.buffer, {
      sheet_name: req.body?.sheet_name || '',
      name: req.body?.name || '',
      entry_type: req.body?.entry_type || '',
    });
    let imported = 0;
    for (const row of parsed.rows) {
      await Promise.resolve(getOpsDb().addExpenseBucketEntry(req.session.userId, bucketId, {
        name: row.name,
        entry_type: row.entry_type,
        entry_date: row.entry_date,
        amount: row.amount,
        auto_add_enabled: 0,
        auto_add_frequency: 'none',
        reminder_enabled: 0,
        reminder_days_before: 0,
        reminder_frequency: 'once',
        reminder_silent: 0,
      }));
      imported += 1;
    }
    res.json({ success: true, imported, skipped: parsed.skipped });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/fixed-deposits', async (req, res) => {
  try {
    const fixedDeposits = await Promise.resolve(getOpsDb().getFixedDeposits(req.session.userId, {
      person_name: req.query?.person_name || '',
      status: req.query?.status || '',
    }));
    const people = [...new Set(fixedDeposits.map((item) => String(item.person_name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const totals = fixedDeposits.reduce((acc, item) => {
      const status = String(item.status || '').toLowerCase();
      acc.amount_deposited += Number(item.amount_deposited || 0);
      acc.maturity_amount += Number(item.maturity_amount || 0);
      acc.interest_amount += Number(item.interest_amount || 0);
      acc.count += 1;
      if (status === 'expired') acc.expired += 1;
      else acc.ongoing += 1;
      return acc;
    }, { amount_deposited: 0, maturity_amount: 0, interest_amount: 0, count: 0, ongoing: 0, expired: 0 });
    res.json({ fixed_deposits: fixedDeposits, people, totals });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/fixed-deposits', async (req, res) => {
  try {
    const id = await Promise.resolve(getOpsDb().addFixedDeposit(req.session.userId, req.body || {}));
    res.json({ success: true, id });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/fixed-deposits/:id', async (req, res) => {
  try {
    await Promise.resolve(getOpsDb().updateFixedDeposit(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/fixed-deposits/:id', async (req, res) => {
  try {
    await Promise.resolve(getOpsDb().deleteFixedDeposit(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/fixed-deposits/import-excel/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = parseFixedDepositImportWorkbook(req.file.buffer, {
      sheet_name: req.body?.sheet_name || '',
      person_name: req.body?.person_name || '',
    });
    res.json({
      success: true,
      count: parsed.rows.length,
      skipped: parsed.skipped,
      sheet_names: parsed.sheet_names,
      preview: parsed.rows.slice(0, 50),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/fixed-deposits/import-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = parseFixedDepositImportWorkbook(req.file.buffer, {
      sheet_name: req.body?.sheet_name || '',
      person_name: req.body?.person_name || '',
    });
    let imported = 0;
    for (const row of parsed.rows) {
      await Promise.resolve(getOpsDb().addFixedDeposit(req.session.userId, row));
      imported += 1;
    }
    res.json({ success: true, imported, skipped: parsed.skipped });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/habit-trackers', (req, res) => {
  try {
    const { year, month } = req.query;
    Promise.resolve(getOpsDb().getHabitTrackers(req.session.userId, year, month)).then((trackers) => {
      res.json({ trackers });
    }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/habit-trackers', (req, res) => {
  try {
    Promise.resolve(getOpsDb().addHabitTracker(req.session.userId, req.body || {})).then((id) => {
      res.json({ success: true, id });
    }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/habit-trackers/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateHabitTracker(req.session.userId, req.params.id, req.body || {})).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.delete('/habit-trackers/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteHabitTracker(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
});

router.get('/habit-trackers/:id/entries', (req, res) => {
  try {
    const { year, month } = req.query;
    Promise.resolve(getOpsDb().getHabitEntries(req.session.userId, req.params.id, year, month)).then((entries) => {
      res.json({ entries });
    }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/habit-trackers/:id/entries', (req, res) => {
  try {
    const { date, entry_value, is_auto } = req.body || {};
    Promise.resolve(getOpsDb().upsertHabitEntry(req.session.userId, req.params.id, date, entry_value, !!is_auto)).then((result) => {
      res.json({ success: true, entry_value: result.entry_value });
    }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/habit-trackers/:id/summary', (req, res) => {
  try {
    const { year, month } = req.query;
    Promise.resolve(getOpsDb().getHabitMonthSummary(req.session.userId, req.params.id, year, month)).then((summary) => {
      res.json({ summary });
    }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/habit-trackers/:id/year-summary', (req, res) => {
  try {
    const { year } = req.query;
    Promise.resolve(getOpsDb().getHabitYearSummary(req.session.userId, req.params.id, year)).then((summary) => {
      res.json({ summary });
    }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/habit-trackers/:id/years', (req, res) => {
  try {
    Promise.resolve(getOpsDb().getHabitYearsSummary(req.session.userId, req.params.id)).then((years) => {
      res.json({ years });
    }).catch((err) => { res.status(err.statusCode || 500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/habit-trackers/import-excel/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = await parseHabitTrackerExcelBuffer(req.file.buffer, req.body?.password || '', req.body?.year || '');
    res.json({
      count: parsed.count,
      months: parsed.months,
      years: parsed.years,
      sheet_name: parsed.sheet_name,
      year: parsed.year,
      preview: parsed.months.map((month) => ({
        label: `${HABIT_IMPORT_MONTHS[month.month - 1].replace(/^\w/, (c) => c.toUpperCase())} ${month.year}`,
        one_days: month.one_days,
        total_days: month.total_days,
        percent: month.percent,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/habit-trackers/:id/import-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = await parseHabitTrackerExcelBuffer(req.file.buffer, req.body?.password || '', req.body?.year || '');
    const imported = await getOpsDb().importHabitEntries(req.session.userId, req.params.id, parsed.entries);
    res.json({ success: true, imported, months: parsed.months, years: parsed.years });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/recurring', (req, res) => {
  Promise.resolve(getOpsDb().getRecurringEntries(req.session.userId)).then((entries) => {
    res.json({ entries });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/recurring', (req, res) => {
  try {
    const {
      type,
      description,
      amount,
      interval_months,
      start_month,
      card_id,
      bank_account_id,
      expense_category,
      due_day,
      discount_pct,
      also_expense,
      is_extra,
      reminder_enabled,
      reminder_days_before,
      reminder_frequency,
      reminder_silent,
      apply_current_month,
    } = req.body;
    if (!type || !description || !amount) return res.status(400).json({ error: 'Missing required fields' });
    Promise.resolve(getOpsDb().addRecurringEntry(req.session.userId, {
      type,
      description,
      amount,
      interval_months,
      start_month,
      card_id,
      bank_account_id,
      expense_category,
      due_day,
      discount_pct,
      also_expense,
      is_extra,
      reminder_enabled,
      reminder_days_before,
      reminder_frequency,
      reminder_silent,
    })).then(async (id) => {
      if (apply_current_month) {
        const applied = await Promise.resolve(getOpsDb().applyRecurringEntryForCurrentMonth(req.session.userId, id));
        if (applied) sendRecurringAppliedEmailForUser(req.session.userId, [Number(id)]).catch(() => {});
      }
      res.json({ success: true, id });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/recurring/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateRecurringEntry(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.delete('/recurring/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteRecurringEntry(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/recurring/apply', (req, res) => {
  Promise.resolve(getOpsDb().applyRecurringEntries(req.session.userId)).then((applied) => {
    if ((applied || []).length) sendRecurringAppliedEmailForUser(req.session.userId, applied).catch(() => {});
    res.json({ success: true, applied: applied.length, ids: applied });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/societies', async (req, res) => {
  try {
    const societies = await Promise.resolve(pgCoreDb.listSocieties(req.session.userId));
    res.json({ societies });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load societies.' });
  }
});

router.post('/societies', async (req, res) => {
  try {
    const society = await Promise.resolve(pgCoreDb.createSociety(req.session.userId, req.body || {}));
    res.json({ success: true, society });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not create society.' });
  }
});

router.get('/societies/:id', async (req, res) => {
  try {
    const detail = await Promise.resolve(pgCoreDb.getSocietyDetail(req.session.userId, req.params.id, {
      month: req.query.month || '',
    }));
    res.json(detail);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load society.' });
  }
});

router.put('/societies/:id', async (req, res) => {
  try {
    const society = await Promise.resolve(pgCoreDb.updateSociety(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, society });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update society.' });
  }
});

router.delete('/societies/:id', async (req, res) => {
  try {
    const success = await Promise.resolve(pgCoreDb.deleteSociety(req.session.userId, req.params.id));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete society.' });
  }
});

router.post('/societies/:id/members', async (req, res) => {
  try {
    const member = await Promise.resolve(pgCoreDb.addSocietyMember(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, member });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not add member.' });
  }
});

router.put('/societies/:id/members/:memberId', async (req, res) => {
  try {
    const member = await Promise.resolve(pgCoreDb.updateSocietyMember(req.session.userId, req.params.id, req.params.memberId, req.body || {}));
    res.json({ success: true, member });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update member.' });
  }
});

router.delete('/societies/:id/members/:memberId', async (req, res) => {
  try {
    const success = await Promise.resolve(pgCoreDb.deleteSocietyMember(req.session.userId, req.params.id, req.params.memberId));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete member.' });
  }
});

router.put('/societies/:id/contributions/:memberId', async (req, res) => {
  try {
    const contribution = await Promise.resolve(pgCoreDb.saveSocietyContribution(req.session.userId, req.params.id, req.params.memberId, req.body || {}));
    res.json({ success: true, contribution });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not save contribution.' });
  }
});

router.post('/societies/payment-requests/:id/review', async (req, res) => {
  try {
    const result = await Promise.resolve(pgCoreDb.reviewSocietyContributionPaymentRequest(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not review society payment request.' });
  }
});

router.post('/societies/:id/expenses', async (req, res) => {
  try {
    const expense = await Promise.resolve(pgCoreDb.addSocietyExpense(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, expense });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not add expense.' });
  }
});

router.put('/societies/:id/expenses/:expenseId', async (req, res) => {
  try {
    const expense = await Promise.resolve(pgCoreDb.updateSocietyExpense(req.session.userId, req.params.id, req.params.expenseId, req.body || {}));
    res.json({ success: true, expense });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update expense.' });
  }
});

router.delete('/societies/:id/expenses/:expenseId', async (req, res) => {
  try {
    const success = await Promise.resolve(pgCoreDb.deleteSocietyExpense(req.session.userId, req.params.id, req.params.expenseId));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete expense.' });
  }
});

router.post('/societies/:id/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map((sheet) => sheet.name()) });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('encrypt')) {
      res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    } else {
      res.status(500).json({ error: msg || 'Failed to read file' });
    }
  }
});

router.post('/societies/:id/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mode = String(req.body.mode || 'members').toLowerCase();
    if (mode === 'expenses') {
      const preview = await parseSocietyExpenseImportWorkbook(req.file.buffer, {
        password: req.body.password || '',
        sheetName: req.body.sheet || '',
      });
      return res.json({
        success: true,
        mode: 'expenses',
        sheet: preview.sheet,
        expense_count: preview.expenses.length,
        skipped_rows: preview.skippedRows,
        total_amount: preview.totalAmount,
        preview: preview.expenses.slice(0, 20),
      });
    }
    const preview = await parseSocietyImportWorkbook(req.file.buffer, {
      password: req.body.password || '',
      sheetName: req.body.sheet || '',
      baseYear: req.body.base_year || '',
    });
    res.json({
      success: true,
      mode: 'members',
      sheet: preview.sheet,
      month_columns: preview.monthColumns,
      member_count: preview.members.length,
      contribution_count: preview.contributionCount,
      skipped_rows: preview.skippedRows,
      preview: preview.members.slice(0, 12).map((member) => ({
        property_type: member.property_type,
        unit_label: member.unit_label,
        phone_number: member.phone_number,
        member_name: member.member_name,
        monthly_due: member.monthly_due,
        contributions: member.contributions.slice(0, 6),
      })),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not preview society import.' });
  }
});

router.post('/societies/:id/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const societyId = Number(req.params.id);
    if (!(societyId > 0)) return res.status(400).json({ error: 'Invalid society id' });
    const mode = String(req.body.mode || 'members').toLowerCase();
    if (mode === 'expenses') {
      const parsedExpenses = await parseSocietyExpenseImportWorkbook(req.file.buffer, {
        password: req.body.password || '',
        sheetName: req.body.sheet || '',
      });
      if (!parsedExpenses.expenses.length) return res.status(400).json({ error: 'No valid expenses found in the selected sheet.' });
      let expensesImported = 0;
      for (const expense of parsedExpenses.expenses) {
        await Promise.resolve(pgCoreDb.addSocietyExpense(req.session.userId, societyId, expense));
        expensesImported++;
      }
      return res.json({
        success: true,
        expenses_imported: expensesImported,
        imported_months: [...new Set(parsedExpenses.expenses.map((expense) => expense.month_key).filter(Boolean))],
      });
    }
    const parsed = await parseSocietyImportWorkbook(req.file.buffer, {
      password: req.body.password || '',
      sheetName: req.body.sheet || '',
      baseYear: req.body.base_year || '',
    });
    if (!parsed.members.length) return res.status(400).json({ error: 'No valid members found in the selected sheet.' });

    const detail = await Promise.resolve(pgCoreDb.getSocietyDetail(req.session.userId, societyId, {}));
    const existingMembers = Array.isArray(detail?.members) ? detail.members : [];
    const unitMap = new Map();
    const namePhoneMap = new Map();
    const nameMap = new Map();
    existingMembers.forEach((member) => {
      const unitKey = normalizeSocietyImportUnitKey(member.unit_label);
      const nameKey = normalizeSocietyImportNameKey(member.member_name);
      const phoneKey = normalizeSocietyImportPhoneKey(member.phone_number);
      if (unitKey && !unitMap.has(unitKey)) unitMap.set(unitKey, member);
      if (nameKey && phoneKey && !namePhoneMap.has(`${nameKey}|${phoneKey}`)) namePhoneMap.set(`${nameKey}|${phoneKey}`, member);
      if (nameKey && !nameMap.has(nameKey)) nameMap.set(nameKey, member);
    });

    let membersAdded = 0;
    let membersUpdated = 0;
    let contributionsImported = 0;

    for (const importedMember of parsed.members) {
      const unitKey = normalizeSocietyImportUnitKey(importedMember.unit_label);
      const nameKey = normalizeSocietyImportNameKey(importedMember.member_name);
      const phoneKey = normalizeSocietyImportPhoneKey(importedMember.phone_number);
      let matched = null;
      if (unitKey && unitMap.has(unitKey)) matched = unitMap.get(unitKey);
      else if (nameKey && phoneKey && namePhoneMap.has(`${nameKey}|${phoneKey}`)) matched = namePhoneMap.get(`${nameKey}|${phoneKey}`);
      else if (nameKey && nameMap.has(nameKey)) matched = nameMap.get(nameKey);

      const memberPayload = {
        member_name: importedMember.member_name,
        phone_number: importedMember.phone_number,
        unit_label: importedMember.unit_label,
        property_type: importedMember.property_type,
        monthly_due: importedMember.monthly_due > 0
          ? importedMember.monthly_due
          : Number(matched?.monthly_due || 0),
      };

      let targetMember = matched;
      if (matched) {
        targetMember = await Promise.resolve(pgCoreDb.updateSocietyMember(req.session.userId, societyId, matched.id, memberPayload));
        membersUpdated++;
      } else {
        targetMember = await Promise.resolve(pgCoreDb.addSocietyMember(req.session.userId, societyId, memberPayload));
        membersAdded++;
      }

      const freshUnitKey = normalizeSocietyImportUnitKey(targetMember.unit_label);
      const freshNameKey = normalizeSocietyImportNameKey(targetMember.member_name);
      const freshPhoneKey = normalizeSocietyImportPhoneKey(targetMember.phone_number);
      if (freshUnitKey) unitMap.set(freshUnitKey, targetMember);
      if (freshNameKey && freshPhoneKey) namePhoneMap.set(`${freshNameKey}|${freshPhoneKey}`, targetMember);
      if (freshNameKey) nameMap.set(freshNameKey, targetMember);

      for (const contribution of importedMember.contributions) {
        await Promise.resolve(pgCoreDb.saveSocietyContribution(req.session.userId, societyId, targetMember.id, {
          month_key: contribution.month_key,
          amount: contribution.amount,
          paid_on: contribution.paid_on || '',
          notes: contribution.notes || 'Imported from Excel',
        }));
        contributionsImported++;
      }
    }

    res.json({
      success: true,
      members_added: membersAdded,
      members_updated: membersUpdated,
      contributions_imported: contributionsImported,
      imported_months: parsed.monthColumns,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not import society excel.' });
  }
});

router.get('/school-kids', async (req, res) => {
  try {
    const overview = await Promise.resolve(pgCoreDb.getSchoolKidsOverview(req.session.userId));
    res.json(overview);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load school kids.' });
  }
});

router.post('/school-kids', async (req, res) => {
  try {
    const kid = await Promise.resolve(pgCoreDb.createSchoolKid(req.session.userId, req.body || {}));
    res.json({ success: true, kid });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not create kid.' });
  }
});

router.get('/school-kids/:id', async (req, res) => {
  try {
    const detail = await Promise.resolve(pgCoreDb.getSchoolKidDetail(req.session.userId, req.params.id));
    res.json(detail);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load kid details.' });
  }
});

router.put('/school-kids/:id', async (req, res) => {
  try {
    const kid = await Promise.resolve(pgCoreDb.updateSchoolKid(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, kid });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update kid.' });
  }
});

router.delete('/school-kids/:id', async (req, res) => {
  try {
    const success = await Promise.resolve(pgCoreDb.deleteSchoolKid(req.session.userId, req.params.id));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete kid.' });
  }
});

router.post('/school-kids/:id/classes', async (req, res) => {
  try {
    const classRow = await Promise.resolve(pgCoreDb.addSchoolKidClass(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, class_row: classRow });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not add class.' });
  }
});

router.put('/school-kids/:id/classes/:classId', async (req, res) => {
  try {
    const classRow = await Promise.resolve(pgCoreDb.updateSchoolKidClass(req.session.userId, req.params.id, req.params.classId, req.body || {}));
    res.json({ success: true, class_row: classRow });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update class.' });
  }
});

router.delete('/school-kids/:id/classes/:classId', async (req, res) => {
  try {
    const success = await Promise.resolve(pgCoreDb.deleteSchoolKidClass(req.session.userId, req.params.id, req.params.classId));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete class.' });
  }
});

router.post('/school-kids/:id/expenses', async (req, res) => {
  try {
    const expense = await Promise.resolve(pgCoreDb.addSchoolKidExpense(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, expense });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not add expense.' });
  }
});

router.put('/school-kids/:id/expenses/:expenseId', async (req, res) => {
  try {
    const expense = await Promise.resolve(pgCoreDb.updateSchoolKidExpense(req.session.userId, req.params.id, req.params.expenseId, req.body || {}));
    res.json({ success: true, expense });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update expense.' });
  }
});

router.delete('/school-kids/:id/expenses/:expenseId', async (req, res) => {
  try {
    const success = await Promise.resolve(pgCoreDb.deleteSchoolKidExpense(req.session.userId, req.params.id, req.params.expenseId));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete expense.' });
  }
});

router.post('/school-kids/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const workbook = await readSchoolKidWorkbook(req.file.buffer, password);
    res.json({ sheets: workbook.sheetNames });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('encrypt')) {
      res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    } else {
      res.status(500).json({ error: msg || 'Failed to read file' });
    }
  }
});

router.post('/school-kids/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const preview = await parseSchoolKidImportWorkbook(req.file.buffer, {
      password: req.body.password || '',
      sheets: parseSheetParam(req.body.sheets),
    });
    res.json({
      success: true,
      sheets: preview.sheets,
      kid_count: preview.kidCount,
      class_count: preview.classRecords.length,
      expense_count: preview.expenseCount,
      skipped_sheets: preview.skippedSheets,
      preview: preview.classRecords.slice(0, 16).map((row) => ({
        kid_name: row.kid_name,
        school_name: row.school_name,
        academic_year: row.academic_year,
        class_label: row.class_label,
        expected_monthly_fee: row.expected_monthly_fee,
        bus_fee: row.bus_fee,
        other_fee: row.other_fee,
        expense_count: row.expenses.length,
        total_expense: row.expenses.reduce((sum, item) => Math.round((sum + Number(item.amount || 0)) * 100) / 100, 0),
      })),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not preview school kids import.' });
  }
});

router.post('/school-kids/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = await parseSchoolKidImportWorkbook(req.file.buffer, {
      password: req.body.password || '',
      sheets: parseSheetParam(req.body.sheets),
    });
    if (!parsed.classRecords.length) return res.status(400).json({ error: 'No valid kid class records found in the selected sheets.' });

    const overview = await Promise.resolve(pgCoreDb.getSchoolKidsOverview(req.session.userId));
    const kidMap = new Map((overview?.kids || []).map((kid) => [normalizeSchoolKidImportNameKey(kid.kid_name), kid]));
    const detailCache = new Map();
    async function getKidDetailCached(kidId) {
      if (!detailCache.has(kidId)) {
        detailCache.set(kidId, await Promise.resolve(pgCoreDb.getSchoolKidDetail(req.session.userId, kidId)));
      }
      return detailCache.get(kidId);
    }

    let kidsAdded = 0;
    let classesAdded = 0;
    let classesUpdated = 0;
    let expensesImported = 0;

    for (const record of parsed.classRecords) {
      const kidKey = normalizeSchoolKidImportNameKey(record.kid_name);
      let kid = kidMap.get(kidKey);
      if (!kid) {
        kid = await Promise.resolve(pgCoreDb.createSchoolKid(req.session.userId, {
          kid_name: record.kid_name,
          details: 'Imported from Excel',
        }));
        kidMap.set(kidKey, kid);
        kidsAdded++;
      }

      const kidDetail = await getKidDetailCached(Number(kid.id));
      const existingClass = (kidDetail?.classes || []).find((row) =>
        normalizeExcelHeader(row.school_name) === normalizeExcelHeader(record.school_name)
        && String(row.academic_year || '').trim() === String(record.academic_year || '').trim()
        && normalizeExcelHeader(row.class_label) === normalizeExcelHeader(record.class_label)
      );
      const classPayload = {
        school_name: record.school_name,
        academic_year: record.academic_year,
        class_label: record.class_label,
        expected_monthly_fee: record.expected_monthly_fee,
        bus_fee: record.bus_fee,
        other_fee: record.other_fee,
        details: record.details || 'Imported from Excel',
      };
      let targetClass = existingClass;
      if (existingClass) {
        targetClass = await Promise.resolve(pgCoreDb.updateSchoolKidClass(req.session.userId, kid.id, existingClass.id, classPayload));
        classesUpdated++;
      } else {
        targetClass = await Promise.resolve(pgCoreDb.addSchoolKidClass(req.session.userId, kid.id, classPayload));
        classesAdded++;
      }
      await Promise.resolve(pgCoreDb.replaceSchoolKidClassExpenses(req.session.userId, kid.id, targetClass.id, record.expenses));
      expensesImported += record.expenses.length;
      detailCache.delete(Number(kid.id));
    }

    res.json({
      success: true,
      kids_added: kidsAdded,
      classes_added: classesAdded,
      classes_updated: classesUpdated,
      expenses_imported: expensesImported,
      imported_sheets: parsed.sheets,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not import school kids excel.' });
  }
});

function normalizeTenantImportNumber(value, { allowNegative = false } = {}) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    const normalized = Math.round(value * 100) / 100;
    return allowNegative ? normalized : Math.max(0, normalized);
  }
  const cleaned = String(value).replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return 0;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  const normalized = Math.round(parsed * 100) / 100;
  return allowNegative ? normalized : Math.max(0, normalized);
}

function normalizeTenantImportInt(value) {
  if (value == null || value === '') return 0;
  const cleaned = String(value).replace(/[^0-9\-]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function tenantImportRoomLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^room\b/i.test(raw)) return raw.replace(/\s+/g, ' ').trim();
  return `Room ${raw}`;
}

function splitTenantPortionAndName(portionValue, nameValue) {
  const portionRaw = String(portionValue || '').trim();
  const nameRaw = String(nameValue || '').trim();
  if (nameRaw) return { portion: portionRaw, tenant_name: nameRaw };
  const match = portionRaw.match(/^(\d+)\s+(.+)$/);
  if (match) {
    return { portion: match[1].trim(), tenant_name: match[2].trim() };
  }
  return { portion: portionRaw, tenant_name: nameRaw };
}

function findTenantImportHeaderRow(rows, requiredHeaders = []) {
  for (let index = 0; index < Math.min(rows.length, 8); index += 1) {
    const normalized = (rows[index] || []).map((cell) => normalizeExcelHeader(cell));
    if (requiredHeaders.every((header) => normalized.includes(header))) return index;
  }
  return -1;
}

function mapTenantDetailHeader(normalized) {
  if (['portion', 'room', 'room no', 'room number'].includes(normalized)) return 'portion';
  if (['tenant', 'name', 'tenant name'].includes(normalized)) return 'tenant_name';
  if (['start from', 'from', 'start date', 'start'].includes(normalized)) return 'start_date';
  if (['end from', 'to', 'end date', 'end'].includes(normalized)) return 'end_date';
  if (['contract period', 'contract', 'contract months'].includes(normalized)) return 'contract_period';
  if (['permanent address', 'address', 'tenant address'].includes(normalized)) return 'tenant_address';
  if (['address proof', 'proof type'].includes(normalized)) return 'address_proof_type';
  if (['proof id', 'proof no', 'id number', 'aadhaar number'].includes(normalized)) return 'proof_id';
  if (['contact number', 'contact', 'mobile', 'phone number'].includes(normalized)) return 'contact_number';
  if (['job', 'occupation'].includes(normalized)) return 'job';
  if (['job location', 'work location'].includes(normalized)) return 'job_location';
  if (['amount settled', 'settled amount'].includes(normalized)) return 'amount_settled';
  if (['security deposit', 'security deposited', 'deposit'].includes(normalized)) return 'security_deposit';
  return null;
}

function mapTenantChargesHeader(normalized) {
  if (['portion', 'room', 'room no', 'room number'].includes(normalized)) return 'portion';
  if (['name', 'tenant', 'tenant name'].includes(normalized)) return 'tenant_name';
  if (['electricity per unit', 'electricity unit', 'electricity rate'].includes(normalized)) return 'electricity_unit_price';
  if (['sewarage and water charges', 'sewerage and water charges', 'sewerage water charges'].includes(normalized)) return 'sewerage_water_charge';
  if (['cleaning charges', 'cleaning charge'].includes(normalized)) return 'cleaning_charge';
  if (['car parking', 'car parking charges'].includes(normalized)) return 'car_parking';
  if (['bike parking', 'bike parking charges'].includes(normalized)) return 'bike_parking';
  if (['implemented on', 'implemented from'].includes(normalized)) return 'implemented_on';
  return null;
}

function mapTenantInvoiceHeader(normalized) {
  if (['name', 'tenant', 'tenant name'].includes(normalized)) return 'tenant_name';
  if (['rent date', 'invoice date', 'month'].includes(normalized)) return 'rent_date';
  if (['rent paid on', 'prent paid on', 'paid on', 'payment date'].includes(normalized)) return 'rent_paid_on';
  if (['montly rent', 'monthly rent', 'rent'].includes(normalized)) return 'monthly_rent';
  if (['meter reading electricity last', 'last', 'previous units', 'last units'].includes(normalized)) return 'last_units';
  if (['meter reading electricity current', 'current', 'current units'].includes(normalized)) return 'current_units';
  if (['total units', 'units', 'units used'].includes(normalized)) return 'total_units';
  if (['electricity bill', 'electricity amount'].includes(normalized)) return 'electricity_bill';
  if (['sewarage and water charges', 'sewerage and water charges', 'sewerage water charges'].includes(normalized)) return 'sewerage_water_charge';
  if (['sewarage charges', 'sewerage charges', 'sewarage charge', 'sewerage charge'].includes(normalized)) return 'sewerage_charge';
  if (['water charges', 'water charge'].includes(normalized)) return 'water_charge';
  if (['cleaning charges', 'cleaning charge'].includes(normalized)) return 'cleaning_charge';
  if (['parking charges', 'parking charge'].includes(normalized)) return 'parking_charge';
  if (['other charges detail', 'other charge detail', 'remarks', 'details'].includes(normalized)) return 'other_charges_detail';
  if (['other charges', 'other charge'].includes(normalized)) return 'other_charges';
  if (['total'].includes(normalized)) return 'total_amount';
  if (['payment paid', 'paid amount'].includes(normalized)) return 'payment_paid';
  if (['pending amount', 'pending'].includes(normalized)) return 'pending_amount';
  return null;
}

function detectTenantInvoiceHeaderRow(rows = []) {
  let best = { index: -1, score: -1 };
  const limit = Math.min(Array.isArray(rows) ? rows.length : 0, 5);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const nextRow = rows[rowIndex + 1] || [];
    const columnCount = Math.max(row.length, nextRow.length);
    let score = 0;
    for (let index = 0; index < columnCount; index += 1) {
      const combined = normalizeExcelHeader(`${row[index] || ''} ${nextRow[index] || ''}`);
      const direct = normalizeExcelHeader(row[index] || nextRow[index] || '');
      const alias = mapTenantInvoiceHeader(combined) || mapTenantInvoiceHeader(direct);
      if (alias) score += 1;
    }
    if (score > best.score) best = { index: rowIndex, score };
  }
  return best.score > 0 ? best.index : -1;
}

function buildTenantInvoiceImportColumnMap(headerRow = [], nextRow = []) {
  const columnMap = {};
  const columnCount = Math.max(headerRow.length, nextRow.length);
  for (let index = 0; index < columnCount; index += 1) {
    const combined = normalizeExcelHeader(`${headerRow[index] || ''} ${nextRow[index] || ''}`);
    const direct = normalizeExcelHeader(headerRow[index] || nextRow[index] || '');
    const alias = mapTenantInvoiceHeader(combined) || mapTenantInvoiceHeader(direct);
    if (alias && columnMap[alias] == null) columnMap[alias] = index;
  }
  if (columnMap.monthly_rent != null) {
    const start = Number(columnMap.monthly_rent);
    if (columnMap.last_units == null) columnMap.last_units = start + 1;
    if (columnMap.current_units == null) columnMap.current_units = start + 2;
    if (columnMap.total_units == null) columnMap.total_units = start + 3;
    if (columnMap.electricity_bill == null) columnMap.electricity_bill = start + 4;
    if (columnMap.sewerage_charge == null && columnMap.sewerage_water_charge == null) columnMap.sewerage_charge = start + 5;
    if (columnMap.water_charge == null) columnMap.water_charge = start + 6;
    if (columnMap.cleaning_charge == null) columnMap.cleaning_charge = start + 7;
    if (columnMap.other_charges_detail == null) columnMap.other_charges_detail = start + 8;
    if (columnMap.other_charges == null) columnMap.other_charges = start + 9;
    if (columnMap.total_amount == null) columnMap.total_amount = start + 10;
  }
  return columnMap;
}

function parseTenantWorkbookImport(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    normalized: normalizeExcelHeader(name),
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false }),
  }));

  const detailSheet = sheets.find((sheet) => findTenantImportHeaderRow(sheet.rows, ['portion', 'tenant']) >= 0) || null;
  const chargesSheet = sheets.find((sheet) => sheet !== detailSheet && findTenantImportHeaderRow(sheet.rows, ['portion', 'electricity per unit']) >= 0) || null;
  const invoiceSheets = sheets.filter((sheet) => {
    if (sheet === detailSheet || sheet === chargesSheet) return false;
    if (sheet.normalized.startsWith('portion')) return true;
    const firstRow = (sheet.rows[0] || []).map((cell) => normalizeExcelHeader(cell));
    return firstRow.includes('rent date') && firstRow.includes('name');
  });

  const rooms = [];
  const tenants = [];
  const charges = [];
  const invoices = [];
  const roomSeen = new Set();

  function addRoom(portion) {
    const roomLabel = tenantImportRoomLabel(portion);
    const key = normalizeExcelHeader(roomLabel);
    if (!roomLabel || roomSeen.has(key)) return;
    roomSeen.add(key);
    rooms.push({ portion: String(portion || '').trim(), room_label: roomLabel });
  }

  if (detailSheet) {
    const headerRowIndex = findTenantImportHeaderRow(detailSheet.rows, ['portion', 'tenant']);
    const headerRow = detailSheet.rows[headerRowIndex] || [];
    const columnMap = {};
    headerRow.forEach((cell, index) => {
      const alias = mapTenantDetailHeader(normalizeExcelHeader(cell));
      if (alias && columnMap[alias] == null) columnMap[alias] = index;
    });
    for (let rowIndex = headerRowIndex + 1; rowIndex < detailSheet.rows.length; rowIndex += 1) {
      const row = detailSheet.rows[rowIndex] || [];
      if (!row.some((cell) => String(cell || '').trim())) continue;
      const split = splitTenantPortionAndName(row[columnMap.portion], row[columnMap.tenant_name]);
      if (!split.portion) continue;
      addRoom(split.portion);
      const startDate = parseExcelDate(row[columnMap.start_date]);
      const endDate = parseExcelDate(row[columnMap.end_date]);
      const tenantNotes = [
        row[columnMap.address_proof_type] ? `Address proof: ${String(row[columnMap.address_proof_type]).trim()}` : '',
        row[columnMap.proof_id] ? `Proof ID: ${String(row[columnMap.proof_id]).trim()}` : '',
        row[columnMap.job] ? `Job: ${String(row[columnMap.job]).trim()}` : '',
        row[columnMap.job_location] ? `Job location: ${String(row[columnMap.job_location]).trim()}` : '',
        row[columnMap.amount_settled] ? `Amount settled: ${normalizeTenantImportNumber(row[columnMap.amount_settled], { allowNegative: true })}` : '',
        endDate ? `End date: ${endDate}` : '',
      ].filter(Boolean).join('\n');
      tenants.push({
        portion: split.portion,
        room_label: tenantImportRoomLabel(split.portion),
        tenant_name: split.tenant_name || 'Tenant',
        start_date: startDate || null,
        end_date: endDate || null,
        contract_months: normalizeTenantImportInt(row[columnMap.contract_period]) || null,
        tenant_address: String(row[columnMap.tenant_address] || '').trim(),
        contact_number: String(row[columnMap.contact_number] || '').trim(),
        security_deposit: normalizeTenantImportNumber(row[columnMap.security_deposit]),
        rent_amount: 0,
        electricity_unit_price: 0,
        sewerage_charge: 0,
        water_charge: 0,
        cleaning_charge: 0,
        opening_electricity_units: 0,
        notes: tenantNotes,
      });
    }
  }

  if (chargesSheet) {
    const headerRowIndex = findTenantImportHeaderRow(chargesSheet.rows, ['portion', 'electricity per unit']);
    const headerRow = chargesSheet.rows[headerRowIndex] || [];
    const columnMap = {};
    headerRow.forEach((cell, index) => {
      const alias = mapTenantChargesHeader(normalizeExcelHeader(cell));
      if (alias && columnMap[alias] == null) columnMap[alias] = index;
    });
    for (let rowIndex = headerRowIndex + 1; rowIndex < chargesSheet.rows.length; rowIndex += 1) {
      const row = chargesSheet.rows[rowIndex] || [];
      if (!row.some((cell) => String(cell || '').trim())) continue;
      const split = splitTenantPortionAndName(row[columnMap.portion], row[columnMap.tenant_name]);
      if (!split.portion) continue;
      addRoom(split.portion);
      const carParking = normalizeTenantImportNumber(row[columnMap.car_parking]);
      const bikeParking = normalizeTenantImportNumber(row[columnMap.bike_parking]);
      const implementedOn = parseExcelDate(row[columnMap.implemented_on]);
      const noteParts = [];
      if (carParking) noteParts.push(`Car parking: ${carParking}`);
      if (bikeParking) noteParts.push(`Bike parking: ${bikeParking}`);
      if (implementedOn) noteParts.push(`Implemented on: ${implementedOn}`);
      charges.push({
        portion: split.portion,
        room_label: tenantImportRoomLabel(split.portion),
        tenant_name: split.tenant_name || 'Tenant',
        start_date: implementedOn || null,
        implemented_on: implementedOn || null,
        electricity_unit_price: normalizeTenantImportNumber(row[columnMap.electricity_unit_price]),
        sewerage_charge: normalizeTenantImportNumber(row[columnMap.sewerage_water_charge]),
        water_charge: 0,
        cleaning_charge: normalizeTenantImportNumber(row[columnMap.cleaning_charge]),
        notes: noteParts.join('\n'),
      });
    }
  }

  for (const sheet of invoiceSheets) {
    const roomPortionMatch = sheet.name.match(/portion\s*([0-9a-z]+)/i);
    const roomPortion = roomPortionMatch ? roomPortionMatch[1] : '';
    if (!roomPortion) continue;
    addRoom(roomPortion);
    const firstRow = sheet.rows[0] || [];
    const secondRow = sheet.rows[1] || [];
    const columnMap = {};
    const columnCount = Math.max(firstRow.length, secondRow.length);
    for (let index = 0; index < columnCount; index += 1) {
      const normalized = normalizeExcelHeader(`${firstRow[index] || ''} ${secondRow[index] || ''}`) || normalizeExcelHeader(firstRow[index] || secondRow[index] || '');
      const alias = mapTenantInvoiceHeader(normalized);
      if (alias && columnMap[alias] == null) columnMap[alias] = index;
    }
    for (let rowIndex = 2; rowIndex < sheet.rows.length; rowIndex += 1) {
      const row = sheet.rows[rowIndex] || [];
      if (!row.some((cell) => String(cell || '').trim())) continue;
      const tenantName = String(row[columnMap.tenant_name] || '').trim();
      const rentDate = parseExcelDate(row[columnMap.rent_date]);
      if (!tenantName || !rentDate) continue;
      const invoiceMonth = String(rentDate).slice(0, 7);
      const previousUnits = normalizeTenantImportInt(row[columnMap.last_units]);
      const currentUnits = normalizeTenantImportInt(row[columnMap.current_units]);
      const unitsUsedRaw = normalizeTenantImportInt(row[columnMap.total_units]);
      const unitsUsed = unitsUsedRaw || (currentUnits - previousUnits);
      const electricityBill = normalizeTenantImportNumber(row[columnMap.electricity_bill], { allowNegative: true });
      const rate = unitsUsed ? Math.round((electricityBill / unitsUsed) * 100) / 100 : 0;
      const parkingCharge = normalizeTenantImportNumber(row[columnMap.parking_charge], { allowNegative: true });
      const otherCharge = normalizeTenantImportNumber(row[columnMap.other_charges], { allowNegative: true });
      const totalAmount = normalizeTenantImportNumber(row[columnMap.total_amount], { allowNegative: true });
      const pendingAmount = normalizeTenantImportNumber(row[columnMap.pending_amount], { allowNegative: true });
      const paidAmount = normalizeTenantImportNumber(row[columnMap.payment_paid], { allowNegative: true });
      const noteParts = [
        row[columnMap.other_charges_detail] ? `Other details: ${String(row[columnMap.other_charges_detail]).trim()}` : '',
        paidAmount ? `Payment paid: ${paidAmount}` : '',
        pendingAmount ? `Pending amount: ${pendingAmount}` : '',
      ].filter(Boolean);
      invoices.push({
        portion: roomPortion,
        room_label: tenantImportRoomLabel(roomPortion),
        tenant_name: tenantName,
        start_date: rentDate,
        invoice_month: invoiceMonth,
        due_date: parseExcelDate(row[columnMap.rent_paid_on]) || rentDate,
        contact_number_snapshot: '',
        rent_amount_snapshot: normalizeTenantImportNumber(row[columnMap.monthly_rent], { allowNegative: true }),
        electricity_unit_price_snapshot: rate,
        sewerage_charge_snapshot: normalizeTenantImportNumber(row[columnMap.sewerage_water_charge], { allowNegative: true }),
        water_charge_snapshot: 0,
        cleaning_charge_snapshot: normalizeTenantImportNumber(row[columnMap.cleaning_charge], { allowNegative: true }),
        other_charges_snapshot: Math.round((parkingCharge + otherCharge) * 100) / 100,
        previous_electricity_units: previousUnits,
        current_electricity_units: currentUnits,
        electricity_units_used: unitsUsed,
        electricity_amount: electricityBill,
        total_amount: totalAmount,
        notes: noteParts.join('\n'),
      });
    }
  }

  if (!tenants.length && !charges.length && !invoices.length) {
    throw new Error('No tenant rows were detected in this workbook.');
  }

  return {
    sheets_used: {
      details: detailSheet?.name || '',
      charges: chargesSheet?.name || '',
      invoices: invoiceSheets.map((sheet) => sheet.name),
    },
    rooms,
    tenants,
    charges,
    invoices,
  };
}

function parseTenantInvoiceImportSheet(buffer, selectedSheet = '') {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const availableSheets = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  const sheetName = String(selectedSheet || '').trim() || availableSheets[0] || '';
  if (!sheetName) throw new Error('No sheets found in this workbook.');
  if (!workbook.Sheets[sheetName]) throw new Error('Selected sheet was not found in this workbook.');
  const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
  if (!sheetRows.length) throw new Error('The selected sheet is empty.');

  const headerRowIndex = detectTenantInvoiceHeaderRow(sheetRows);
  if (headerRowIndex < 0) throw new Error('Could not detect invoice columns in this sheet.');
  const headerRow = sheetRows[headerRowIndex] || [];
  const nextRow = sheetRows[headerRowIndex + 1] || [];
  const columnMap = buildTenantInvoiceImportColumnMap(headerRow, nextRow);

  if (columnMap.rent_date == null) throw new Error('Could not detect the Rent date column.');
  if (columnMap.monthly_rent == null) throw new Error('Could not detect the Monthly rent column.');

  const invoices = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
    const row = sheetRows[rowIndex] || [];
    if (!row.some((cell) => String(cell || '').trim())) continue;
    const rentDate = parseExcelDate(row[columnMap.rent_date]);
    if (!rentDate) continue;
    const invoiceMonth = String(rentDate).slice(0, 7);
    const previousUnits = normalizeTenantImportInt(row[columnMap.last_units]);
    const currentUnits = normalizeTenantImportInt(row[columnMap.current_units]);
    const unitsUsed = normalizeTenantImportInt(row[columnMap.total_units]);
    const electricityBill = normalizeTenantImportNumber(row[columnMap.electricity_bill], { allowNegative: true });
    const sewerageCharge = columnMap.sewerage_charge != null
      ? normalizeTenantImportNumber(row[columnMap.sewerage_charge], { allowNegative: true })
      : normalizeTenantImportNumber(row[columnMap.sewerage_water_charge], { allowNegative: true });
    const waterCharge = columnMap.water_charge != null
      ? normalizeTenantImportNumber(row[columnMap.water_charge], { allowNegative: true })
      : 0;
    const cleaningCharge = normalizeTenantImportNumber(row[columnMap.cleaning_charge], { allowNegative: true });
    const otherCharge = normalizeTenantImportNumber(row[columnMap.other_charges], { allowNegative: true });
    const totalAmount = normalizeTenantImportNumber(row[columnMap.total_amount], { allowNegative: true });
    const otherDetail = row[columnMap.other_charges_detail] ? String(row[columnMap.other_charges_detail]).trim() : '';
    const otherChargeItems = (otherDetail || otherCharge)
      ? [{ detail: otherDetail || 'Other charge', amount: otherCharge }]
      : [];
    invoices.push({
      invoice_month: invoiceMonth,
      due_date: parseExcelDate(row[columnMap.rent_paid_on]) || rentDate,
      rent_amount_snapshot: normalizeTenantImportNumber(row[columnMap.monthly_rent], { allowNegative: true }),
      electricity_unit_price_snapshot: 0,
      sewerage_charge_snapshot: sewerageCharge,
      water_charge_snapshot: waterCharge,
      cleaning_charge_snapshot: cleaningCharge,
      other_charges_snapshot: otherCharge,
      other_charge_items: otherChargeItems,
      previous_electricity_units: previousUnits,
      current_electricity_units: currentUnits,
      electricity_units_used: unitsUsed,
      electricity_amount: electricityBill,
      total_amount: totalAmount,
      notes: '',
      payment_status: 'paid',
      paid_amount: totalAmount,
    });
  }

  if (!invoices.length) throw new Error('No valid invoice rows found in this sheet.');
  return {
    sheet: sheetName,
    invoices,
    preview: invoices.slice(0, 25),
    invoice_count: invoices.length,
    total_amount: invoices.reduce((sum, row) => Math.round((sum + (Number(row.total_amount || 0) || 0)) * 100) / 100, 0),
  };
}

router.get('/tenants/overview', async (req, res) => {
  try {
    const overview = await Promise.resolve(pgTenantDb.listTenantsOverview(req.session.userId));
    res.json(overview);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load tenants.' });
  }
});

router.get('/approval-badges', async (req, res) => {
  try {
    const [societies, tenants] = await Promise.all([
      Promise.resolve(pgCoreDb.getSocietyPendingApprovalCount(req.session.userId)),
      Promise.resolve(pgTenantDb.getTenantPendingApprovalCount(req.session.userId)),
    ]);
    res.json({
      societies: Number(societies || 0),
      tenants: Number(tenants || 0),
      total: Number(societies || 0) + Number(tenants || 0),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load approval badge counts.' });
  }
});

router.post('/tenants/upload', upload.single('file'), async (req, res) => {
  try {
    const file = saveTenantUploadFile(req.file);
    res.json({ success: true, file });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not upload file.' });
  }
});

router.post('/tenants/records/:id/import-invoices-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please choose an excel file first.' });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true, raw: false });
    res.json({ sheets: Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [] });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not read excel file.' });
  }
});

router.post('/tenants/records/:id/import-invoices-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please choose an excel file first.' });
    const parsed = parseTenantInvoiceImportSheet(req.file.buffer, req.body.sheet);
    res.json({
      success: true,
      sheet: parsed.sheet,
      invoice_count: Number(parsed.invoice_count || 0),
      total_amount: Number(parsed.total_amount || 0),
      preview: parsed.preview || [],
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not preview tenant invoices.' });
  }
});

router.post('/tenants/records/:id/import-invoices-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please choose an excel file first.' });
    const parsed = parseTenantInvoiceImportSheet(req.file.buffer, req.body.sheet);
    const result = await Promise.resolve(pgTenantDb.importTenantInvoiceRows(req.session.userId, req.params.id, parsed.invoices));
    res.json({
      success: true,
      imported: Number(result.imported || 0),
      sheet: parsed.sheet,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not import tenant invoices.' });
  }
});

router.post('/tenants/buildings', async (req, res) => {
  try {
    const building = await Promise.resolve(pgTenantDb.createTenantBuilding(req.session.userId, req.body || {}));
    res.json({ success: true, building });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not create building.' });
  }
});

router.put('/tenants/buildings/:id', async (req, res) => {
  try {
    const building = await Promise.resolve(pgTenantDb.updateTenantBuilding(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, building });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update building.' });
  }
});

router.delete('/tenants/buildings/:id', async (req, res) => {
  try {
    const success = await Promise.resolve(pgTenantDb.deleteTenantBuilding(req.session.userId, req.params.id));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete building.' });
  }
});

router.post('/tenants/buildings/:id/rooms', async (req, res) => {
  try {
    const room = await Promise.resolve(pgTenantDb.createTenantRoom(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, room });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not create room.' });
  }
});

router.put('/tenants/rooms/:id', async (req, res) => {
  try {
    const room = await Promise.resolve(pgTenantDb.updateTenantRoom(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, room });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update room.' });
  }
});

router.delete('/tenants/rooms/:id', async (req, res) => {
  try {
    const success = await Promise.resolve(pgTenantDb.deleteTenantRoom(req.session.userId, req.params.id));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete room.' });
  }
});

router.post('/tenants/records', async (req, res) => {
  try {
    const tenant = await Promise.resolve(pgTenantDb.createTenantRecord(req.session.userId, req.body || {}));
    res.json({ success: true, tenant });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not create tenant.' });
  }
});

router.put('/tenants/records/:id', async (req, res) => {
  try {
    const tenant = await Promise.resolve(pgTenantDb.updateTenantRecord(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, tenant });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update tenant.' });
  }
});

router.delete('/tenants/records/:id', async (req, res) => {
  try {
    const success = await Promise.resolve(pgTenantDb.deleteTenantRecord(req.session.userId, req.params.id));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete tenant.' });
  }
});

router.post('/tenants/records/:id/invoices', async (req, res) => {
  try {
    const invoice = await Promise.resolve(pgTenantDb.createOrUpdateTenantInvoice(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, invoice });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not save invoice.' });
  }
});

router.patch('/tenants/invoices/:id/status', async (req, res) => {
  try {
    const invoice = await Promise.resolve(pgTenantDb.updateTenantInvoicePaymentStatus(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, invoice });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not update invoice status.' });
  }
});

router.post('/tenants/payment-requests/:id/review', async (req, res) => {
  try {
    const result = await Promise.resolve(pgTenantDb.reviewTenantInvoicePaymentRequest(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not review payment request.' });
  }
});

router.post('/tenants/buildings/:id/invoices/bulk', async (req, res) => {
  try {
    const result = await Promise.resolve(pgTenantDb.bulkCreateTenantInvoices(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not generate bulk invoices.' });
  }
});

router.get('/tenants/buildings/:id/invoice-month-share-links', async (req, res) => {
  try {
    const links = await Promise.resolve(pgTenantDb.listTenantInvoiceMonthShareLinks(
      req.session.userId,
      req.params.id,
      req.query.month || req.query.invoice_month || ''
    ));
    res.json({ success: true, links });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load month share links.' });
  }
});

router.post('/tenants/buildings/:id/invoice-month-share-links', async (req, res) => {
  try {
    const link = await Promise.resolve(pgTenantDb.createTenantInvoiceMonthShareLink(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, link });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not create month share link.' });
  }
});

router.get('/tenants/invoices/:id/share-links', async (req, res) => {
  try {
    const links = await Promise.resolve(pgTenantDb.listTenantInvoiceShareLinks(req.session.userId, req.params.id));
    res.json({ success: true, links });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not load invoice share links.' });
  }
});

router.post('/tenants/invoices/:id/share-links', async (req, res) => {
  try {
    const link = await Promise.resolve(pgTenantDb.createTenantInvoiceShareLink(req.session.userId, req.params.id, req.body || {}));
    res.json({ success: true, link });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not create invoice share link.' });
  }
});

router.delete('/tenants/invoice-share-links/:id', async (req, res) => {
  try {
    const success = await Promise.resolve(pgTenantDb.deleteTenantInvoiceShareLink(req.session.userId, req.params.id));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete invoice share link.' });
  }
});

router.delete('/tenants/invoice-month-share-links/:id', async (req, res) => {
  try {
    const success = await Promise.resolve(pgTenantDb.deleteTenantInvoiceMonthShareLink(req.session.userId, req.params.id));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete month share link.' });
  }
});

router.delete('/tenants/invoices/:id', async (req, res) => {
  try {
    const success = await Promise.resolve(pgTenantDb.deleteTenantInvoice(req.session.userId, req.params.id));
    res.json({ success });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete invoice.' });
  }
});

module.exports = router;

function normalizeSocietyImportPhoneKey(value) {
  return String(value || '').replace(/\D+/g, '').trim();
}

function normalizeSocietyImportUnitKey(value) {
  return normalizeExcelHeader(String(value || '').replace(/[._-]/g, ' '));
}

function normalizeSocietyImportNameKey(value) {
  return normalizeExcelHeader(value);
}

function parseSocietyHeaderAliases(normalized) {
  if (['type', 'property type', 'property'].includes(normalized)) return 'property_type';
  if (['h no', 'h no.', 'house no', 'house number', 'house no shop name', 'unit', 'unit no', 'shop name', 'house shop'].includes(normalized)) return 'unit_label';
  if (['phone', 'phone num', 'phone number', 'mobile', 'mobile number', 'contact', 'contact number'].includes(normalized)) return 'phone_number';
  if (['name', 'member name', 'owner name', 'resident name'].includes(normalized)) return 'member_name';
  return null;
}

function parseSocietyExpenseHeaderAliases(normalized) {
  if (['date', 'expense date', 'paid on'].includes(normalized)) return 'expense_date';
  if (['comments', 'comment', 'title', 'description', 'details', 'expense'].includes(normalized)) return 'title';
  if (['paid', 'amount', 'expense amount', 'amt'].includes(normalized)) return 'amount';
  return null;
}

function parseSocietyMonthColumn(rawValue, fallbackState) {
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
    const monthNum = rawValue.getMonth() + 1;
    const year = rawValue.getFullYear();
    fallbackState.currentYear = year;
    fallbackState.prevMonth = monthNum;
    return {
      header: `${shortMonths[monthNum - 1] || 'Mon'}-${String(year).slice(-2)}`,
      month_key: `${year}-${String(monthNum).padStart(2, '0')}`,
    };
  }
  if (typeof rawValue === 'number') {
    const parsedDate = XLSX.SSF.parse_date_code(rawValue);
    if (parsedDate && parsedDate.y && parsedDate.m) {
      const year = Number(parsedDate.y);
      const monthNum = Number(parsedDate.m);
      fallbackState.currentYear = year;
      fallbackState.prevMonth = monthNum;
      return {
        header: `${shortMonths[monthNum - 1] || 'Mon'}-${String(year).slice(-2)}`,
        month_key: `${year}-${String(monthNum).padStart(2, '0')}`,
      };
    }
  }
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const monMatch = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i);
  if (!monMatch) return null;
  const monthNames = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const monthNum = monthNames[monMatch[1].toLowerCase()];
  let year = null;
  const yearMatch = raw.match(/(?:^|[^0-9])(\d{2,4})(?:[^0-9]|$)/);
  if (yearMatch) {
    const yearNum = Number(yearMatch[1]);
    year = String(yearMatch[1]).length === 2 ? 2000 + yearNum : yearNum;
    fallbackState.currentYear = year;
    fallbackState.prevMonth = monthNum;
  } else if (fallbackState.currentYear) {
    if (fallbackState.prevMonth && monthNum < fallbackState.prevMonth) fallbackState.currentYear += 1;
    year = fallbackState.currentYear;
    fallbackState.prevMonth = monthNum;
  }
  if (!year) return null;
  return {
    header: raw,
    month_key: `${year}-${String(monthNum).padStart(2, '0')}`,
  };
}

async function parseSocietyImportWorkbook(buffer, options = {}) {
  const password = options.password || '';
  const workbook = await XlsxPopulate.fromDataAsync(buffer, password ? { password } : {});
  const sheet = options.sheetName ? workbook.sheet(options.sheetName) : workbook.sheets()[0];
  if (!sheet) {
    const err = new Error('Selected sheet was not found');
    err.statusCode = 400;
    throw err;
  }
  const usedRange = sheet.usedRange();
  if (!usedRange) {
    const err = new Error('Selected sheet is empty');
    err.statusCode = 400;
    throw err;
  }
  const lastRow = usedRange.endCell().rowNumber();
  const lastCol = usedRange.endCell().columnNumber();
  const baseYear = Number(options.baseYear || 0) || null;
  let headerRow = 0;
  let memberCols = null;
  let monthCols = [];

  for (let row = 1; row <= Math.min(lastRow, 12); row++) {
    const cols = {};
    const months = [];
    const fallbackState = { currentYear: baseYear, prevMonth: null };
    for (let col = 1; col <= lastCol; col++) {
      const cell = sheet.cell(row, col);
      const cellVal = excelCellDisplayValue(cell);
      const rawVal = cell.value();
      const normalized = normalizeExcelHeader(cellVal);
      const mapped = parseSocietyHeaderAliases(normalized);
      if (mapped) cols[mapped] = col;
      const monthMeta = parseSocietyMonthColumn(rawVal ?? cellVal, fallbackState) || parseSocietyMonthColumn(cellVal, fallbackState);
      if (monthMeta) months.push({ col, ...monthMeta });
    }
    if (cols.member_name && cols.unit_label && months.length) {
      headerRow = row;
      memberCols = cols;
      monthCols = months;
      break;
    }
  }

  if (!headerRow || !memberCols) {
    const err = new Error('Could not detect society import columns. Expected headers like Type, H. NO., phone num, Name, and month columns.');
    err.statusCode = 400;
    throw err;
  }

  const members = [];
  let skippedRows = 0;
  let contributionCount = 0;
  for (let row = headerRow + 1; row <= lastRow; row++) {
    const memberName = excelCellDisplayValue(sheet.cell(row, memberCols.member_name));
    const unitLabel = excelCellDisplayValue(sheet.cell(row, memberCols.unit_label));
    const propertyRaw = memberCols.property_type ? excelCellDisplayValue(sheet.cell(row, memberCols.property_type)).toLowerCase() : '';
    const phoneNumber = memberCols.phone_number ? excelCellDisplayValue(sheet.cell(row, memberCols.phone_number)) : '';
    const hasAnyAmount = monthCols.some((monthCol) => parseExcelAmount(sheet.cell(row, monthCol.col).value()) > 0);
    if (!memberName && !unitLabel && !phoneNumber && !hasAnyAmount) {
      skippedRows++;
      continue;
    }
    if (!memberName && !unitLabel) {
      skippedRows++;
      continue;
    }
    const contributions = monthCols
      .map((monthCol) => ({
        month_key: monthCol.month_key,
        amount: parseExcelAmount(sheet.cell(row, monthCol.col).value()) || 0,
        paid_on: '',
        notes: `Imported from Excel (${monthCol.header})`,
      }))
      .filter((entry) => entry.amount > 0);
    contributionCount += contributions.length;
    const monthlyDue = contributions.reduce((max, entry) => Math.max(max, Number(entry.amount || 0)), 0);
    members.push({
      property_type: propertyRaw === 'shop' ? 'shop' : 'home',
      unit_label: unitLabel,
      phone_number: phoneNumber,
      member_name: memberName || unitLabel,
      monthly_due: monthlyDue,
      contributions,
    });
  }

  return {
    sheet: sheet.name(),
    monthColumns: monthCols.map((item) => item.month_key),
    members,
    contributionCount,
    skippedRows,
  };
}

async function parseSocietyExpenseImportWorkbook(buffer, options = {}) {
  const password = options.password || '';
  const workbook = await XlsxPopulate.fromDataAsync(buffer, password ? { password } : {});
  const sheet = options.sheetName ? workbook.sheet(options.sheetName) : workbook.sheets()[0];
  if (!sheet) {
    const err = new Error('Selected sheet was not found');
    err.statusCode = 400;
    throw err;
  }
  const usedRange = sheet.usedRange();
  if (!usedRange) {
    const err = new Error('Selected sheet is empty');
    err.statusCode = 400;
    throw err;
  }
  const lastRow = usedRange.endCell().rowNumber();
  const lastCol = usedRange.endCell().columnNumber();
  let headerRow = 0;
  let cols = null;
  for (let row = 1; row <= Math.min(lastRow, 12); row++) {
    const found = {};
    for (let col = 1; col <= lastCol; col++) {
      const alias = parseSocietyExpenseHeaderAliases(normalizeExcelHeader(excelCellDisplayValue(sheet.cell(row, col))));
      if (alias) found[alias] = col;
    }
    if (found.expense_date && found.title && found.amount) {
      headerRow = row;
      cols = found;
      break;
    }
  }
  if (!headerRow || !cols) {
    const err = new Error('Could not detect society expense columns. Expected headers like Date, Comments, and Paid.');
    err.statusCode = 400;
    throw err;
  }
  const expenses = [];
  let skippedRows = 0;
  let totalAmount = 0;
  for (let row = headerRow + 1; row <= lastRow; row++) {
    const dateVal = sheet.cell(row, cols.expense_date).value();
    const title = excelCellDisplayValue(sheet.cell(row, cols.title));
    const amount = parseExcelAmount(sheet.cell(row, cols.amount).value()) || 0;
    if (!dateVal && !title && !(amount > 0)) {
      skippedRows++;
      continue;
    }
    const expenseDate = parseExcelDate(dateVal);
    if (!expenseDate || !title || !(amount > 0)) {
      skippedRows++;
      continue;
    }
    totalAmount = Math.round((totalAmount + amount) * 100) / 100;
    expenses.push({
      expense_date: expenseDate,
      month_key: expenseDate.slice(0, 7),
      title,
      category: '',
      amount,
      notes: 'Imported from Excel',
    });
  }
  return {
    sheet: sheet.name(),
    expenses,
    skippedRows,
    totalAmount,
  };
}

function normalizeSchoolKidImportNameKey(value) {
  return normalizeExcelHeader(value);
}

async function readSchoolKidWorkbook(buffer, password = '') {
  if (password) {
    const workbook = await XlsxPopulate.fromDataAsync(buffer, { password });
    const sheetNames = workbook.sheets().map((sheet) => sheet.name());
    const sheetsByName = {};
    for (const sheet of workbook.sheets()) {
      const usedRange = sheet.usedRange();
      if (!usedRange) {
        sheetsByName[sheet.name()] = [];
        continue;
      }
      const lastRow = usedRange.endCell().rowNumber();
      const lastCol = usedRange.endCell().columnNumber();
      const rows = [];
      for (let row = 1; row <= lastRow; row++) {
        const current = [];
        for (let col = 1; col <= lastCol; col++) {
          current.push(excelCellDisplayValue(sheet.cell(row, col)));
        }
        rows.push(current);
      }
      sheetsByName[sheet.name()] = rows;
    }
    return { sheetNames, sheetsByName };
  }
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheetNames = workbook.SheetNames || [];
  const sheetsByName = {};
  for (const sheetName of sheetNames) {
    sheetsByName[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: '',
    });
  }
  return { sheetNames, sheetsByName };
}

function schoolKidGridCell(grid, row, col) {
  if (!Array.isArray(grid)) return '';
  return grid?.[row - 1]?.[col - 1] ?? '';
}

function schoolKidGridMaxCol(grid) {
  return Array.isArray(grid) ? grid.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0) : 0;
}

function normalizeSchoolKidImportClassLabel(value) {
  const raw = String(value || '').trim();
  const stripped = raw.replace(/^class\s*[-:]\s*/i, '').trim();
  return stripped || raw;
}

function parseSchoolKidBlockMeta(grid, headerRow, startCol) {
  const rowValues = [];
  for (let col = startCol; col <= startCol + 4; col++) {
    rowValues.push(String(schoolKidGridCell(grid, headerRow + 1, col) || '').trim());
  }
  const nonEmpty = rowValues.filter(Boolean);
  let classLabel = '';
  const classCandidate = nonEmpty.find((value) => normalizeExcelHeader(value).startsWith('class'));
  if (classCandidate) classLabel = normalizeSchoolKidImportClassLabel(classCandidate);
  else {
    const rightSide = rowValues.slice(2).find(Boolean);
    classLabel = normalizeSchoolKidImportClassLabel(rightSide || '');
  }
  const kidName = nonEmpty.find((value) => normalizeExcelHeader(value) !== normalizeExcelHeader(classCandidate || value)) || '';
  return {
    kid_name: kidName,
    class_label: classLabel,
  };
}

function deriveSchoolKidAcademicYearFromSheetName(sheetName) {
  const match = String(sheetName || '').match(/\b(20\d{2})\b/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

function parseSchoolKidExpectedFeeBoxes(grid) {
  const lastRow = Array.isArray(grid) ? grid.length : 0;
  const lastCol = schoolKidGridMaxCol(grid);
  const boxes = [];
  for (let row = 1; row <= lastRow; row++) {
    for (let col = 1; col <= lastCol; col++) {
      const title = normalizeExcelHeader(schoolKidGridCell(grid, row, col));
      if (title !== 'expected monthly fees') continue;
      const payload = {};
      for (let r = row + 1; r <= Math.min(lastRow, row + 8); r++) {
        for (let c = col; c <= Math.min(lastCol, col + 3); c++) {
          const label = normalizeExcelHeader(schoolKidGridCell(grid, r, c));
          if (!['name', 'class', 'bus', 'month', 'other'].includes(label)) continue;
          let rawValue = null;
          let textValue = '';
          for (let cc = c + 1; cc <= Math.min(lastCol, c + 4); cc++) {
            rawValue = schoolKidGridCell(grid, r, cc);
            textValue = String(rawValue || '').trim();
            if (textValue || rawValue !== null && rawValue !== undefined && rawValue !== '') break;
          }
          if (label === 'name') payload.kid_name = textValue;
          else if (label === 'class') payload.class_label = normalizeSchoolKidImportClassLabel(textValue);
          else if (label === 'bus') payload.bus_fee = parseExcelAmount(rawValue ?? textValue) || 0;
          else if (label === 'month') payload.expected_monthly_fee = parseExcelAmount(rawValue ?? textValue) || 0;
          else if (label === 'other') payload.other_fee = parseExcelAmount(rawValue ?? textValue) || 0;
        }
      }
      if (payload.kid_name || payload.class_label) boxes.push(payload);
    }
  }
  return boxes;
}

function parseSchoolKidOverallSheet(grid) {
  const lastRow = Array.isArray(grid) ? grid.length : 0;
  const lastCol = schoolKidGridMaxCol(grid);
  const rows = [];
  const blocks = [];
  for (let row = 1; row <= Math.min(lastRow, 8); row++) {
    for (let col = 1; col <= lastCol; col++) {
      const raw = String(schoolKidGridCell(grid, row, col) || '').trim();
      if (!raw) continue;
      const match = raw.match(/^(.*)\s+Expenses$/i);
      if (!match) continue;
      const kidName = String(match[1] || '').trim();
      if (!kidName) continue;
      blocks.push({ kid_name: kidName, row, col });
    }
  }
  for (const block of blocks) {
    let headerRow = 0;
    for (let row = block.row; row <= Math.min(lastRow, block.row + 8); row++) {
      const h1 = normalizeExcelHeader(schoolKidGridCell(grid, row, block.col));
      const h2 = normalizeExcelHeader(schoolKidGridCell(grid, row, block.col + 1));
      const h3 = normalizeExcelHeader(schoolKidGridCell(grid, row, block.col + 2));
      const h4 = normalizeExcelHeader(schoolKidGridCell(grid, row, block.col + 3));
      if (h1 === 'school name' && h2 === 'year' && h3 === 'class' && h4 === 'total') {
        headerRow = row;
        break;
      }
    }
    if (!headerRow) continue;
    let blankStreak = 0;
    for (let row = headerRow + 1; row <= lastRow; row++) {
      const schoolName = String(schoolKidGridCell(grid, row, block.col) || '').trim();
      const academicYear = String(schoolKidGridCell(grid, row, block.col + 1) || '').trim();
      const classLabel = normalizeSchoolKidImportClassLabel(schoolKidGridCell(grid, row, block.col + 2));
      const total = parseExcelAmount(schoolKidGridCell(grid, row, block.col + 3)) || 0;
      if (!schoolName && !academicYear && !classLabel && !total) {
        blankStreak++;
        if (blankStreak >= 2) break;
        continue;
      }
      blankStreak = 0;
      if (!schoolName || !academicYear || !classLabel) continue;
      rows.push({
        kid_name: block.kid_name,
        school_name: schoolName,
        academic_year: academicYear,
        class_label: classLabel,
        total,
      });
    }
  }
  return rows;
}

function parseSchoolKidDetailSheet(grid, sheetName, academicYear, overallRows = []) {
  const lastRow = Array.isArray(grid) ? grid.length : 0;
  const lastCol = schoolKidGridMaxCol(grid);
  const feeBoxes = parseSchoolKidExpectedFeeBoxes(grid);
  const records = [];
  const seenBlocks = new Set();
  for (let headerRow = 1; headerRow <= Math.min(lastRow, 4); headerRow++) {
    for (let startCol = 1; startCol <= lastCol - 4; startCol++) {
      const h1 = normalizeExcelHeader(schoolKidGridCell(grid, headerRow, startCol));
      const h2 = normalizeExcelHeader(schoolKidGridCell(grid, headerRow, startCol + 1));
      const h3 = normalizeExcelHeader(schoolKidGridCell(grid, headerRow, startCol + 2));
      const h4 = normalizeExcelHeader(schoolKidGridCell(grid, headerRow, startCol + 3));
      const h5 = normalizeExcelHeader(schoolKidGridCell(grid, headerRow, startCol + 4));
      if (!(h1 === 'date' && h2 === 'thing' && h3 === 'amount' && h4 === 'month' && h5 === 'expenses')) continue;
      const blockKey = `${headerRow}:${startCol}`;
      if (seenBlocks.has(blockKey)) continue;
      seenBlocks.add(blockKey);
      const meta = parseSchoolKidBlockMeta(grid, headerRow, startCol);
      const kidName = meta.kid_name;
      const classLabel = meta.class_label;
      if (!kidName || !classLabel) continue;
      const overallMatch = overallRows.find((row) =>
        normalizeSchoolKidImportNameKey(row.kid_name) === normalizeSchoolKidImportNameKey(kidName)
        && normalizeExcelHeader(row.class_label) === normalizeExcelHeader(classLabel)
        && String(row.academic_year || '').trim() === String(academicYear || '').trim()
      ) || overallRows.find((row) =>
        normalizeSchoolKidImportNameKey(row.kid_name) === normalizeSchoolKidImportNameKey(kidName)
        && normalizeExcelHeader(row.class_label) === normalizeExcelHeader(classLabel)
      );
      const feeBox = feeBoxes.find((box) =>
        normalizeSchoolKidImportNameKey(box.kid_name) === normalizeSchoolKidImportNameKey(kidName)
        && normalizeExcelHeader(box.class_label) === normalizeExcelHeader(classLabel)
      ) || {};
      const expenses = [];
      let blankStreak = 0;
      for (let row = headerRow + 3; row <= lastRow; row++) {
        const dateVal = schoolKidGridCell(grid, row, startCol);
        const itemName = String(schoolKidGridCell(grid, row, startCol + 1) || '').trim();
        const amount = parseExcelAmount(schoolKidGridCell(grid, row, startCol + 2)) || 0;
        if (!dateVal && !itemName && !amount) {
          blankStreak++;
          if (expenses.length && blankStreak >= 2) break;
          continue;
        }
        blankStreak = 0;
        const expenseDate = parseExcelDate(dateVal);
        if (!expenseDate || !itemName || !(amount > 0)) continue;
        expenses.push({
          expense_date: expenseDate,
          item_name: itemName,
          amount,
          notes: `Imported from Excel (${sheetName})`,
        });
      }
      records.push({
        kid_name: kidName,
        school_name: overallMatch?.school_name || 'Imported School',
        academic_year: academicYear,
        class_label: classLabel,
        expected_monthly_fee: Number(feeBox.expected_monthly_fee || 0),
        bus_fee: Number(feeBox.bus_fee || 0),
        other_fee: Number(feeBox.other_fee || 0),
        details: `Imported from sheet ${sheetName}`,
        expenses,
      });
    }
  }
  return records;
}

async function parseSchoolKidImportWorkbook(buffer, options = {}) {
  const password = options.password || '';
  const workbook = await readSchoolKidWorkbook(buffer, password);
  const requestedSheets = Array.isArray(options.sheets) ? options.sheets.filter(Boolean) : [];
  const selectedNames = requestedSheets.length ? requestedSheets : workbook.sheetNames;
  const overallSheetName = workbook.sheetNames.find((name) => normalizeExcelHeader(name) === 'overall');
  const overallRows = overallSheetName ? parseSchoolKidOverallSheet(workbook.sheetsByName[overallSheetName]) : [];
  const classRecords = [];
  const skippedSheets = [];
  for (const sheetName of selectedNames) {
    const grid = workbook.sheetsByName[sheetName];
    if (!grid) continue;
    if (normalizeExcelHeader(sheetName) === 'overall') continue;
    const academicYear = deriveSchoolKidAcademicYearFromSheetName(sheetName);
    if (!academicYear) {
      skippedSheets.push(sheetName);
      continue;
    }
    const parsedRows = parseSchoolKidDetailSheet(grid, sheetName, academicYear, overallRows);
    if (!parsedRows.length) {
      skippedSheets.push(sheetName);
      continue;
    }
    classRecords.push(...parsedRows);
  }
  const kidCount = new Set(classRecords.map((row) => normalizeSchoolKidImportNameKey(row.kid_name))).size;
  const expenseCount = classRecords.reduce((sum, row) => sum + row.expenses.length, 0);
  return {
    sheets: selectedNames,
    classRecords,
    kidCount,
    expenseCount,
    skippedSheets,
  };
}
