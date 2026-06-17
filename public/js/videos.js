let _videoLibraryLoading = false;
let _videoLibraryData = { configured: false, root_exists: true, settings: null, videos: [], message: '', subtitle_engine: { available: false, message: '' } };
let _selectedVideoLibraryId = '';
let _videoLibrarySearch = '';
let _selectedVideoSubtitleId = '';
let _selectedVideoFolder = '';
let _videoProgressBoundVideoId = '';
let _videoProgressSaveTimer = null;
let _videoCatalogModalState = {
  path: '',
  status: 'all',
  items: [],
  loading: false,
  aiLoading: false,
  revealTimer: null,
  scanNotice: '',
  abortController: null,
  cancelRequested: false,
  busyKind: '',
};
let _videoLibraryMediaFilter = 'all';
let _videoLibraryGenreFilter = 'all';
let _videoDetailSeasonKey = '';
let _videoPlaylistScrollState = { top: 0 };
let _selectedVideoAudioTrackId = '';
let _videoPendingSourceState = null;
let _videoAudioStreamOffsetSeconds = 0;
let _videoAltAudioOutputMuted = false;
let _videoAltAudioReady = false;
let _videoAltAudioSeekMode = 'pending';
let _videoAudioSwitchLoading = false;
let _videoAudioSwitchRequestId = 0;
let _videoAudioSwitchAbortController = null;
let _videoJsAssetsPromise = null;
let _videoJsPlayer = null;
let _videoPlaybackUiAnchorSeconds = 0;
let _videoPlaybackUiAnchorStartedAtMs = 0;
let _videoSeekRequestId = 0;
let _videoSubtitleCueData = [];
let _videoSubtitleLoadedTrackId = '';
let _videoSubtitleLoadRequestId = 0;
const VIDEO_AUDIO_PREFS_STORAGE_KEY = 'videoLibraryAudioTrackPrefs';

function videoControlIcon(kind) {
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h4v12H7zm6 0h4v12h-4z" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.5 6.8V9a4.8 4.8 0 1 1-3.42 1.42" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m11.5 6.8-3.7 2.7 3.7 2.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="12.7" y="16.2" font-size="6.2" font-weight="700" text-anchor="middle" fill="currentColor">10</text></svg>',
    forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 6.8V9a4.8 4.8 0 1 0 3.42 1.42" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m12.5 6.8 3.7 2.7-3.7 2.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="11.3" y="16.2" font-size="6.2" font-weight="700" text-anchor="middle" fill="currentColor">10</text></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h4l5-4v14l-5-4H5z" fill="currentColor"/><path d="m17 9 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h4l5-4v14l-5-4H5z" fill="currentColor"/><path d="M17 9.5a4 4 0 0 1 0 5M19 7a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
    subtitle: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.2 11.2c.3-.9 1.1-1.5 2.1-1.5.9 0 1.5.34 2 .9l-1 .9c-.28-.3-.57-.47-.97-.47-.65 0-1.13.45-1.13 1.12v.8c0 .67.48 1.12 1.13 1.12.4 0 .69-.16.97-.47l1 .9c-.5.56-1.11.9-2 .9-1 0-1.8-.6-2.1-1.5m6.7 0c.3-.9 1.1-1.5 2.1-1.5.9 0 1.5.34 2 .9l-1 .9c-.28-.3-.57-.47-.97-.47-.65 0-1.13.45-1.13 1.12v.8c0 .67.48 1.12 1.13 1.12.4 0 .69-.16.97-.47l1 .9c-.5.56-1.11.9-2 .9-1 0-1.8-.6-2.1-1.5" fill="currentColor"/></svg>',
    speed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m12 12 5-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M20 20h-4v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  return icons[kind] || '';
}

function videoFormatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function videoProgressLabel(progress) {
  if (!progress) return '';
  if (progress.is_completed) return 'Completed';
  if (Number(progress.current_seconds || 0) > 0) return `Continue ${videoFormatTime(progress.current_seconds || 0)}`;
  return '';
}

function videoProgressPercent(progress) {
  const percent = Number(progress?.progress_percent || 0);
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(100, Math.max(0, percent));
}

function videoLibraryFormatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 B';
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function videoLibraryFilteredVideos() {
  const list = Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos : [];
  const query = String(_videoLibrarySearch || '').trim().toLowerCase();
  return list.filter((video) => {
    if (_videoLibraryMediaFilter === 'movie' && videoLibraryIsSeries(video)) return false;
    if (_videoLibraryMediaFilter === 'series' && !videoLibraryIsSeries(video)) return false;
    if (_videoLibraryGenreFilter !== 'all') {
      const genres = Array.isArray(video?.genres) ? video.genres.map((genre) => String(genre || '').trim().toLowerCase()).filter(Boolean) : [];
      if (!genres.includes(String(_videoLibraryGenreFilter || '').trim().toLowerCase())) return false;
    }
    if (!query) return true;
    const haystack = [
      video.title,
      video.catalog_title,
      video.filename,
      video.folder,
      video.relative_path,
      video.media_type,
      ...(Array.isArray(video.genres) ? video.genres : []),
      ...(Array.isArray(video.cast_members) ? video.cast_members : []),
      ...(Array.isArray(video.creators) ? video.creators : []),
      ...(Array.isArray(video.tags) ? video.tags : []),
      video.synopsis,
      video.original_language,
      video.country,
      video.content_rating,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function setVideoLibraryMediaFilter(value) {
  _videoLibraryMediaFilter = ['all', 'movie', 'series'].includes(String(value || '')) ? String(value || '') : 'all';
  const filtered = videoLibraryFilteredVideos();
  if (filtered.length && !filtered.some((video) => String(video.id) === String(_selectedVideoLibraryId))) {
    _selectedVideoLibraryId = String(filtered[0].id || '');
  }
  renderVideosPage();
}

function setVideoLibraryGenreFilter(value) {
  _videoLibraryGenreFilter = String(value || '').trim() || 'all';
  const filtered = videoLibraryFilteredVideos();
  if (filtered.length && !filtered.some((video) => String(video.id) === String(_selectedVideoLibraryId))) {
    _selectedVideoLibraryId = String(filtered[0].id || '');
  }
  renderVideosPage();
}

function videoLibraryFolders() {
  const list = Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos : [];
  const counts = new Map();
  list.forEach((video) => {
    const folder = String(video.folder || '').trim();
    const rootFolder = folder ? folder.split('/')[0] : '';
    const key = rootFolder || '';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => String(a[0] || '').localeCompare(String(b[0] || '')))
    .map(([folder, count]) => ({
      folder,
      label: folder || 'Root',
      count,
    }));
}

function videoLibrarySelectedVideo() {
  const list = Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos : [];
  return list.find((video) => String(video.id) === String(_selectedVideoLibraryId)) || null;
}

function loadVideoAudioTrackPrefs() {
  try {
    const raw = localStorage.getItem(VIDEO_AUDIO_PREFS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function videoAudioTrackPreferenceKey(video) {
  const relativePath = String(video?.relative_path || '').trim();
  const itemId = String(video?.item_id || '').trim();
  return relativePath || itemId || '';
}

function normalizeVideoAudioTrackSelection(video, trackId = '') {
  const selected = String(trackId || '').trim();
  if (!selected) return '';
  const defaultTrack = videoLibraryDefaultAudioTrack(video);
  return String(defaultTrack?.id || '') === selected ? '' : selected;
}

function getSavedVideoAudioTrackId(video) {
  const key = videoAudioTrackPreferenceKey(video);
  if (!key) return '';
  const prefs = loadVideoAudioTrackPrefs();
  return normalizeVideoAudioTrackSelection(video, String(prefs[key] || '').trim());
}

function saveVideoAudioTrackPreference(video, trackId = '') {
  const key = videoAudioTrackPreferenceKey(video);
  if (!key) return;
  try {
    const prefs = loadVideoAudioTrackPrefs();
    const normalizedTrackId = normalizeVideoAudioTrackSelection(video, trackId);
    if (normalizedTrackId) prefs[key] = String(normalizedTrackId);
    else delete prefs[key];
    localStorage.setItem(VIDEO_AUDIO_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (_err) {}
}

function restoreVideoLibrarySearchFocus(selectionStart = null, selectionEnd = null) {
  requestAnimationFrame(() => {
    const input = document.getElementById('videoLibrarySearchInput');
    if (!input) return;
    input.focus({ preventScroll: true });
    if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
      try { input.setSelectionRange(selectionStart, selectionEnd); } catch (_err) {}
    }
  });
}

function setVideoLibrarySearch(value) {
  const active = document.activeElement;
  const shouldRestoreFocus = active?.id === 'videoLibrarySearchInput';
  const selectionStart = shouldRestoreFocus ? Number(active.selectionStart) : null;
  const selectionEnd = shouldRestoreFocus ? Number(active.selectionEnd) : null;
  _videoLibrarySearch = String(value || '');
  const filtered = videoLibraryFilteredVideos();
  if (filtered.length && !filtered.some((video) => String(video.id) === String(_selectedVideoLibraryId))) {
    _selectedVideoLibraryId = String(filtered[0].id || '');
  }
  renderVideosPage();
  if (shouldRestoreFocus) restoreVideoLibrarySearchFocus(selectionStart, selectionEnd);
}

function rememberVideoPlaylistScroll(videoId = '') {
  const list = document.querySelector('.videos-playlist-list');
  if (list) {
    _videoPlaylistScrollState = {
      top: Number(list.scrollTop || 0),
    };
  }
}

function restoreVideoPlaylistScroll() {
  const list = document.querySelector('.videos-playlist-list');
  if (list) {
    list.scrollTop = Number(_videoPlaylistScrollState?.top || 0);
  }
}

function selectVideoLibraryItem(videoId) {
  rememberVideoPlaylistScroll(videoId);
  flushVideoPlaybackProgress().finally(() => {
    _selectedVideoLibraryId = String(videoId || '');
    _selectedVideoSubtitleId = '';
    _selectedVideoAudioTrackId = '';
    _videoPendingSourceState = null;
    _videoAudioStreamOffsetSeconds = 0;
    _videoAltAudioOutputMuted = false;
    clearVideoLibraryAltAudioPlayer();
    renderVideosPage();
  });
}

function selectVideoLibraryFolder(folder) {
  flushVideoPlaybackProgress().finally(() => {
    _selectedVideoFolder = String(folder || '');
    const filtered = videoLibraryFilteredVideos();
    if (filtered.length) {
      _selectedVideoLibraryId = String(filtered[0].id || '');
    } else {
      _selectedVideoLibraryId = '';
    }
    _selectedVideoSubtitleId = '';
    _selectedVideoAudioTrackId = '';
    _videoPendingSourceState = null;
    _videoAudioStreamOffsetSeconds = 0;
    _videoAltAudioOutputMuted = false;
    clearVideoLibraryAltAudioPlayer();
    renderVideosPage();
  });
}

function videoLibrarySubtitleTracks(video) {
  const subtitles = Array.isArray(video?.subtitles) ? video.subtitles : [];
  return subtitles.map((subtitle) => `
    <track
      src="${escHtml(`/api/videos/subtitles/${encodeURIComponent(subtitle.id)}`)}"
      kind="subtitles"
      srclang="${escHtml(subtitle.srclang || 'en')}"
      label="${escHtml(subtitle.label || 'Subtitles')}"
      data-subtitle-id="${escHtml(String(subtitle.id || ''))}"
    >`).join('');
}

function videoLibraryAudioTracks(video) {
  return Array.isArray(video?.audio_tracks) ? video.audio_tracks.filter((track) => Number(track?.stream_index) >= 0) : [];
}

function videoLibraryDefaultAudioTrack(video) {
  const tracks = videoLibraryAudioTracks(video);
  return tracks.find((track) => track.is_default) || tracks[0] || null;
}

function buildVideoStreamUrl(video, audioTrackId = '', startSeconds = 0) {
  const baseUrl = String(video?.stream_url || '').trim();
  if (!baseUrl) return '';
  const trackId = String(audioTrackId || '').trim();
  const params = [];
  if (trackId) {
    const rawStreamIndex = trackId.startsWith('audio:') ? trackId.slice(6) : trackId;
    if (/^\d+$/.test(rawStreamIndex)) params.push(`audio_stream=${encodeURIComponent(rawStreamIndex)}`);
  }
  const safeStart = Math.max(0, Number(startSeconds || 0));
  if (safeStart > 0.01) params.push(`start_seconds=${encodeURIComponent(safeStart.toFixed(3))}`);
  if (!params.length) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.join('&')}`;
}

function buildVideoHlsUrl(video, audioTrackId = '') {
  const baseUrl = String(video?.hls_url || '').trim() || `/api/videos/hls/${encodeURIComponent(String(video?.id || ''))}/master.m3u8`;
  const fallbackTrackId = !audioTrackId
    ? String(videoLibraryDefaultAudioTrack(video)?.id || '').trim()
    : '';
  const trackId = String(audioTrackId || fallbackTrackId || '').trim();
  if (!baseUrl || !trackId) return baseUrl;
  const rawStreamIndex = trackId.startsWith('audio:') ? trackId.slice(6) : trackId;
  if (!/^\d+$/.test(rawStreamIndex)) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}audio_stream=${encodeURIComponent(rawStreamIndex)}`;
}

function buildVideoMobileStreamUrl(video) {
  const token = encodeURIComponent(String(video?.id || '').trim());
  return token ? `/api/videos/mobile-stream/${token}?platform=web&transcode=1` : '';
}

function guessVideoMimeType(video) {
  const explicitMime = String(video?.mime_type || '').trim();
  if (explicitMime) return explicitMime;
  const filename = String(video?.filename || '').trim().toLowerCase();
  if (filename.endsWith('.mp4') || filename.endsWith('.m4v')) return 'video/mp4';
  if (filename.endsWith('.webm')) return 'video/webm';
  if (filename.endsWith('.ogg') || filename.endsWith('.ogv')) return 'video/ogg';
  if (filename.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

function getPlayableVideoSource(video, audioTrackId = '') {
  const normalizedAudioTrackId = String(audioTrackId || '').trim();
  const directStreamUrl = buildVideoStreamUrl(video, normalizedAudioTrackId);
  if (directStreamUrl) {
    return {
      src: directStreamUrl,
      type: 'video/mp4',
    };
  }
  return { src: '', type: 'video/mp4' };
}

function videoUsesHlsPlayback(video = videoLibrarySelectedVideo(), audioTrackId = '') {
  return false;
}

function ensureVideoJsAssetsLoaded() {
  if (window.videojs) return Promise.resolve(window.videojs);
  if (_videoJsAssetsPromise) return _videoJsAssetsPromise;

  if (!document.querySelector('link[data-videojs="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/vendor/videojs/video-js.css';
    link.dataset.videojs = '1';
    document.head.appendChild(link);
  }

  _videoJsAssetsPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-videojs="1"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.videojs), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Could not load Video.js')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = '/vendor/videojs/video.min.js';
    script.dataset.videojs = '1';
    script.onload = () => resolve(window.videojs);
    script.onerror = () => reject(new Error('Could not load Video.js'));
    document.head.appendChild(script);
  });

  return _videoJsAssetsPromise;
}

function buildVideoAltAudioUrl(video, audioTrackId = '', startSeconds = 0) {
  const baseUrl = String(video?.stream_url || '').trim();
  const trackId = String(audioTrackId || '').trim();
  if (!baseUrl || !trackId) return '';
  const rawStreamIndex = trackId.startsWith('audio:') ? trackId.slice(6) : trackId;
  if (!/^\d+$/.test(rawStreamIndex)) return '';
  const params = [`audio_stream=${encodeURIComponent(rawStreamIndex)}`, 'audio_only=1'];
  const safeStart = Math.max(0, Number(startSeconds || 0));
  if (safeStart > 0.01) params.push(`start_seconds=${encodeURIComponent(safeStart.toFixed(3))}`);
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.join('&')}`;
}

function setVideoPlaybackUiAnchor(seconds = 0) {
  _videoPlaybackUiAnchorSeconds = Math.max(0, Number(seconds || 0));
  _videoPlaybackUiAnchorStartedAtMs = _videoPlaybackUiAnchorSeconds > 0 ? Date.now() : 0;
}

function videoPlaybackUiAnchorCurrent(player = getVideoLibraryPlayer()) {
  const base = Math.max(0, Number(_videoPlaybackUiAnchorSeconds || 0));
  if (!(base > 0)) return 0;
  if (_videoPlaybackUiAnchorStartedAtMs > 0 && !videoPlayerIsPaused(player)) {
    return base + ((Date.now() - _videoPlaybackUiAnchorStartedAtMs) / 1000);
  }
  return base;
}

function freezeVideoPlaybackUiAnchor(player = getVideoLibraryPlayer()) {
  _videoPlaybackUiAnchorSeconds = videoPlaybackUiAnchorCurrent(player);
  _videoPlaybackUiAnchorStartedAtMs = 0;
}

function resumeVideoPlaybackUiAnchor(player = getVideoLibraryPlayer()) {
  if (Number(_videoPlaybackUiAnchorSeconds || 0) > 0) {
    _videoPlaybackUiAnchorStartedAtMs = Date.now();
  }
}

function videoPlayerIsAltAudioActive() {
  const altAudio = getVideoLibraryAltAudioPlayer();
  return !!(altAudio && String(altAudio.getAttribute('src') || '').trim());
}

function videoPlayerCurrentSeconds(player = getVideoLibraryPlayer(), video = videoLibrarySelectedVideo()) {
  const nativeCurrentTime = Number(player?.currentTime || 0);
  if (Number.isFinite(nativeCurrentTime) && nativeCurrentTime > 0) {
    return Math.max(0, nativeCurrentTime);
  }
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.currentTime === 'function') {
    const liveCurrentTime = Number(instance.currentTime() || 0);
    if (Number.isFinite(liveCurrentTime) && liveCurrentTime > 0) {
      return Math.max(0, liveCurrentTime);
    }
  }
  if (videoUsesHlsPlayback(video, _selectedVideoAudioTrackId)) {
    const anchored = videoPlaybackUiAnchorCurrent(player);
    if (anchored > 0) return anchored;
  }
  return Math.max(0, Number(nativeCurrentTime || 0));
}

function getVideoLibraryAltAudioPlayer() {
  return document.getElementById('videoLibraryAltAudio');
}

function getVideoLibraryPlayerInstance() {
  if (_videoJsPlayer && !(typeof _videoJsPlayer.isDisposed === 'function' && _videoJsPlayer.isDisposed())) {
    return _videoJsPlayer;
  }
  if (window.videojs && typeof window.videojs.getPlayer === 'function') {
    const existingPlayer = window.videojs.getPlayer('videoLibraryPlayer');
    if (existingPlayer && !(typeof existingPlayer.isDisposed === 'function' && existingPlayer.isDisposed())) {
      _videoJsPlayer = existingPlayer;
      return existingPlayer;
    }
  }
  return null;
}

function getVideoLibraryTextTracks() {
  const nativePlayer = getVideoLibraryPlayer();
  return nativePlayer?.textTracks ? [...nativePlayer.textTracks] : [];
}

function getVideoSubtitleOverlay() {
  return document.getElementById('videoSubtitleOverlay');
}

function clearVideoSubtitleOverlay() {
  const overlay = getVideoSubtitleOverlay();
  if (!overlay) return;
  overlay.innerHTML = '';
  overlay.classList.remove('active');
}

function parseVideoSubtitleTime(value = '') {
  const normalized = String(value || '').trim().replace(',', '.');
  if (!normalized) return NaN;
  const parts = normalized.split(':').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return NaN;
  const secondsPart = Number(parts.pop() || 0);
  const minutesPart = Number(parts.pop() || 0);
  const hoursPart = Number(parts.pop() || 0);
  if (![secondsPart, minutesPart, hoursPart].every((num) => Number.isFinite(num))) return NaN;
  return (hoursPart * 3600) + (minutesPart * 60) + secondsPart;
}

function parseVideoSubtitleCues(raw = '') {
  const normalized = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!normalized) return [];
  const body = normalized.replace(/^WEBVTT[^\n]*\n+/i, '');
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trimEnd());
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) return null;
      const timingLine = lines[timingIndex];
      const [startRaw, endRaw] = timingLine.split('-->').map((part) => String(part || '').trim().split(/\s+/)[0]);
      const start = parseVideoSubtitleTime(startRaw);
      const end = parseVideoSubtitleTime(endRaw);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      const text = lines.slice(timingIndex + 1).join('\n').trim();
      if (!text) return null;
      return { start, end, text };
    })
    .filter(Boolean);
}

async function loadVideoSubtitleCueData(subtitleId = '') {
  const selectedId = String(subtitleId || '').trim();
  const requestId = ++_videoSubtitleLoadRequestId;
  if (!selectedId) {
    _videoSubtitleCueData = [];
    _videoSubtitleLoadedTrackId = '';
    clearVideoSubtitleOverlay();
    return;
  }
  if (selectedId === _videoSubtitleLoadedTrackId && _videoSubtitleCueData.length) {
    renderVideoSubtitleCue();
    return;
  }
  try {
    const raw = await fetch(`/api/videos/subtitles/${encodeURIComponent(selectedId)}`, { credentials: 'same-origin' }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load subtitles');
      return response.text();
    });
    if (requestId !== _videoSubtitleLoadRequestId) return;
    _videoSubtitleCueData = parseVideoSubtitleCues(raw);
    _videoSubtitleLoadedTrackId = selectedId;
    renderVideoSubtitleCue();
  } catch (_err) {
    if (requestId !== _videoSubtitleLoadRequestId) return;
    _videoSubtitleCueData = [];
    _videoSubtitleLoadedTrackId = '';
    clearVideoSubtitleOverlay();
  }
}

function renderVideoSubtitleCue() {
  const overlay = getVideoSubtitleOverlay();
  const player = getVideoLibraryPlayer();
  const selectedVideo = videoLibrarySelectedVideo();
  if (!overlay || !player || !_selectedVideoSubtitleId || !_videoSubtitleCueData.length) {
    clearVideoSubtitleOverlay();
    return;
  }
  const current = videoPlayerCurrentSeconds(player, selectedVideo);
  const activeCue = _videoSubtitleCueData.find((cue) => current >= cue.start && current <= cue.end);
  if (!activeCue?.text) {
    clearVideoSubtitleOverlay();
    return;
  }
  overlay.innerHTML = String(activeCue.text)
    .split('\n')
    .map((line) => escHtml(line))
    .join('<br>');
  overlay.classList.add('active');
}

function disposeVideoLibraryPlayer() {
  const player = getVideoLibraryPlayerInstance();
  if (!player || typeof player.dispose !== 'function') return;
  try { player.dispose(); } catch (_err) {}
  _videoJsPlayer = null;
}

function resetVideoLibraryPlayerElement(playerEl) {
  if (!playerEl) return;
  _videoSeekRequestId += 1;
  try { playerEl.pause(); } catch (_err) {}
  try { playerEl.removeAttribute('src'); } catch (_err) {}
  try { playerEl.src = ''; } catch (_err) {}
  try { playerEl.currentTime = 0; } catch (_err) {}
  try { playerEl.load(); } catch (_err) {}
  delete playerEl.dataset.progressBound;
  playerEl.dataset.resumeApplied = '0';
}

async function initializeVideoLibraryPlayer(video, audioTrackId = '') {
  const playerEl = document.getElementById('videoLibraryPlayer');
  if (!playerEl) return null;
  const source = getPlayableVideoSource(video, audioTrackId);
  disposeVideoLibraryPlayer();
  resetVideoLibraryPlayerElement(playerEl);
  playerEl.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
  playerEl.setAttribute('disablepictureinpicture', 'true');
  playerEl.setAttribute('disableremoteplayback', 'true');
  playerEl.oncontextmenu = () => false;
  if (source?.type) {
    playerEl.setAttribute('type', source.type);
  } else {
    playerEl.removeAttribute('type');
  }
  playerEl.src = source?.src || '';
  playerEl.load();
  return null;
}

function videoPlayerIsPaused(player = getVideoLibraryPlayer()) {
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.paused === 'function') {
    return !!instance.paused();
  }
  return !!player?.paused;
}

function videoPlayerIsMuted(player = getVideoLibraryPlayer()) {
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.muted === 'function') {
    return !!instance.muted();
  }
  return !!player?.muted;
}

function setVideoPlayerMuted(value) {
  const muted = !!value;
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.muted === 'function') {
    instance.muted(muted);
    return;
  }
  const player = getVideoLibraryPlayer();
  if (player) player.muted = muted;
}

function videoPlayerPlaybackRate(player = getVideoLibraryPlayer()) {
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.playbackRate === 'function') {
    return Number(instance.playbackRate() || 1);
  }
  return Number(player?.playbackRate || 1);
}

function setVideoPlayerPlaybackRate(value) {
  const rate = Number(value || 1);
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.playbackRate === 'function') {
    instance.playbackRate(rate);
    return;
  }
  const player = getVideoLibraryPlayer();
  if (player) player.playbackRate = rate;
}

function setVideoPlayerCurrentTime(value, options = {}) {
  const time = Math.max(0, Number(value || 0));
  const retry = options?.retry !== false;
  const requestId = ++_videoSeekRequestId;
  const applySeek = (attempt = 0) => {
    if (requestId !== _videoSeekRequestId) return;
    const player = getVideoLibraryPlayer();
    const activeVideo = videoLibrarySelectedVideo();
    const instance = getVideoLibraryPlayerInstance();
    if (instance && typeof instance.currentTime === 'function') {
      try { instance.currentTime(time); } catch (_err) {}
      if (videoUsesHlsPlayback(activeVideo, _selectedVideoAudioTrackId)) setVideoPlaybackUiAnchor(time);
      return;
    }
    if (player) {
      try {
        if (typeof player.fastSeek === 'function' && time > 0) player.fastSeek(time);
        else player.currentTime = time;
      } catch (_err) {
        try { player.currentTime = time; } catch (_err2) {}
      }
    }
    if (videoUsesHlsPlayback(activeVideo, _selectedVideoAudioTrackId)) setVideoPlaybackUiAnchor(time);
    if (!retry || !player || attempt >= 8) return;
    setTimeout(() => {
      if (requestId !== _videoSeekRequestId) return;
      const current = videoPlayerCurrentSeconds(player, activeVideo);
      if (Math.abs(current - time) <= 1.25) return;
      applySeek(attempt + 1);
    }, 140);
  };

  applySeek(0);
}

function videoPlayerPlay() {
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.play === 'function') {
    return instance.play();
  }
  const player = getVideoLibraryPlayer();
  if (!player || typeof player.play !== 'function') return Promise.resolve();
  return player.play();
}

function videoPlayerPause() {
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.pause === 'function') {
    instance.pause();
    return;
  }
  const player = getVideoLibraryPlayer();
  if (player && typeof player.pause === 'function') player.pause();
}

function videoPlayerRequestFullscreen() {
  const instance = getVideoLibraryPlayerInstance();
  if (instance && typeof instance.requestFullscreen === 'function') {
    return instance.requestFullscreen();
  }
  const player = getVideoLibraryPlayer();
  if (player && typeof player.requestFullscreen === 'function') {
    return player.requestFullscreen();
  }
  return Promise.resolve();
}

function setVideoLibraryPlayerSource(video, audioTrackId = '') {
  const source = getPlayableVideoSource(video, audioTrackId);
  const playerEl = getVideoLibraryPlayer();
  const playerInstance = getVideoLibraryPlayerInstance();
  if (!playerEl) return;
  if (_videoPendingSourceState?.reason === 'audio-switch') {
    const pendingSnapshot = {
      ..._videoPendingSourceState,
    };
    let restoreAttempts = 0;
    let restoreTimer = null;
    const clearRestoreTimer = () => {
      if (restoreTimer) {
        clearInterval(restoreTimer);
        restoreTimer = null;
      }
    };
    const restorePlaybackState = () => {
      const activeVideo = videoLibrarySelectedVideo();
      const activePlayer = getVideoLibraryPlayer();
      if (!activeVideo || !activePlayer) return;
      setVideoPlayerMuted(!!pendingSnapshot.muted);
      if (Number.isFinite(Number(pendingSnapshot.playbackRate || 0)) && Number(pendingSnapshot.playbackRate || 0) > 0) {
        setVideoPlayerPlaybackRate(Number(pendingSnapshot.playbackRate || 1));
      }
      const resumeAt = Math.max(0, Number(pendingSnapshot.currentTime || 0));
      const expectedDuration = Math.max(
        Number(pendingSnapshot.expectedDuration || 0),
        Number(videoPlayerExpectedDuration(activePlayer, activeVideo) || 0)
      );
      const canSeekToResumePoint = resumeAt <= 0 || expectedDuration > Math.min(resumeAt + 1, 5);
      if (resumeAt > 0 && canSeekToResumePoint) {
        setVideoPlayerCurrentTime(resumeAt);
      }
      const currentTime = videoPlayerCurrentSeconds(activePlayer, activeVideo);
      const seekSettled = resumeAt <= 0 || Math.abs(currentTime - resumeAt) <= 2;
      if (!seekSettled && restoreAttempts < 20) {
        restoreAttempts += 1;
        return;
      }
      if (pendingSnapshot.wasPlaying) {
        videoPlayerPlay().catch(() => {});
      }
      clearRestoreTimer();
      _videoPendingSourceState = null;
      updateVideoControlsUI();
    };
    clearRestoreTimer();
    restoreTimer = setInterval(() => {
      if (!_videoPendingSourceState || _videoPendingSourceState.reason !== 'audio-switch') {
        clearRestoreTimer();
        return;
      }
      restorePlaybackState();
    }, 250);
    if (playerInstance && typeof playerInstance.one === 'function') {
      playerInstance.one('loadedmetadata', restorePlaybackState);
      playerInstance.one('durationchange', restorePlaybackState);
      playerInstance.one('canplay', restorePlaybackState);
    } else {
      playerEl.addEventListener('loadedmetadata', restorePlaybackState, { once: true });
      playerEl.addEventListener('durationchange', restorePlaybackState, { once: true });
      playerEl.addEventListener('canplay', restorePlaybackState, { once: true });
    }
  }
  if (playerInstance) {
    disposeVideoLibraryPlayer();
  }
  resetVideoLibraryPlayerElement(playerEl);
  if (source?.type) {
    playerEl.setAttribute('type', source.type);
  } else {
    playerEl.removeAttribute('type');
  }
  playerEl.src = source?.src || '';
  playerEl.load();
}

function ensureVideoLibraryAltAudioPlayer() {
  let audio = getVideoLibraryAltAudioPlayer();
  if (audio) return audio;
  audio = document.createElement('audio');
  audio.id = 'videoLibraryAltAudio';
  audio.preload = 'auto';
  audio.style.display = 'none';
  audio.setAttribute('aria-hidden', 'true');
  document.body.appendChild(audio);
  return audio;
}

function clearVideoLibraryAltAudioPlayer() {
  const audio = getVideoLibraryAltAudioPlayer();
  if (!audio) return;
  _videoAltAudioReady = false;
  _videoAltAudioSeekMode = 'pending';
  try { audio.pause(); } catch (_err) {}
  delete audio.dataset.autoplayPending;
  delete audio.dataset.desiredMuted;
  audio.removeAttribute('src');
  try { audio.load(); } catch (_err) {}
}

function cancelPendingVideoAudioSwitch() {
  _videoAudioSwitchRequestId += 1;
  _videoAudioSwitchLoading = false;
  if (_videoAudioSwitchAbortController) {
    try { _videoAudioSwitchAbortController.abort(); } catch (_err) {}
  }
  _videoAudioSwitchAbortController = null;
}

function syncAltAudioPlayerWithVideo(forceSeek = false) {
  const player = getVideoLibraryPlayer();
  const video = videoLibrarySelectedVideo();
  const altAudio = getVideoLibraryAltAudioPlayer();
  if (!player || !video || !altAudio || !videoPlayerIsAltAudioActive()) return;
  player.muted = _videoAltAudioReady ? true : !!_videoAltAudioOutputMuted;
  altAudio.dataset.desiredMuted = _videoAltAudioOutputMuted ? '1' : '0';
  altAudio.muted = _videoAltAudioReady ? !!_videoAltAudioOutputMuted : true;
  altAudio.playbackRate = Number(player.playbackRate || 1);
  const targetOffset = Math.max(0, Number(_videoAudioStreamOffsetSeconds || 0));
  const syncTarget = _videoAltAudioSeekMode === 'full'
    ? Math.max(0, Number(player.currentTime || 0))
    : Math.max(0, Number(player.currentTime || 0) - targetOffset);
  const drift = Math.abs(Number(altAudio.currentTime || 0) - syncTarget);
  if (forceSeek && drift > 0.35) {
    try { altAudio.currentTime = syncTarget; } catch (_err) {}
  }
  if (player.paused) {
    try { altAudio.pause(); } catch (_err) {}
  } else if (altAudio.paused) {
    altAudio.play().catch(() => {});
  }
}

function loadAltAudioAt(video, startSeconds, autoplay = true) {
  const player = getVideoLibraryPlayer();
  if (!player || !video || !videoPlayerIsAltAudioActive()) return;
  const altAudio = ensureVideoLibraryAltAudioPlayer();
  const tryPlayAltAudio = () => {
    if (!autoplay || player.paused) return;
    const playPromise = altAudio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise
        .then(() => {
          delete altAudio.dataset.autoplayPending;
        })
        .catch(() => {
          altAudio.dataset.autoplayPending = '1';
        });
    }
  };
  const target = Math.max(0, Number(startSeconds || 0));
  _videoAudioStreamOffsetSeconds = target;
  _videoAltAudioReady = false;
  _videoAltAudioSeekMode = 'pending';
  player.muted = !!_videoAltAudioOutputMuted;
  altAudio.dataset.desiredMuted = _videoAltAudioOutputMuted ? '1' : '0';
  altAudio.muted = true;
  altAudio.playbackRate = Number(player.playbackRate || 1);
  altAudio.src = buildVideoAltAudioUrl(video, _selectedVideoAudioTrackId, target);
  altAudio.load();
  altAudio.onloadedmetadata = () => {
    const expectedDuration = Number(videoPlayerExpectedDuration(player, video) || 0);
    const remainingDuration = Math.max(0, expectedDuration - target);
    const altDuration = Number(altAudio.duration || 0);
    if (altDuration > 0 && expectedDuration > 0) {
      if (Math.abs(altDuration - expectedDuration) <= 120) {
        _videoAltAudioSeekMode = 'full';
      } else if (Math.abs(altDuration - remainingDuration) <= 120) {
        _videoAltAudioSeekMode = 'clipped';
      } else {
        _videoAltAudioSeekMode = altDuration > (remainingDuration + 120) ? 'full' : 'clipped';
      }
    } else {
      _videoAltAudioSeekMode = 'clipped';
    }
    if (_videoAltAudioSeekMode === 'full' && target > 0) {
      try { altAudio.currentTime = target; } catch (_err) {}
    }
    if (altAudio.dataset.autoplayPending === '1') tryPlayAltAudio();
  };
  altAudio.onplaying = () => {
    _videoAltAudioReady = true;
    player.muted = true;
    altAudio.muted = altAudio.dataset.desiredMuted === '1';
    delete altAudio.dataset.autoplayPending;
    updateVideoControlsUI();
  };
  altAudio.oncanplay = () => {
    if (_videoAltAudioSeekMode === 'full' && target > 0 && Math.abs(Number(altAudio.currentTime || 0) - target) > 0.35) {
      try { altAudio.currentTime = target; } catch (_err) {}
    }
    tryPlayAltAudio();
  };
  altAudio.onended = () => {
    if (!player.paused) player.pause();
  };
  altAudio.onpause = () => {
    if (videoPlayerIsAltAudioActive() && !player.paused && !altAudio.ended) {
      altAudio.play().catch(() => {});
    }
  };
  altAudio.onerror = () => {
    _videoAltAudioReady = false;
    _videoAltAudioSeekMode = 'pending';
    if (videoPlayerIsAltAudioActive()) {
      player.muted = !!_videoAltAudioOutputMuted;
      updateVideoControlsUI();
    }
  };
  tryPlayAltAudio();
}

function setVideoSubtitle(value) {
  _selectedVideoSubtitleId = String(value || '');
  const applySelectedSubtitleTrack = (attempt = 0) => {
    const player = getVideoLibraryPlayer();
    if (!player) return;
    const textTracks = getVideoLibraryTextTracks();
    textTracks.forEach((track) => {
      try { track.mode = 'disabled'; } catch (_err) {}
    });
    const trackEls = [...player.querySelectorAll('track')];
    trackEls.forEach((trackEl) => {
      trackEl.default = false;
      if (trackEl.track) {
        try { trackEl.track.mode = 'disabled'; } catch (_err) {}
      }
    });
    if (!_selectedVideoSubtitleId) {
      updateVideoControlsUI();
      return;
    }
    const subtitles = Array.isArray(videoLibrarySelectedVideo()?.subtitles) ? videoLibrarySelectedVideo().subtitles : [];
    const selectedIndex = subtitles.findIndex((subtitle) => String(subtitle.id) === String(_selectedVideoSubtitleId));
    if (selectedIndex < 0) {
      updateVideoControlsUI();
      return;
    }

    const selectedTrackEl = trackEls[selectedIndex] || trackEls.find((trackEl) => String(trackEl.dataset.subtitleId || '') === String(_selectedVideoSubtitleId));
    const selectedTextTrack = textTracks[selectedIndex] || selectedTrackEl?.track || null;
    if (selectedTrackEl) selectedTrackEl.default = true;

    let applied = false;
    if (selectedTextTrack) {
      try {
        selectedTextTrack.mode = 'hidden';
        selectedTextTrack.mode = 'showing';
        applied = selectedTextTrack.mode === 'showing';
      } catch (_err) {}
    }

    if (!applied && attempt < 20) {
      setTimeout(() => applySelectedSubtitleTrack(attempt + 1), 100);
      return;
    }
    updateVideoControlsUI();
  };

  const player = getVideoLibraryPlayer();
  if (!player) return;
  if (!_selectedVideoSubtitleId) {
    _videoSubtitleCueData = [];
    _videoSubtitleLoadedTrackId = '';
    clearVideoSubtitleOverlay();
  } else {
    loadVideoSubtitleCueData(_selectedVideoSubtitleId).catch(() => {});
  }
  applySelectedSubtitleTrack(0);
}

function clearVideoProgressTimer() {
  if (_videoProgressSaveTimer) {
    clearTimeout(_videoProgressSaveTimer);
    _videoProgressSaveTimer = null;
  }
}

async function saveVideoPlaybackProgress(forceComplete = false) {
  const player = getVideoLibraryPlayer();
  const video = videoLibrarySelectedVideo();
  if (!player || !(video?.progress_key || video?.relative_path)) return;
  const matchesVideo = (item) => (
    String(item?.id || '') === String(video?.id || '')
    || (String(video?.progress_key || '') && String(item?.progress_key || '') === String(video?.progress_key || ''))
    || (String(video?.relative_path || '') && String(item?.relative_path || '') === String(video?.relative_path || ''))
  );
  const duration = Number(videoPlayerExpectedDuration(player, video) || video.progress?.duration_seconds || 0);
  const current = forceComplete ? duration : videoPlayerCurrentSeconds(player, video);
  if (!forceComplete && video?.progress?.is_completed && current <= 5) {
    return;
  }
  if (!forceComplete && !(current > 0) && !(duration > 0)) return;
  if (forceComplete) {
    const optimisticProgress = {
      ...(video.progress || {}),
      current_seconds: duration,
      duration_seconds: duration,
      progress_percent: 100,
      is_completed: true,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    _videoLibraryData = {
      ..._videoLibraryData,
      videos: Array.isArray(_videoLibraryData?.videos)
        ? _videoLibraryData.videos.map((item) => matchesVideo(item)
          ? { ...item, progress: optimisticProgress }
          : item)
        : [],
    };
  }
  const result = await api('/api/videos/progress', {
    method: 'POST',
    body: {
      relative_path: video.progress_key || video.relative_path,
      current_seconds: current,
      duration_seconds: duration,
      is_completed: forceComplete,
    },
  });
  if (!result?.success) return;
  const progress = result.progress || null;
  const wasCompleted = !!video.progress?.is_completed;
  _videoLibraryData = {
    ..._videoLibraryData,
    videos: Array.isArray(_videoLibraryData?.videos)
      ? _videoLibraryData.videos.map((item) => matchesVideo(item)
        ? { ...item, progress }
        : item)
      : [],
  };
  if (forceComplete || (!!progress?.is_completed !== wasCompleted)) {
    renderVideosPage();
  }
}

function sendVideoPlaybackProgressBeacon() {
  const player = getVideoLibraryPlayer();
  const video = videoLibrarySelectedVideo();
  if (!player || !video?.relative_path || !navigator.sendBeacon) return false;
  const duration = Number(videoPlayerExpectedDuration(player, video) || video.progress?.duration_seconds || 0);
  const current = videoPlayerCurrentSeconds(player, video);
  if (!(current > 0) && !(duration > 0)) return false;
  const body = JSON.stringify({
    relative_path: video.relative_path,
    current_seconds: current,
    duration_seconds: duration,
    is_completed: false,
  });
  return navigator.sendBeacon('/api/videos/progress', new Blob([body], { type: 'application/json' }));
}

async function flushVideoPlaybackProgress() {
  clearVideoProgressTimer();
  try {
    await saveVideoPlaybackProgress(false);
  } catch (_err) {}
}

async function flushVideoPlaybackProgressWithTimeout(maxMs = 1200) {
  try {
    await Promise.race([
      flushVideoPlaybackProgress(),
      new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(maxMs || 0)))),
    ]);
  } catch (_err) {}
}

function queueVideoPlaybackProgressSave() {
  clearVideoProgressTimer();
  _videoProgressSaveTimer = setTimeout(() => {
    saveVideoPlaybackProgress(false).catch(() => {});
  }, 1200);
}

function videoPlayerSeekableDuration(player = getVideoLibraryPlayer()) {
  const instance = getVideoLibraryPlayerInstance();
  const instanceSeekable = instance && typeof instance.seekable === 'function'
    ? instance.seekable()
    : null;
  if (instanceSeekable && typeof instanceSeekable.length === 'number' && instanceSeekable.length > 0 && typeof instanceSeekable.end === 'function') {
    try {
      const end = Number(instanceSeekable.end(instanceSeekable.length - 1) || 0);
      if (Number.isFinite(end) && end > 0) return end;
    } catch (_err) {}
  }
  const nativeSeekable = player?.seekable;
  if (nativeSeekable && typeof nativeSeekable.length === 'number' && nativeSeekable.length > 0 && typeof nativeSeekable.end === 'function') {
    try {
      const end = Number(nativeSeekable.end(nativeSeekable.length - 1) || 0);
      if (Number.isFinite(end) && end > 0) return end;
    } catch (_err) {}
  }
  return 0;
}

function videoPlayerExpectedDuration(player, video) {
  const instance = getVideoLibraryPlayerInstance();
  const nativeDuration = Number(player?.duration || 0);
  const instanceDuration = instance && typeof instance.duration === 'function'
    ? Number(instance.duration() || 0)
    : 0;
  const liveDuration = [nativeDuration, instanceDuration]
    .map((value) => Number(value || 0))
    .find((value) => Number.isFinite(value) && value > 0) || 0;
  const seekableDuration = videoPlayerSeekableDuration(player);
  const savedDuration = Number(video?.progress?.duration_seconds || 0);
  const runtimeDuration = Math.max(0, Number(video?.runtime_minutes || 0) * 60);
  const fallback = Math.max(savedDuration, runtimeDuration, 0);
  if (liveDuration > 0 && liveDuration + 30 >= fallback) return liveDuration;
  if (seekableDuration > 0 && seekableDuration + 30 >= fallback) return seekableDuration;
  return fallback > 0 ? fallback : Math.max(liveDuration, seekableDuration, 0);
}

function applyPendingVideoSourceState(player, video) {
  const pendingState = _videoPendingSourceState;
  if (!pendingState || !player || !video) return false;
  setVideoPlayerMuted(!!pendingState.muted);
  if (Number.isFinite(Number(pendingState.playbackRate || 0)) && Number(pendingState.playbackRate || 0) > 0) {
    setVideoPlayerPlaybackRate(Number(pendingState.playbackRate || 1));
  }
  const resumeAt = Math.max(0, Number(pendingState.currentTime || 0));
  const expectedDuration = Math.max(
    Number(pendingState.expectedDuration || 0),
    Number(videoPlayerExpectedDuration(player, video) || 0)
  );
  const canSeekToResumePoint = resumeAt <= 0 || expectedDuration > Math.min(resumeAt + 1, 5);
  if (resumeAt > 0 && canSeekToResumePoint) {
    setVideoPlayerCurrentTime(resumeAt);
  }
  setVideoSubtitle(_selectedVideoSubtitleId);
  if (!canSeekToResumePoint) return false;
  if (pendingState.wasPlaying) videoPlayerPlay().catch(() => {});
  _videoPendingSourceState = null;
  return true;
}

function setupVideoPlayerProgress() {
  const player = getVideoLibraryPlayer();
  const video = videoLibrarySelectedVideo();
  if (!player || !video) return;
  if (_videoProgressBoundVideoId === String(video.id) && player.dataset.progressBound === '1') return;
  _videoProgressBoundVideoId = String(video.id);
  player.dataset.progressBound = '1';
  player.dataset.resumeApplied = '0';
  clearVideoProgressTimer();

  const applyStoredResumeIfReady = () => {
    const progress = video.progress || null;
    const resumeAt = Number(progress?.current_seconds || 0);
    const isCompleted = !!progress?.is_completed;
    if (player.dataset.resumeApplied === '1') return;
    if (_videoPendingSourceState) return;
    if (isCompleted || !(resumeAt > 0)) {
      setVideoPlayerCurrentTime(0, { retry: false });
      player.dataset.resumeApplied = '1';
      return;
    }
    const expectedDuration = Number(videoPlayerExpectedDuration(player, video) || 0);
    if (!(expectedDuration > Math.min(resumeAt + 1, 5))) return;
    setVideoPlayerCurrentTime(resumeAt);
    player.dataset.resumeApplied = '1';
  };

  player.onloadedmetadata = () => {
    const progress = video.progress || null;
    const resumeAt = Number(progress?.current_seconds || 0);
    const isCompleted = !!progress?.is_completed;
    const shouldDeferHlsResume = videoUsesHlsPlayback(video, _selectedVideoAudioTrackId);
    if (_videoPendingSourceState?.reason === 'audio-switch') {
      setVideoSubtitle(_selectedVideoSubtitleId);
      updateVideoControlsUI();
      return;
    }
    const expectedDuration = Number(videoPlayerExpectedDuration(player, video) || 0);
    if (!_videoPendingSourceState && !shouldDeferHlsResume && !isCompleted && resumeAt > 0 && expectedDuration > Math.min(resumeAt + 1, 5)) {
      setVideoPlayerCurrentTime(resumeAt);
      player.dataset.resumeApplied = '1';
    } else if (!_videoPendingSourceState && (!resumeAt || isCompleted)) {
      setVideoPlayerCurrentTime(0, { retry: false });
      player.dataset.resumeApplied = '1';
    }
    if (!_videoPendingSourceState) setVideoSubtitle(_selectedVideoSubtitleId);
    if (_videoPendingSourceState) applyPendingVideoSourceState(player, video);
    updateVideoControlsUI();
  };
  player.ondurationchange = () => {
    if (_videoPendingSourceState) applyPendingVideoSourceState(player, video);
    applyStoredResumeIfReady();
    updateVideoControlsUI();
  };
  player.oncanplay = () => {
    if (_videoPendingSourceState) applyPendingVideoSourceState(player, video);
    applyStoredResumeIfReady();
    updateVideoControlsUI();
  };
  player.ontimeupdate = () => {
    if (player.seeking) return;
    queueVideoPlaybackProgressSave();
    if (_videoPendingSourceState) applyPendingVideoSourceState(player, video);
    updateVideoControlsUI();
  };
  player.onplay = () => {
    resumeVideoPlaybackUiAnchor(player);
    updateVideoControlsUI();
  };
  player.onpause = () => {
    freezeVideoPlaybackUiAnchor(player);
    queueVideoPlaybackProgressSave();
    updateVideoControlsUI();
  };
  player.onseeking = () => {};
  player.onseeked = () => {
    updateVideoControlsUI();
  };
  player.onended = () => {
    freezeVideoPlaybackUiAnchor(player);
    clearVideoProgressTimer();
    const duration = Number(player.duration || 0);
    if (duration > 0) {
      const completedNow = {
        ...(video.progress || {}),
        current_seconds: duration,
        duration_seconds: duration,
        progress_percent: 100,
        is_completed: true,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      _videoLibraryData = {
        ..._videoLibraryData,
        videos: Array.isArray(_videoLibraryData?.videos)
          ? _videoLibraryData.videos.map((item) => String(item.relative_path || '') === String(video.relative_path || '')
            ? { ...item, progress: completedNow }
            : item)
          : [],
      };
    }
    saveVideoPlaybackProgress(true).catch(() => {});
    updateVideoControlsUI();
  };
  player.onvolumechange = () => {
    updateVideoControlsUI();
  };
  player.onratechange = () => {
    updateVideoControlsUI();
  };
}

async function loadVideosPage() {
  flushVideoPlaybackProgress().catch(() => {});
  _videoLibraryLoading = true;
  renderVideosPage();
  try {
    const result = await api('/api/videos/library');
    if (result?.error) {
      _videoLibraryData = { configured: false, root_exists: true, settings: null, videos: [], message: result.error, subtitle_engine: { available: false, message: '' } };
      toast(result.error || 'Could not load videos.', 'error');
      } else {
        _videoLibraryData = {
          configured: !!result?.configured,
          root_exists: result?.root_exists !== false,
        settings: result?.settings || null,
        videos: Array.isArray(result?.videos) ? result.videos : [],
          message: String(result?.message || '').trim(),
          subtitle_engine: result?.subtitle_engine || { available: false, message: '' },
        };
        const filtered = videoLibraryFilteredVideos();
        if (!_selectedVideoLibraryId || !_videoLibraryData.videos.some((video) => String(video.id) === String(_selectedVideoLibraryId))) {
          _selectedVideoLibraryId = String((filtered[0] || _videoLibraryData.videos[0] || {}).id || '');
        }
    }
  } catch (error) {
    console.error('loadVideosPage failed', error);
    _videoLibraryData = { configured: false, root_exists: true, settings: null, videos: [], message: 'Could not load videos.', subtitle_engine: { available: false, message: '' } };
    toast('Could not load videos.', 'error');
  } finally {
    _videoLibraryLoading = false;
    renderVideosPage();
  }
}

function renderVideosPage() {
  const main = document.getElementById('main');
  if (!main) return;

  if (_videoLibraryLoading) {
    main.innerHTML = `
      <div class="tab-content">
        <div class="videos-page">
          <div class="videos-page-head">
            <div>
              <div class="videos-page-title">Videos</div>
              <div class="videos-page-sub">Loading your video library...</div>
            </div>
          </div>
          <div class="card videos-empty-card">Loading videos...</div>
        </div>
      </div>`;
    return;
  }

  const settings = _videoLibraryData?.settings || {};
  const subtitleEngine = _videoLibraryData?.subtitle_engine || { available: false, message: '' };
    const filteredVideos = videoLibraryFilteredVideos();
    const selectedVideo = videoLibrarySelectedVideo() || filteredVideos[0] || null;
  if (selectedVideo && String(selectedVideo.id) !== String(_selectedVideoLibraryId)) {
    _selectedVideoLibraryId = String(selectedVideo.id);
  }
  if (selectedVideo) {
    const subtitles = Array.isArray(selectedVideo.subtitles) ? selectedVideo.subtitles : [];
    if (_selectedVideoSubtitleId && !subtitles.some((subtitle) => String(subtitle.id) === String(_selectedVideoSubtitleId))) {
      _selectedVideoSubtitleId = '';
    }
  }

  const adminActions = _userRole === 'admin'
    ? `
      <button class="btn btn-s btn-sm" onclick="showVideoCatalogModal()">Catalog Sync</button>
      <button class="btn btn-s btn-sm" onclick="showVideoLibrarySettingsModal()">Library Settings</button>`
    : '';

  const header = `
    <div class="videos-page-head">
      <div class="videos-page-head-copy">
        <div class="videos-page-head-top">
          <div class="videos-page-title">${escHtml(settings.library_title || 'Videos')}</div>
          <div class="videos-head-actions">
            <button class="btn btn-s btn-sm" onclick="loadVideosPage()">Refresh</button>
            ${adminActions}
          </div>
        </div>
        <div class="videos-page-sub">Watch your server-hosted videos directly in the browser.</div>
      </div>
    </div>`;

  if (!_videoLibraryData.configured) {
    main.innerHTML = `
      <div class="tab-content">
        <div class="videos-page">
          ${header}
          <div class="card videos-empty-card">
            <div class="videos-empty-title">Video folder is not configured yet</div>
            <div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'Ask an admin to set the server folder path for videos.')}</div>
            ${_userRole === 'admin' ? '<button class="btn btn-p" style="margin-top:16px" onclick="showVideoLibrarySettingsModal()">Set Video Folder</button>' : ''}
          </div>
        </div>
      </div>`;
    return;
  }

  if (!_videoLibraryData.root_exists) {
    main.innerHTML = `
      <div class="tab-content">
        <div class="videos-page">
          ${header}
          <div class="card videos-empty-card">
            <div class="videos-empty-title">Configured folder was not found</div>
            <div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'The saved server path does not exist right now.')}</div>
            ${_userRole === 'admin' ? '<button class="btn btn-p" style="margin-top:16px" onclick="showVideoLibrarySettingsModal()">Fix Folder Path</button>' : ''}
          </div>
        </div>
      </div>`;
    return;
  }

  if (!filteredVideos.length) {
    main.innerHTML = `
      <div class="tab-content">
        <div class="videos-page">
          ${header}
          <div class="card videos-toolbar">
            <label class="fl full">Search
              <input class="fi" value="${escHtml(_videoLibrarySearch)}" oninput="setVideoLibrarySearch(this.value)" placeholder="Search video title or folder">
            </label>
          </div>
          <div class="card videos-empty-card">
            <div class="videos-empty-title">${_videoLibraryData.videos.length ? 'No videos match this search' : 'No videos found yet'}</div>
            <div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'Put supported files like MP4 or WebM inside the configured folder.')}</div>
          </div>
        </div>
      </div>`;
    return;
  }

  main.innerHTML = `
    <div class="tab-content">
      <div class="videos-page">
        ${header}
        <div class="card videos-toolbar">
          <label class="fl full">Search
            <input class="fi" value="${escHtml(_videoLibrarySearch)}" oninput="setVideoLibrarySearch(this.value)" placeholder="Search video title or folder">
          </label>
          <div class="videos-toolbar-meta">
            <span>${folders.length} folder${folders.length === 1 ? '' : 's'}</span>
            <span>${filteredVideos.length} video${filteredVideos.length === 1 ? '' : 's'}</span>
            ${!subtitleEngine.available && subtitleEngine.message ? `<span class="videos-toolbar-path" style="color:#9a5c00;background:#fff5df;border-color:#f0d49b">${escHtml(subtitleEngine.message)}</span>` : ''}
            ${_userRole === 'admin' && settings.videos_root_path ? `<span class="videos-toolbar-path">${escHtml(settings.videos_root_path)}</span>` : ''}
          </div>
        </div>
        <div class="videos-layout">
          <div class="card videos-playlist-card">
          <div class="videos-panel-title">Folders</div>
          <div class="videos-folder-list">
            <button class="videos-folder-item ${!_selectedVideoFolder ? 'active' : ''}" onclick="selectVideoLibraryFolder('')">
              <span class="videos-folder-name">All Videos</span>
              <span class="videos-folder-count">${Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos.length : 0}</span>
            </button>
            ${folders.map((folder) => `
              <button class="videos-folder-item ${String(_selectedVideoFolder || '') === String(folder.folder) ? 'active' : ''}" onclick="selectVideoLibraryFolder('${String(folder.folder).replace(/'/g, "\\'")}')">
                <span class="videos-folder-name">${escHtml(folder.label || 'Root')}</span>
                <span class="videos-folder-count">${folder.count}</span>
              </button>`).join('')}
          </div>
          <div class="videos-panel-title videos-panel-title-spaced">Files</div>
          <div class="videos-playlist-list">
            ${filteredVideos.map((video) => `
              <button class="videos-playlist-item ${String(selectedVideo?.id || '') === String(video.id) ? 'active' : ''}" onclick="selectVideoLibraryItem('${String(video.id).replace(/'/g, "\\'")}')">
                <div class="videos-playlist-top">
                  <div class="videos-playlist-name">${escHtml(video.title || 'Video')}</div>
                  <div class="videos-playlist-size">${escHtml(videoLibraryFormatBytes(video.size_bytes))}</div>
                </div>
                <div class="videos-playlist-meta">
                  <span>${escHtml(video.catalog_title || video.folder || 'Root folder')}</span>
                  <span>${escHtml(video.available === false ? 'Not available' : (videoProgressLabel(video.progress) || (fmtDate ? fmtDate(video.updated_at) : (video.updated_at || '-'))))}</span>
                </div>
                ${videoProgressPercent(video.progress) > 0 ? `<div class="videos-progress"><span class="videos-progress-bar ${video.progress?.is_completed ? 'completed' : ''}" style="width:${videoProgressPercent(video.progress)}%"></span></div>` : ''}
              </button>`).join('')}
          </div>
          </div>
          <div class="videos-main-column">
            <div class="card videos-player-card">
            <div class="videos-player-head">
              <div>
                <div class="videos-player-title">${escHtml(selectedVideo?.title || 'Video')}</div>
                <div class="videos-player-sub">${escHtml(selectedVideo?.folder || 'Root folder')} • ${escHtml(videoLibraryFormatBytes(selectedVideo?.size_bytes || 0))}${selectedVideo?.progress ? ` • ${escHtml(videoProgressLabel(selectedVideo.progress) || '')}` : ''}</div>
              </div>
            </div>
            <div class="videos-frame">
              ${selectedVideo?.available === false
                ? `<div class="videos-empty-card" style="height:100%;display:flex;align-items:center;justify-content:center;margin:0;border:none;box-shadow:none">
                    <div>
                      <div class="videos-empty-title">File not available</div>
                      <div class="videos-empty-sub">This catalog entry exists in the database, but the file path was not found on the server.</div>
                    </div>
                  </div>`
                : `<video id="videoLibraryPlayer" class="videos-player" src="${escHtml(selectedVideo ? getPlayableVideoSource(selectedVideo).src : '')}" controls controlslist="nodownload noplaybackrate" preload="metadata" playsinline oncontextmenu="return false">
                    ${videoLibrarySubtitleTracks(selectedVideo)}
                  </video>`}
            </div>
            ${selectedVideo?.available === false ? '' : `<div class="videos-controls">
              <button id="videoControlPlay" class="videos-control-btn" type="button" onclick="videoPlayerToggle()" title="Play" aria-label="Play">${videoControlIcon('play')}</button>
              <button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoPlayerSeek(-10)" title="Back 10 seconds" aria-label="Back 10 seconds">${videoControlIcon('back')}<span>-10</span></button>
              <button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoPlayerSeek(10)" title="Forward 10 seconds" aria-label="Forward 10 seconds">${videoControlIcon('forward')}<span>+10</span></button>
              <button id="videoControlMute" class="videos-control-btn" type="button" onclick="videoPlayerMute()" title="Mute" aria-label="Mute">${videoControlIcon('volume')}</button>
              ${(selectedVideo?.subtitles || []).length ? `
                <button id="videoControlSubtitle" class="videos-control-btn videos-control-btn-subtitle" type="button" onclick="videoPlayerSubtitleToggle()" title="Subtitles" aria-label="Subtitles">${videoControlIcon('subtitle')}</button>` : ''}
              <button id="videoControlSpeed" class="videos-control-btn videos-control-btn-speed" type="button" onclick="videoPlayerCycleRate()" title="Playback speed" aria-label="Playback speed">${videoControlIcon('speed')}<span>1x</span></button>
              <button class="videos-control-btn videos-control-btn-primary" type="button" onclick="videoPlayerFullscreen()" title="Fullscreen" aria-label="Fullscreen">${videoControlIcon('fullscreen')}</button>
            </div>`}
              <div class="videos-details-card">
              <div class="videos-panel-title videos-panel-title-spaced">Video Details</div>
              <div class="videos-details-grid">
                <div class="videos-detail-box">
                  <div class="videos-detail-label">Filename</div>
                  <div class="videos-detail-value">${escHtml(selectedVideo?.filename || '-')}</div>
                </div>
                <div class="videos-detail-box">
                  <div class="videos-detail-label">Folder</div>
                  <div class="videos-detail-value">${escHtml(selectedVideo?.folder || 'Root folder')}</div>
                </div>
                <div class="videos-detail-box">
                  <div class="videos-detail-label">Format</div>
                  <div class="videos-detail-value">${escHtml(String(selectedVideo?.extension || '').replace(/^\./, '').toUpperCase() || '-')}</div>
                </div>
                <div class="videos-detail-box">
                  <div class="videos-detail-label">Updated</div>
                  <div class="videos-detail-value">${escHtml(fmtDate ? fmtDate(selectedVideo?.updated_at) : (selectedVideo?.updated_at || '-'))}</div>
                </div>
                <div class="videos-detail-box">
                  <div class="videos-detail-label">Watch Status</div>
                  <div class="videos-detail-value">${escHtml(videoProgressLabel(selectedVideo?.progress) || 'Not started')}</div>
                </div>
                <div class="videos-detail-box">
                  <div class="videos-detail-label">Progress</div>
                  <div class="videos-detail-value">${Math.round(videoProgressPercent(selectedVideo?.progress))}%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    `;
  _videoProgressBoundVideoId = '';
  setupVideoPlayerProgress();
  updateVideoControlsUI();
  requestAnimationFrame(() => {
    restoreVideoPlaylistScroll();
    requestAnimationFrame(() => {
      restoreVideoPlaylistScroll();
      requestAnimationFrame(restoreVideoPlaylistScroll);
    });
  });
}

function renderVideosPage() {
  const main = document.getElementById('main');
  if (!main) return;

  if (_videoLibraryLoading) {
    main.innerHTML = `
      <div class="tab-content">
        <div class="videos-page">
          <div class="videos-page-head">
            <div>
              <div class="videos-page-title">Videos</div>
              <div class="videos-page-sub">Loading your video library...</div>
            </div>
          </div>
          <div class="card videos-empty-card">Loading videos...</div>
        </div>
      </div>`;
    return;
  }

  const settings = _videoLibraryData?.settings || {};
  const subtitleEngine = _videoLibraryData?.subtitle_engine || { available: false, message: '' };
  const folders = videoLibraryFolders();
  const filteredVideos = videoLibraryFilteredVideos();
  const selectedVideo = videoLibrarySelectedVideo() || filteredVideos[0] || null;
  if (selectedVideo && String(selectedVideo.id) !== String(_selectedVideoLibraryId)) _selectedVideoLibraryId = String(selectedVideo.id);
  if (selectedVideo) {
    const subtitles = Array.isArray(selectedVideo.subtitles) ? selectedVideo.subtitles : [];
    if (_selectedVideoSubtitleId && !subtitles.some((subtitle) => String(subtitle.id) === String(_selectedVideoSubtitleId))) _selectedVideoSubtitleId = '';
  }

  const adminActions = _userRole === 'admin'
    ? `
      <button class="btn btn-s btn-sm" onclick="showVideoCatalogModal()">Catalog Sync</button>
      <button class="btn btn-s btn-sm" onclick="showVideoLibrarySettingsModal()">Library Settings</button>`
    : '';

  const filtersHtml = `
    <div class="fa" style="margin-top:8px">
      <button class="btn ${_videoLibraryMediaFilter === 'all' ? 'btn-p' : 'btn-s'} btn-sm" onclick="setVideoLibraryMediaFilter('all')">All</button>
      <button class="btn ${_videoLibraryMediaFilter === 'movie' ? 'btn-p' : 'btn-s'} btn-sm" onclick="setVideoLibraryMediaFilter('movie')">Movies</button>
      <button class="btn ${_videoLibraryMediaFilter === 'series' ? 'btn-p' : 'btn-s'} btn-sm" onclick="setVideoLibraryMediaFilter('series')">Series</button>
    </div>`;

  const header = `
    <div class="videos-page-head">
      <div class="videos-page-head-copy">
        <div class="videos-page-head-top">
          <div class="videos-page-title">${escHtml(settings.library_title || 'Videos')}</div>
          <div class="videos-head-actions">
            <button class="btn btn-s btn-sm" onclick="loadVideosPage()">Refresh</button>
            ${adminActions}
          </div>
        </div>
        <div class="videos-page-sub">Watch your server-hosted videos directly in the browser.</div>
      </div>
    </div>`;

  if (!_videoLibraryData.configured) {
    main.innerHTML = `<div class="tab-content"><div class="videos-page">${header}<div class="card videos-empty-card"><div class="videos-empty-title">Video folder is not configured yet</div><div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'Ask an admin to set the server folder path for videos.')}</div>${_userRole === 'admin' ? '<button class="btn btn-p" style="margin-top:16px" onclick="showVideoLibrarySettingsModal()">Set Video Folder</button>' : ''}</div></div></div>`;
    return;
  }

  if (!_videoLibraryData.root_exists) {
    main.innerHTML = `<div class="tab-content"><div class="videos-page">${header}<div class="card videos-empty-card"><div class="videos-empty-title">Configured folder was not found</div><div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'The saved server path does not exist right now.')}</div>${_userRole === 'admin' ? '<button class="btn btn-p" style="margin-top:16px" onclick="showVideoLibrarySettingsModal()">Fix Folder Path</button>' : ''}</div></div></div>`;
    return;
  }

  if (!filteredVideos.length) {
    main.innerHTML = `
      <div class="tab-content">
        <div class="videos-page">
          ${header}
          <div class="card videos-toolbar">
            <label class="fl full">Search
              <input class="fi" value="${escHtml(_videoLibrarySearch)}" oninput="setVideoLibrarySearch(this.value)" placeholder="Search movie title, series, genre, cast, or folder">
            </label>
            ${filtersHtml}
          </div>
          <div class="card videos-empty-card">
            <div class="videos-empty-title">${_videoLibraryData.videos.length ? 'No videos match this search' : 'No videos found yet'}</div>
            <div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'Put supported files like MP4 or WebM inside the configured folder.')}</div>
          </div>
        </div>
      </div>`;
    return;
  }

  main.innerHTML = `
    <div class="tab-content">
      <div class="videos-page">
        ${header}
        <div class="card videos-toolbar">
            <label class="fl full">Search
              <input class="fi" value="${escHtml(_videoLibrarySearch)}" oninput="setVideoLibrarySearch(this.value)" placeholder="Search movie title, series, genre, cast, or folder">
            </label>
            ${filtersHtml}
            <div class="videos-toolbar-meta">
              <span>${filteredVideos.length} file${filteredVideos.length === 1 ? '' : 's'}</span>
              ${!subtitleEngine.available && subtitleEngine.message ? `<span class="videos-toolbar-path" style="color:#9a5c00;background:#fff5df;border-color:#f0d49b">${escHtml(subtitleEngine.message)}</span>` : ''}
              ${_userRole === 'admin' && settings.videos_root_path ? `<span class="videos-toolbar-path">${escHtml(settings.videos_root_path)}</span>` : ''}
            </div>
          </div>
          <div class="videos-layout">
            <div class="card videos-playlist-card">
              <div class="videos-panel-title">Files</div>
              <div class="videos-playlist-list">
                ${renderVideoPlaylistItems(filteredVideos, selectedVideo)}
              </div>
          </div>
          <div class="videos-main-column">
            <div class="card videos-player-card">
              <div class="videos-player-head">
                <div>
                  <div class="videos-player-title">${escHtml(selectedVideo?.title || 'Video')}</div>
                  <div class="videos-player-sub">${escHtml([
                    selectedVideo?.catalog_title || selectedVideo?.folder || 'Root folder',
                    selectedVideo?.release_year || '',
                    selectedVideo?.season_label || '',
                    selectedVideo?.episode_label || '',
                    videoLibraryFormatBytes(selectedVideo?.size_bytes || 0),
                    selectedVideo?.progress ? (videoProgressLabel(selectedVideo.progress) || '') : '',
                    selectedVideo?.available === false ? 'Not available' : '',
                  ].filter(Boolean).join(' • '))}</div>
                </div>
              </div>
              <div class="videos-frame">
                ${selectedVideo?.available === false
                  ? `<div class="videos-empty-card" style="height:100%;display:flex;align-items:center;justify-content:center;margin:0;border:none;box-shadow:none"><div><div class="videos-empty-title">File not available</div><div class="videos-empty-sub">This catalog entry exists in the database, but the file path was not found on the server.</div></div></div>`
                  : `<video id="videoLibraryPlayer" class="videos-player" src="${escHtml(selectedVideo ? getPlayableVideoSource(selectedVideo).src : '')}" controls controlslist="nodownload noplaybackrate" preload="metadata" playsinline oncontextmenu="return false">${videoLibrarySubtitleTracks(selectedVideo)}</video>`}
              </div>
              ${selectedVideo?.available === false ? '' : `<div class="videos-controls">
                <button id="videoControlPlay" class="videos-control-btn" type="button" onclick="videoPlayerToggle()" title="Play" aria-label="Play">${videoControlIcon('play')}</button>
                <button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoPlayerSeek(-10)" title="Back 10 seconds" aria-label="Back 10 seconds">${videoControlIcon('back')}<span>-10</span></button>
                <button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoPlayerSeek(10)" title="Forward 10 seconds" aria-label="Forward 10 seconds">${videoControlIcon('forward')}<span>+10</span></button>
                <button id="videoControlMute" class="videos-control-btn" type="button" onclick="videoPlayerMute()" title="Mute" aria-label="Mute">${videoControlIcon('volume')}</button>
                ${(selectedVideo?.subtitles || []).length ? `<button id="videoControlSubtitle" class="videos-control-btn videos-control-btn-subtitle" type="button" onclick="videoPlayerSubtitleToggle()" title="Subtitles" aria-label="Subtitles">${videoControlIcon('subtitle')}</button>` : ''}
                <button id="videoControlSpeed" class="videos-control-btn videos-control-btn-speed" type="button" onclick="videoPlayerCycleRate()" title="Playback speed" aria-label="Playback speed">${videoControlIcon('speed')}<span>1x</span></button>
                <button class="videos-control-btn videos-control-btn-primary" type="button" onclick="videoPlayerFullscreen()" title="Fullscreen" aria-label="Fullscreen">${videoControlIcon('fullscreen')}</button>
              </div>`}
              <div class="videos-details-card">
                <div class="videos-panel-title videos-panel-title-spaced">Video Details</div>
                ${(selectedVideo?.poster_stream_url || selectedVideo?.synopsis) ? `
                  <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:14px">
                    ${(selectedVideo?.poster_stream_url) ? `<div style="width:110px;height:150px;border-radius:18px;background:#edf4ef url('${escHtml(selectedVideo.poster_stream_url)}') center/cover no-repeat;flex:0 0 110px"></div>` : ''}
                    <div style="min-width:0;flex:1">
                      <div style="font-size:16px;font-weight:800;color:var(--t1)">${escHtml(selectedVideo?.catalog_title || selectedVideo?.title || '-')}</div>
                      <div style="font-size:13px;color:var(--t2);margin-top:4px">${escHtml([
                        selectedVideo?.media_type === 'series' ? 'Series' : 'Movie',
                        selectedVideo?.release_year || '',
                        (selectedVideo?.genres || []).join(', ')
                      ].filter(Boolean).join(' • '))}</div>
                      ${selectedVideo?.synopsis ? `<div style="font-size:13px;color:var(--t2);line-height:1.55;margin-top:10px">${escHtml(selectedVideo.synopsis)}</div>` : ''}
                    </div>
                  </div>` : ''}
                <div class="videos-details-grid">
                  <div class="videos-detail-box"><div class="videos-detail-label">Filename</div><div class="videos-detail-value">${escHtml(selectedVideo?.filename || '-')}</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Folder</div><div class="videos-detail-value">${escHtml(selectedVideo?.folder || 'Root folder')}</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Format</div><div class="videos-detail-value">${escHtml(String(selectedVideo?.extension || '').replace(/^\./, '').toUpperCase() || '-')}</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Type</div><div class="videos-detail-value">${escHtml(selectedVideo?.media_type === 'series' ? 'Series' : 'Movie')}</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Updated</div><div class="videos-detail-value">${escHtml(fmtDate ? fmtDate(selectedVideo?.updated_at) : (selectedVideo?.updated_at || '-'))}</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Season / Episode</div><div class="videos-detail-value">${escHtml([selectedVideo?.season_label || '', selectedVideo?.episode_label || ''].filter(Boolean).join(' · ') || '-')}</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Watch Status</div><div class="videos-detail-value">${escHtml(videoProgressLabel(selectedVideo?.progress) || 'Not started')}</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Progress</div><div class="videos-detail-value">${Math.round(videoProgressPercent(selectedVideo?.progress))}%</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Genres</div><div class="videos-detail-value">${escHtml((selectedVideo?.genres || []).join(', ') || '-')}</div></div>
                  <div class="videos-detail-box"><div class="videos-detail-label">Cast</div><div class="videos-detail-value">${escHtml((selectedVideo?.cast_members || []).join(', ') || '-')}</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  _videoProgressBoundVideoId = '';
  setupVideoPlayerProgress();
  updateVideoControlsUI();
  requestAnimationFrame(() => {
    restoreVideoPlaylistScroll();
    requestAnimationFrame(() => {
      restoreVideoPlaylistScroll();
      requestAnimationFrame(restoreVideoPlaylistScroll);
    });
  });
}

function videoLibraryGenresFor(video) {
  return [...new Set((Array.isArray(video?.genres) ? video.genres : [])
    .map((genre) => String(genre || '').trim())
    .filter(Boolean))];
}

function videoLibraryGenreStats(videos = []) {
  const counts = new Map();
  videos.forEach((video) => {
    videoLibraryGenresFor(video).forEach((genre) => {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function videoLibraryHasEpisodeHints(video) {
  const text = [
    video?.title,
    video?.catalog_title,
    video?.series_title,
    video?.folder,
    video?.filename,
    video?.relative_path,
    video?.season_label,
    video?.episode_label,
  ].join(' ');
  return /\bs\d{1,2}\s*e\d{1,3}\b/i.test(text)
    || /\b\d{1,2}x\d{1,3}\b/i.test(text)
    || /\bseason\b/i.test(text)
    || /\bepisode\b/i.test(text);
}

function videoLibraryIsSeries(video) {
  if (!video) return false;
  if (String(video?.media_type || 'movie') !== 'series') return false;
  if (Number(video?.season_count || 0) > 1) return true;
  if (Number(video?.episode_count || 0) > 1) return true;
  if (Number(video?.season_number || 0) > 0 && String(video?.season_label || '').trim()) return true;
  if (Number(video?.episode_number || 0) > 0 && String(video?.episode_label || '').trim()) return true;
  if (videoLibraryHasEpisodeHints(video)) return true;
  return false;
}

function videoLibrarySeriesKey(video) {
  const base = String(
    video?.catalog_title
    || video?.series_title
    || video?.folder
    || video?.title
    || video?.id
    || ''
  ).trim();
  return videoLibraryNormalizedSeriesName(base).toLowerCase();
}

function videoLibraryNormalizedSeriesName(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\bs\d{1,2}\s*e\d{1,3}\b/ig, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b/ig, ' ')
    .replace(/\bseason\s*\d{1,2}\b/ig, ' ')
    .replace(/\b(?:720|1080|2160)p\b/ig, ' ')
    .replace(/\b(?:bluray|brrip|webrip|web-dl|webdl|dvdrip|hdrip|x264|x265|h264|h265|hevc|opus|aac|ddp|atmos|multi|audio|proper|repack|complete)\b/ig, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function videoLibrarySeriesDisplayTitle(video) {
  const candidates = [
    video?.catalog_title,
    video?.series_title,
    video?.title,
    video?.folder,
  ];
  for (const candidate of candidates) {
    const cleaned = videoLibraryNormalizedSeriesName(candidate);
    if (cleaned) return cleaned;
  }
  return 'Series';
}

function videoLibraryCleanEpisodeText(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\bs\d{1,2}\s*e\d{1,3}\b/ig, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b/ig, ' ')
    .replace(/\bseason\s*\d{1,2}\b/ig, ' ')
    .replace(/\b(?:720|1080|2160)p\b/ig, ' ')
    .replace(/\b(?:bluray|brrip|webrip|web-dl|webdl|dvdrip|hdrip|x264|x265|h264|h265|hevc|opus|aac|ddp|atmos|multi|audio|proper|repack|complete|mkv|mp4|webm)\b/ig, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function videoLibraryEpisodeSortValue(video) {
  const season = Number(video?.season_number || 0);
  const episode = Number(video?.episode_number || 0);
  return { season, episode };
}

function videoLibrarySortEpisodes(videos = []) {
  return [...videos].sort((a, b) => {
    const aSort = videoLibraryEpisodeSortValue(a);
    const bSort = videoLibraryEpisodeSortValue(b);
    if (aSort.season !== bSort.season) return aSort.season - bSort.season;
    if (aSort.episode !== bSort.episode) return aSort.episode - bSort.episode;
    return String(a?.title || a?.filename || '').localeCompare(String(b?.title || b?.filename || ''));
  });
}

function videoLibrarySeriesGroups(videos = []) {
  const groups = new Map();
  videos.forEach((video) => {
    if (!videoLibraryIsSeries(video)) return;
    const key = videoLibrarySeriesKey(video);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(video);
  });
  return [...groups.entries()].map(([key, entries]) => {
    const sortedEntries = videoLibrarySortEpisodes(entries);
    const progressSource = [...sortedEntries]
      .filter((entry) => entry?.progress && Number(entry.progress.current_seconds || 0) > 0 && !entry.progress.is_completed)
      .sort((a, b) => new Date(b?.progress?.updated_at || 0).getTime() - new Date(a?.progress?.updated_at || 0).getTime())[0]
      || [...sortedEntries]
        .filter((entry) => entry?.progress)
        .sort((a, b) => new Date(b?.progress?.updated_at || 0).getTime() - new Date(a?.progress?.updated_at || 0).getTime())[0]
      || sortedEntries[0];
    const base = sortedEntries[0] || {};
    const genres = [...new Set(sortedEntries.flatMap((entry) => videoLibraryGenresFor(entry)))];
    return {
      id: `series:${encodeURIComponent(key)}`,
      series_group_key: key,
      title: videoLibrarySeriesDisplayTitle(base),
      catalog_title: videoLibrarySeriesDisplayTitle(base),
      media_type: 'series',
      release_year: base?.release_year || base?.year || null,
      genres,
      synopsis: base?.synopsis || '',
      poster_url: base?.poster_url || '',
      poster_stream_url: base?.poster_stream_url || '',
      progress: progressSource?.progress || null,
      stream_url: progressSource?.stream_url || '',
      size_bytes: sortedEntries.reduce((sum, entry) => sum + Number(entry?.size_bytes || 0), 0),
      file_count: sortedEntries.length,
      episode_count: sortedEntries.length,
      season_count: Math.max(1, ...sortedEntries.map((entry) => Number(entry?.season_number || entry?.season_count || 1) || 1)),
      available: sortedEntries.some((entry) => entry?.available !== false),
      entries: sortedEntries,
      current_entry_id: String(progressSource?.id || sortedEntries[0]?.id || ''),
    };
  }).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

function videoLibraryFindSeriesGroupById(seriesId, videos = null) {
  const key = decodeURIComponent(String(seriesId || '').replace(/^series:/, ''));
  return videoLibrarySeriesGroups(Array.isArray(videos) ? videos : (Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos : []))
    .find((group) => String(group.series_group_key || '') === String(key || '')) || null;
}

function videoLibrarySeasonGroups(entries = []) {
  const groups = new Map();
  videoLibrarySortEpisodes(entries).forEach((entry) => {
    const seasonNumber = Number(entry?.season_number || 0);
    const seasonLabel = String(entry?.season_label || '').trim() || (seasonNumber > 0 ? `Season ${seasonNumber}` : 'Season 1');
    const key = `${seasonNumber || 1}:${seasonLabel.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        season_number: seasonNumber || 1,
        season_label: seasonLabel,
        entries: [],
      });
    }
    groups.get(key).entries.push(entry);
  });
  return [...groups.values()].sort((a, b) => Number(a.season_number || 0) - Number(b.season_number || 0));
}

function videoLibrarySeasonKeyForVideo(video) {
  const seasonNumber = Number(video?.season_number || 0);
  const seasonLabel = String(video?.season_label || '').trim() || (seasonNumber > 0 ? `Season ${seasonNumber}` : 'Season 1');
  return `${seasonNumber || 1}:${seasonLabel.toLowerCase()}`;
}

function setVideoLibraryDetailSeason(seriesId, seasonKey) {
  _videoDetailSeasonKey = String(seasonKey || '').trim();
  openVideoLibraryDetail(String(seriesId || ''));
}

function videoLibrarySelectSeriesEpisode(group, preferredEpisodeId = '') {
  if (!group || !Array.isArray(group.entries) || !group.entries.length) return null;
  if (preferredEpisodeId) {
    const exact = group.entries.find((entry) => String(entry?.id) === String(preferredEpisodeId));
    if (exact) return exact;
  }
  const inProgress = group.entries.find((entry) => entry?.progress && Number(entry.progress.current_seconds || 0) > 0 && !entry.progress.is_completed);
  return inProgress || group.entries[0] || null;
}

function videoLibraryGroupHasRealEpisodes(group) {
  const entries = Array.isArray(group?.entries) ? group.entries : [];
  if (entries.length <= 1) return false;
  return entries.some((entry) => (
    Number(entry?.episode_number || 0) > 0
    || Number(entry?.season_number || 0) > 0
    || videoLibraryHasEpisodeHints(entry)
  ));
}

function videoLibraryEpisodeLabel(video) {
  const season = Number(video?.season_number || 0);
  const episode = Number(video?.episode_number || 0);
  const seriesTitle = videoLibrarySeriesDisplayTitle(video).toLowerCase();
  const cleanedEpisodeLabel = videoLibraryCleanEpisodeText(video?.episode_label || '');
  const cleanedTitle = videoLibraryCleanEpisodeText(video?.title || video?.filename || '');
  const preferredName = [cleanedEpisodeLabel, cleanedTitle]
    .find((label) => label && label.toLowerCase() !== seriesTitle) || '';
  if (episode > 0 && preferredName && !new RegExp(`^episode\\s*${episode}$`, 'i').test(preferredName)) {
    return `Episode ${episode} · ${preferredName}`;
  }
  if (episode > 0) return `Episode ${episode}`;
  if (preferredName) return preferredName;
  if (season > 0) return `Season ${season}`;
  if (episode > 0) return `Episode ${episode}`;
  return String(video?.title || video?.filename || '').trim();
}

function videoLibraryNowPlayingLabel(video) {
  const season = Number(video?.season_number || 0);
  const episode = Number(video?.episode_number || 0);
  if (!(season > 0 || episode > 0)) return '';
  const parts = [];
  if (season > 0) parts.push(`Season ${season}`);
  if (episode > 0) parts.push(`Episode ${episode}`);
  return parts.join(' • ');
}

function scrollVideoDetailActiveEpisodeIntoView() {
  requestAnimationFrame(() => {
    const activeEpisode = document.querySelector('.video-detail-main-episode.active');
    if (activeEpisode && typeof activeEpisode.scrollIntoView === 'function') {
      activeEpisode.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  });
}

async function videoLibraryPlaySeriesEpisode(seriesId, episodeId) {
  const allVideos = Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos : [];
  const group = videoLibraryFindSeriesGroupById(seriesId, allVideos);
  if (!group) return;
  const episode = videoLibrarySelectSeriesEpisode(group, episodeId);
  if (!episode) return;
  await flushVideoPlaybackProgressWithTimeout(500);
  _selectedVideoLibraryId = String(episode?.id || '');
  _selectedVideoSubtitleId = '';
  _selectedVideoAudioTrackId = '';
  _videoPendingSourceState = null;
  _videoAudioStreamOffsetSeconds = 0;
  _videoAltAudioOutputMuted = false;
  clearVideoLibraryAltAudioPlayer();
  openVideoLibraryDetail(String(seriesId || ''));
}

function videoLibrarySeriesCount(videos = []) {
  const keys = new Set();
  videos.forEach((video) => {
    if (!videoLibraryIsSeries(video)) return;
    const key = videoLibrarySeriesKey(video);
    if (key) keys.add(key);
  });
  return keys.size;
}

function videoLibraryThemeFor(video) {
  const themes = [
    { bg: 'linear-gradient(180deg,#18210b 0%,#11170a 100%)', emoji: '💣' },
    { bg: 'linear-gradient(180deg,#271514 0%,#1b1110 100%)', emoji: '🦅' },
    { bg: 'linear-gradient(180deg,#1b2748 0%,#151d33 100%)', emoji: '🐉' },
    { bg: 'linear-gradient(180deg,#151429 0%,#0d0d18 100%)', emoji: '⚡' },
    { bg: 'linear-gradient(180deg,#20171f 0%,#131017 100%)', emoji: '💥' },
    { bg: 'linear-gradient(180deg,#3a2613 0%,#21160d 100%)', emoji: '⚔️' },
    { bg: 'linear-gradient(180deg,#1b2f10 0%,#111a0c 100%)', emoji: '🎉' },
    { bg: 'linear-gradient(180deg,#24163d 0%,#171024 100%)', emoji: '💍' },
    { bg: 'linear-gradient(180deg,#0f1824 0%,#0d1117 100%)', emoji: '🦇' },
    { bg: 'linear-gradient(180deg,#1b2220 0%,#111514 100%)', emoji: '🎬' },
  ];
  const key = String(video?.title || video?.catalog_title || video?.folder || video?.id || '');
  const seed = [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return themes[seed % themes.length];
}

function renderVideoShelfPoster(video, tall = true) {
  const theme = videoLibraryThemeFor(video);
  const year = escHtml(String(video?.release_year || video?.year || ''));
  const posterUrl = video?.poster_stream_url || '';
  if (posterUrl) {
    return `
      <div class="videos-shelf-poster ${tall ? 'tall' : 'small'}" style="background-image:url('${escHtml(posterUrl)}')">
        ${year ? `<span class="videos-shelf-year">${year}</span>` : ''}
      </div>`;
  }
  return `
    <div class="videos-shelf-poster ${tall ? 'tall' : 'small'}" style="background:${theme.bg}">
      <span class="videos-shelf-poster-emoji">${theme.emoji}</span>
      ${year ? `<span class="videos-shelf-year">${year}</span>` : ''}
    </div>`;
}

function renderVideoShelfCard(video, options = {}) {
  const compact = !!options.compact;
  const genres = videoLibraryGenresFor(video);
  const year = String(video?.release_year || video?.year || '').trim();
  const media = videoLibraryIsSeries(video) ? 'Series' : 'Movie';
  const title = videoLibraryIsSeries(video)
    ? videoLibrarySeriesDisplayTitle(video)
    : (video?.title || video?.catalog_title || 'Untitled');
  const secondary = [year, genres[0] || media].filter(Boolean).join(' · ');
  return `
    <button class="videos-shelf-card ${compact ? 'compact' : ''}" type="button" onclick="openVideoLibraryDetail('${String(video?.id || '').replace(/'/g, "\\'")}')">
      ${renderVideoShelfPoster(video, !compact)}
      <div class="videos-shelf-copy">
        <div class="videos-shelf-name">${escHtml(title)}</div>
        <div class="videos-shelf-meta">${escHtml(secondary || media)}</div>
      </div>
      ${videoProgressPercent(video?.progress) > 0 ? `<div class="videos-shelf-progress"><span style="width:${videoProgressPercent(video.progress)}%"></span></div>` : ''}
    </button>`;
}

function renderVideoSection(title, videos = [], options = {}) {
  if (!videos.length) return '';
  return `
    <section class="videos-section"${options.sectionId ? ` id="${escHtml(options.sectionId)}"` : ''}>
      <div class="videos-section-head">
        <div class="videos-section-title">${options.accent ? `<span>${escHtml(options.accent)}</span> ` : ''}${escHtml(title)}</div>
        <div class="videos-section-side">
          <span class="videos-section-count">${escHtml(options.countLabel || `${videos.length} titles`)}</span>
          ${options.genre ? `<button type="button" class="videos-section-seeall" onclick="setVideoLibraryGenreFilter('${String(options.genre).replace(/'/g, "\\'")}')">See all</button>` : (options.scrollTarget ? `<button type="button" class="videos-section-seeall" onclick="scrollVideoLibrarySection('${String(options.scrollTarget).replace(/'/g, "\\'")}')">See all</button>` : '')}
        </div>
      </div>
      <div class="videos-shelf-track">
        ${videos.map((video) => renderVideoShelfCard(video, { compact: !!options.compact })).join('')}
      </div>
    </section>`;
}

function renderVideoGridSection(title, videos = [], options = {}) {
  if (!videos.length) return '';
  return `
    <section class="videos-section" id="${escHtml(options.sectionId || 'videos-all-grid')}">
      <div class="videos-section-head">
        <div class="videos-section-title">${options.accent ? `<span>${escHtml(options.accent)}</span> ` : ''}${escHtml(title)}</div>
        <div class="videos-section-side">
          <span class="videos-section-count">${escHtml(`${videos.length} titles`)}</span>
        </div>
      </div>
      <div class="videos-grid">
        ${videos.map((video) => renderVideoShelfCard(video)).join('')}
      </div>
    </section>`;
}

function scrollVideoLibrarySection(id) {
  const node = document.getElementById(String(id || '').trim());
  if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function videoLibraryRelatedVideos(video, limit = 4) {
  if (!video) return [];
  const allVideos = Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos : [];
  const primaryGenres = videoLibraryGenresFor(video).map((genre) => genre.toLowerCase());
  const primaryIsSeries = videoLibraryIsSeries(video);
  return allVideos
    .filter((item) => String(item?.id) !== String(video?.id))
    .map((item) => {
      const relatedGenres = videoLibraryGenresFor(item).map((genre) => genre.toLowerCase());
      let score = 0;
      if (videoLibraryIsSeries(item) === primaryIsSeries) score += 2;
      if (String(item?.release_year || '') === String(video?.release_year || '')) score += 1;
      if (primaryGenres.some((genre) => relatedGenres.includes(genre))) score += 3;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score || String(a.item?.title || '').localeCompare(String(b.item?.title || '')))
    .filter((row) => row.score > 0)
    .slice(0, limit)
    .map((row) => row.item);
}

function closeVideoLibraryDetail() {
  const player = getVideoLibraryPlayer();
  if (player) {
    try { videoPlayerPause(); } catch (_err) {}
  }
  disposeVideoLibraryPlayer();
  cancelPendingVideoAudioSwitch();
  _videoAltAudioOutputMuted = false;
  clearVideoLibraryAltAudioPlayer();
  _videoDetailSeasonKey = '';
  flushVideoPlaybackProgress().catch(() => {}).finally(() => {
    closeModal();
  });
}

function openVideoLibraryDetail(videoId) {
  const allVideos = Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos : [];
  const seriesMode = String(videoId || '').startsWith('series:');
  const seriesGroup = seriesMode ? videoLibraryFindSeriesGroupById(videoId, allVideos) : null;
  const video = seriesMode
    ? videoLibrarySelectSeriesEpisode(seriesGroup, _selectedVideoLibraryId)
    : allVideos.find((item) => String(item?.id) === String(videoId || ''));
  if (!video) return;
  rememberVideoPlaylistScroll(videoId);
  flushVideoPlaybackProgress().catch(() => {}).finally(() => {
    _selectedVideoLibraryId = String(video.id || '');
    _selectedVideoSubtitleId = '';
    const audioTracks = videoLibraryAudioTracks(video);
    const savedAudioTrackId = getSavedVideoAudioTrackId(video);
    const initialAudioTrackId = audioTracks.some((track) => String(track.id || '') === String(savedAudioTrackId || ''))
      ? String(savedAudioTrackId || '')
      : '';
    const deferInitialAudioSwitch = !!initialAudioTrackId;
    const scheduleInitialAudioSwitch = () => {
      if (!(deferInitialAudioSwitch && initialAudioTrackId)) return;
      const playerEl = getVideoLibraryPlayer();
      if (!playerEl) return;
      const runSwitch = () => {
        const activeVideo = videoLibrarySelectedVideo();
        const activePlayer = getVideoLibraryPlayer();
        if (!activeVideo || !activePlayer || String(activeVideo.id || '') !== String(video.id || '')) return;
        if (String(_selectedVideoAudioTrackId || '') === String(initialAudioTrackId || '')) return;
        setVideoAudioTrack(initialAudioTrackId);
      };
      if (Number(playerEl.readyState || 0) >= 3) {
        setTimeout(runSwitch, 0);
        return;
      }
      playerEl.addEventListener('canplay', runSwitch, { once: true });
    };
    _selectedVideoAudioTrackId = deferInitialAudioSwitch ? '' : initialAudioTrackId;
    cancelPendingVideoAudioSwitch();
    _videoPendingSourceState = null;
    _videoAudioStreamOffsetSeconds = 0;
    _videoAltAudioOutputMuted = false;
    clearVideoLibraryAltAudioPlayer();
    const genres = videoLibraryGenresFor(video);
    const defaultAudioTrack = videoLibraryDefaultAudioTrack(video);
    const hasAltAudio = audioTracks.length > 1;
    const effectiveMediaType = videoLibraryIsSeries(video) ? 'series' : 'movie';
    const details = [
      ['Type', effectiveMediaType],
      ['Year', String(video?.release_year || video?.year || '-')],
      ['Size', videoLibraryFormatBytes(seriesGroup ? seriesGroup.size_bytes : (video?.size_bytes || 0))],
      ['Files', `${Number(seriesGroup ? seriesGroup.episode_count : (video?.file_count || 1))} ${seriesGroup ? 'episode' : 'file'}${Number(seriesGroup ? seriesGroup.episode_count : (video?.file_count || 1)) === 1 ? '' : 's'}`],
      ...(hasAltAudio ? [['Audio', `${audioTracks.length} tracks`]] : []),
      ['Status', String(video?.available === false ? 'not available' : (videoProgressLabel(video?.progress) || 'scanned'))],
    ];
    const related = videoLibraryRelatedVideos(video, 5);
    const seasonGroups = (seriesGroup && videoLibraryGroupHasRealEpisodes(seriesGroup))
      ? videoLibrarySeasonGroups(seriesGroup.entries)
      : [];
    const activeSeasonKey = _videoDetailSeasonKey || videoLibrarySeasonKeyForVideo(video);
    const activeSeasonGroup = seasonGroups.find((group) => String(group.key) === String(activeSeasonKey))
      || seasonGroups.find((group) => group.entries.some((entry) => String(entry?.id || '') === String(video?.id || '')))
      || seasonGroups[0]
      || null;
    if (activeSeasonGroup?.key) _videoDetailSeasonKey = String(activeSeasonGroup.key);
    const nextEpisode = (seriesGroup && videoLibraryGroupHasRealEpisodes(seriesGroup))
      ? (() => {
          const currentIndex = seriesGroup.entries.findIndex((entry) => String(entry?.id) === String(video?.id || ''));
          return currentIndex >= 0 ? (seriesGroup.entries[currentIndex + 1] || null) : null;
        })()
      : null;
    window.__modalClassName = 'modal-wide video-library-detail-modal-shell';
    openModal('', `
      <div class="video-detail-shell">
        <div class="video-detail-top">
          <div class="video-detail-copy">
            <div class="video-detail-title">${escHtml(seriesGroup?.title || video?.title || 'Video')}</div>
            <div class="video-detail-meta">
              <span>${escHtml(effectiveMediaType)}</span>
              <span>&middot;</span>
              <span>${escHtml(String(video?.release_year || video?.year || '-'))}</span>
              ${genres.length ? `<span>&middot;</span><span class="video-detail-tags">${genres.map((genre) => `<span class="video-detail-tag">${escHtml(genre)}</span>`).join('')}</span>` : ''}
            </div>
            ${videoLibraryNowPlayingLabel(video) ? `<div class="video-detail-playing">${escHtml(videoLibraryNowPlayingLabel(video))}</div>` : ''}
          </div>
          <button type="button" class="video-detail-close" onclick="closeVideoLibraryDetail()">×</button>
        </div>
        <div class="video-detail-body">
          <div class="video-detail-player-col">
            <div class="video-detail-frame">
              ${video?.available === false
                ? `<div class="video-detail-unavailable"><div>File not available on server.</div></div>`
                : `<video id="videoLibraryPlayer" class="videos-player video-detail-media" controlslist="nodownload noplaybackrate noremoteplayback" disablepictureinpicture disableremoteplayback preload="auto" playsinline oncontextmenu="return false">${videoLibrarySubtitleTracks(video)}</video>`}
              ${video?.available === false ? '' : `<div id="videoSubtitleOverlay" class="video-subtitle-overlay" aria-live="polite" aria-atomic="true"></div>`}
            </div>
            ${video?.available === false ? '' : `<div class="video-detail-controls-wrap">
              <div class="video-detail-timeline">
                <span id="videoTimeCurrent" class="video-detail-time">0:00</span>
                <input id="videoSeekBar" class="video-detail-seek" type="range" min="0" max="1000" value="0" step="1" oninput="videoPlayerSeekTo(this.value)" aria-label="Seek video">
                <span id="videoTimeDuration" class="video-detail-time">0:00</span>
              </div>
              <div class="video-detail-controls">
              <button id="videoControlPlay" class="videos-control-btn" type="button" onclick="videoPlayerToggle()">${videoControlIcon('play')}</button>
              <button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoPlayerSeek(-10)">${videoControlIcon('back')}<span>-10</span></button>
              <button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoPlayerSeek(10)">${videoControlIcon('forward')}<span>+10</span></button>
              ${nextEpisode ? `<button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoLibraryPlaySeriesEpisode('${String(seriesGroup?.id || '').replace(/'/g, "\\'")}', '${String(nextEpisode?.id || '').replace(/'/g, "\\'")}')">${videoControlIcon('forward')}<span>Next</span></button>` : ''}
              <button id="videoControlMute" class="videos-control-btn" type="button" onclick="videoPlayerMute()">${videoControlIcon('volume')}</button>
              ${(video?.subtitles || []).length ? `<button id="videoControlSubtitle" class="videos-control-btn videos-control-btn-subtitle" type="button" onclick="videoPlayerSubtitleToggle()">${videoControlIcon('subtitle')}</button>` : ''}
              ${hasAltAudio ? `<label class="videos-inline-select video-detail-audio-picker" title="Audio track">
                <span class="videos-inline-icon">${videoControlIcon('volume')}</span>
                <select id="videoAudioTrackSelect" onchange="setVideoAudioTrack(this.value)" aria-label="Audio track">
                  <option value="">${escHtml(defaultAudioTrack?.short_label || 'Default audio')}</option>
                  ${audioTracks.map((track) => `<option value="${escHtml(track.id || '')}" ${String(track.id || '') === String(initialAudioTrackId || '') ? 'selected' : ''}>${escHtml(track.label || track.short_label || 'Audio')}</option>`).join('')}
                </select>
              </label>` : ''}
              <button id="videoControlSpeed" class="videos-control-btn videos-control-btn-speed" type="button" onclick="videoPlayerCycleRate()">${videoControlIcon('speed')}<span>1x</span></button>
              <button class="videos-control-btn videos-control-btn-primary" type="button" onclick="videoPlayerFullscreen()">${videoControlIcon('fullscreen')}</button>
              </div>
              ${activeSeasonGroup ? `<div class="video-detail-season-nav">
                <div class="video-detail-season-nav-head">Browse Episodes</div>
                <div class="video-detail-season-tiles">
                  ${seasonGroups.map((group) => `
                    <button type="button" class="video-detail-season-tile ${String(group.key) === String(activeSeasonGroup?.key || '') ? 'active' : ''}" onclick="setVideoLibraryDetailSeason('${String(seriesGroup?.id || '').replace(/'/g, "\\'")}', '${String(group.key || '').replace(/'/g, "\\'")}')">
                      <span>${escHtml(group.season_label || 'Season')}</span>
                      <small>${escHtml(`${group.entries.length} episode${group.entries.length === 1 ? '' : 's'}`)}</small>
                    </button>`).join('')}
                </div>
                <div class="video-detail-season-current">
                  <div class="video-detail-season-current-title">${escHtml(activeSeasonGroup.season_label || 'Season')}</div>
                  <div class="video-detail-season-current-meta">${escHtml(`${activeSeasonGroup.entries.length} episode${activeSeasonGroup.entries.length === 1 ? '' : 's'} in this season`)}</div>
                </div>
                <div class="video-detail-main-episodes">
                  ${activeSeasonGroup.entries.map((entry) => `
                    <button type="button" class="video-detail-main-episode ${String(entry?.id || '') === String(video?.id || '') ? 'active' : ''}" onclick="videoLibraryPlaySeriesEpisode('${String(seriesGroup?.id || '').replace(/'/g, "\\'")}', '${String(entry?.id || '').replace(/'/g, "\\'")}')">
                      <div class="video-detail-main-episode-badge">${escHtml(Number(entry?.episode_number || 0) > 0 ? `E${String(entry.episode_number).padStart(2, '0')}` : 'PLAY')}</div>
                      <div class="video-detail-main-episode-copy">
                        <div class="video-detail-main-episode-title">${escHtml(videoLibraryEpisodeLabel(entry))}</div>
                        <div class="video-detail-main-episode-meta">${escHtml(String(entry?.id || '') === String(video?.id || '') ? 'Now playing' : (videoProgressLabel(entry?.progress) || videoLibraryFormatBytes(entry?.size_bytes || 0)))}</div>
                      </div>
                    </button>`).join('')}
                </div>
              </div>` : ''}
            </div>`}
          </div>
          <aside class="video-detail-side">
            <div class="video-detail-panel">
              ${details.map(([label, value]) => `
                <div class="video-detail-kv">
                  <div class="video-detail-kv-label">${escHtml(label)}</div>
                  <div class="video-detail-kv-value">${escHtml(value)}</div>
                </div>`).join('')}
            </div>
            ${seriesGroup && videoLibraryGroupHasRealEpisodes(seriesGroup) && !activeSeasonGroup ? `<div class="video-detail-panel">
              <div class="video-detail-more-title">Seasons & Episodes</div>
              <div class="video-detail-episode-list">
                ${videoLibrarySeasonGroups(seriesGroup.entries).map((seasonGroup) => `
                  <div class="video-detail-season-group">
                    <div class="video-detail-season-title">${escHtml(seasonGroup.season_label || 'Season')}</div>
                    ${seasonGroup.entries.map((entry) => `
                      <button type="button" class="video-detail-episode-item ${String(entry?.id || '') === String(video?.id || '') ? 'active' : ''}" onclick="videoLibraryPlaySeriesEpisode('${String(seriesGroup?.id || '').replace(/'/g, "\\'")}', '${String(entry?.id || '').replace(/'/g, "\\'")}')">
                        <div class="video-detail-episode-title">${escHtml(videoLibraryEpisodeLabel(entry))}</div>
                        <div class="video-detail-episode-meta">${escHtml(videoProgressLabel(entry?.progress) || videoLibraryFormatBytes(entry?.size_bytes || 0))}</div>
                      </button>`).join('')}
                  </div>`).join('')}
              </div>
            </div>` : ''}
            <div class="video-detail-panel video-detail-description">${escHtml(video?.synopsis || video?.overview || 'No description available yet.')}</div>
            <div class="video-detail-panel">
              <div class="video-detail-more-title">More Like This</div>
              <div class="video-detail-more-list">
                ${related.length ? related.map((item) => `
                  <button type="button" class="video-detail-related" onclick="openVideoLibraryDetail('${String(item?.id || '').replace(/'/g, "\\'")}')">
                    ${renderVideoShelfPoster(item, false)}
                    <div class="video-detail-related-copy">
                      <div class="video-detail-related-title">${escHtml(item?.title || 'Video')}</div>
                      <div class="video-detail-related-meta">${escHtml(String(item?.release_year || item?.year || '-'))}</div>
                    </div>
                  </button>`).join('') : `<div class="video-detail-related-empty">No related titles yet.</div>`}
              </div>
            </div>
          </aside>
        </div>
      </div>`);
    requestAnimationFrame(() => {
      scrollVideoDetailActiveEpisodeIntoView();
      (async () => {
        await initializeVideoLibraryPlayer(video, deferInitialAudioSwitch ? '' : initialAudioTrackId);
        _videoProgressBoundVideoId = '';
        setupVideoPlayerProgress();
        updateVideoControlsUI();
        const audioSelect = document.getElementById('videoAudioTrackSelect');
        if (audioSelect) audioSelect.value = initialAudioTrackId || '';
        scheduleInitialAudioSwitch();
      })().catch(() => {
        setVideoLibraryPlayerSource(video, deferInitialAudioSwitch ? '' : initialAudioTrackId);
        _videoProgressBoundVideoId = '';
        setupVideoPlayerProgress();
        updateVideoControlsUI();
        const audioSelect = document.getElementById('videoAudioTrackSelect');
        if (audioSelect) audioSelect.value = initialAudioTrackId || '';
        scheduleInitialAudioSwitch();
      });
    });
  });
}

function videoLibraryOpenRandom() {
  const filtered = videoLibraryFilteredVideos();
  if (!filtered.length) return;
  const pick = filtered[Math.floor(Math.random() * filtered.length)];
  openVideoLibraryDetail(pick?.id);
}

function renderVideosPage() {
  const main = document.getElementById('main');
  if (!main) return;

  if (_videoLibraryLoading) {
    main.innerHTML = `
      <div class="tab-content">
        <div class="videos-app-shell">
          <div class="videos-landing-empty">
            <div class="videos-page-title">Videos</div>
            <div class="videos-page-sub">Loading your video library...</div>
          </div>
        </div>
      </div>`;
    return;
  }

  const settings = _videoLibraryData?.settings || {};
  const subtitleEngine = _videoLibraryData?.subtitle_engine || { available: false, message: '' };
  const allVideos = Array.isArray(_videoLibraryData?.videos) ? _videoLibraryData.videos : [];
  const filteredVideos = videoLibraryFilteredVideos();
  const mediaScopedVideos = allVideos.filter((video) => {
    if (_videoLibraryMediaFilter === 'movie' && videoLibraryIsSeries(video)) return false;
    if (_videoLibraryMediaFilter === 'series' && !videoLibraryIsSeries(video)) return false;
    const query = String(_videoLibrarySearch || '').trim().toLowerCase();
    if (!query) return true;
    const haystack = [
      video.title,
      video.catalog_title,
      video.filename,
      video.folder,
      video.relative_path,
      video.media_type,
      ...(Array.isArray(video.genres) ? video.genres : []),
      ...(Array.isArray(video.cast_members) ? video.cast_members : []),
      ...(Array.isArray(video.creators) ? video.creators : []),
      ...(Array.isArray(video.tags) ? video.tags : []),
      video.synopsis,
      video.original_language,
      video.country,
      video.content_rating,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const filterGenreStats = videoLibraryGenreStats(mediaScopedVideos);
  const topGenres = filterGenreStats.slice(0, 6);
  const sectionGenreStats = videoLibraryGenreStats(filteredVideos).slice(0, 6);
  const totalSeries = videoLibrarySeriesCount(allVideos);
  const qualityLabel = allVideos.find((video) => String(video?.quality_label || '').trim())?.quality_label || 'HD';
  const featuredVideos = filteredVideos.slice(0, 3);
  const continueWatchingVideos = [...filteredVideos]
    .filter((video) => {
      const progress = video?.progress || null;
      return !!progress && !progress.is_completed && Number(progress.current_seconds || 0) > 0;
    })
    .sort((a, b) => {
      const aUpdated = new Date(a?.progress?.updated_at || a?.updated_at || 0).getTime();
      const bUpdated = new Date(b?.progress?.updated_at || b?.updated_at || 0).getTime();
      return bUpdated - aUpdated;
    })
    .slice(0, 12);
  const movieVideos = filteredVideos.filter((video) => !videoLibraryIsSeries(video));
  const seriesGroups = videoLibrarySeriesGroups(filteredVideos);
  const pathMeta = _userRole === 'admin' && settings.videos_root_path
    ? `<span class="videos-landing-meta">${escHtml(settings.videos_root_path)}</span>`
    : '';

  const adminActions = _userRole === 'admin'
    ? `
      <button class="videos-hero-btn ghost" type="button" onclick="showVideoCatalogModal()">Catalog Sync</button>
      <button class="videos-hero-btn ghost" type="button" onclick="showVideoSeriesManagerModal()">Series Manager</button>
      <button class="videos-hero-btn green" type="button" onclick="showVideoLibrarySettingsModal()">Admin Panel</button>`
    : '';

  const hero = `
    <header class="videos-hero">
      <div class="videos-nav">
        <div class="videos-brand">
          <div class="videos-brand-mark">▶</div>
          <div class="videos-brand-text">Video<span>Lib</span></div>
        </div>
        <div class="videos-nav-search">
          <span class="videos-nav-search-icon">⌕</span>
          <input id="videoLibrarySearchInput" value="${escHtml(_videoLibrarySearch)}" oninput="setVideoLibrarySearch(this.value)" placeholder="Search movies, series, genre, cast...">
        </div>
        <div class="videos-nav-actions">
          <button class="videos-hero-btn ghost" type="button" onclick="loadVideosPage()">Refresh</button>
          ${adminActions}
        </div>
      </div>
      <div class="videos-hero-main">
        <div class="videos-hero-copy">
          <div class="videos-hero-pill">Your Personal Theater</div>
          <h1 class="videos-hero-title">Watch Your <span>Library</span> Anywhere</h1>
          <p class="videos-hero-text">${escHtml(`${allVideos.length} movies & series hosted on your server, streamed directly in the browser.`)}</p>
          <div class="videos-hero-stats">
            <div><strong>${allVideos.length}</strong><span>Total Files</span></div>
            <div><strong>${totalSeries}</strong><span>Series</span></div>
            <div><strong>${escHtml(String(qualityLabel))}</strong><span>Quality</span></div>
          </div>
          <div class="videos-hero-cta">
            <button class="videos-hero-btn green" type="button" onclick="videoLibraryOpenRandom()">Play Something</button>
            <button class="videos-hero-btn ghost" type="button" onclick="videoLibraryOpenRandom()">Shuffle</button>
          </div>
        </div>
        <div class="videos-hero-art">
          ${featuredVideos.map((video, index) => `
            <button type="button" class="videos-hero-poster-card ${index === 1 ? 'focus' : ''}" onclick="openVideoLibraryDetail('${String(video?.id || '').replace(/'/g, "\\'")}')">
              ${renderVideoShelfPoster(video, true)}
            </button>`).join('')}
        </div>
      </div>
    </header>`;

  let sectionsHtml = '';
  if (!_videoLibraryData.configured) {
    sectionsHtml = `<div class="videos-landing-empty"><div class="videos-empty-title">Video folder is not configured yet</div><div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'Ask an admin to set the server folder path for videos.')}</div>${_userRole === 'admin' ? '<button class="videos-hero-btn green" style="margin-top:16px" type="button" onclick="showVideoLibrarySettingsModal()">Set Video Folder</button>' : ''}</div>`;
  } else if (!_videoLibraryData.root_exists) {
    sectionsHtml = `<div class="videos-landing-empty"><div class="videos-empty-title">Configured folder was not found</div><div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'The saved server path does not exist right now.')}</div>${_userRole === 'admin' ? '<button class="videos-hero-btn green" style="margin-top:16px" type="button" onclick="showVideoLibrarySettingsModal()">Fix Folder Path</button>' : ''}</div>`;
  } else if (!filteredVideos.length) {
    sectionsHtml = `<div class="videos-landing-empty"><div class="videos-empty-title">${allVideos.length ? 'No videos match this filter' : 'No videos found yet'}</div><div class="videos-empty-sub">${escHtml(_videoLibraryData.message || 'Put supported files like MP4 or WebM inside the configured folder.')}</div></div>`;
  } else {
    const visibleSeriesGroups = (_videoLibraryMediaFilter === 'movie' || _videoLibraryGenreFilter !== 'all')
      ? []
      : seriesGroups;
    const visibleMovieVideos = (_videoLibraryMediaFilter === 'series')
      ? []
      : (_videoLibraryGenreFilter === 'all'
        ? movieVideos
        : movieVideos.filter((video) => videoLibraryGenresFor(video).some((name) => name.toLowerCase() === String(_videoLibraryGenreFilter || '').toLowerCase())));
    const emptyFilterMessage = _videoLibraryGenreFilter !== 'all'
      ? `No ${String(_videoLibraryGenreFilter || '').trim()} titles found in this view.`
      : 'No titles found for this selection.';

    sectionsHtml = `
      <div class="videos-filter-row">
        <button type="button" class="videos-filter-chip ${_videoLibraryMediaFilter === 'all' ? 'active' : ''}" onclick="setVideoLibraryMediaFilter('all')">All</button>
        <button type="button" class="videos-filter-chip ${_videoLibraryMediaFilter === 'movie' ? 'active' : ''}" onclick="setVideoLibraryMediaFilter('movie')">Movies</button>
        <button type="button" class="videos-filter-chip ${_videoLibraryMediaFilter === 'series' ? 'active' : ''}" onclick="setVideoLibraryMediaFilter('series')">Series</button>
        ${topGenres.map((genre) => `<button type="button" class="videos-filter-chip ${String(_videoLibraryGenreFilter || '').toLowerCase() === String(genre.name || '').toLowerCase() ? 'active' : ''}" onclick="setVideoLibraryGenreFilter('${String(genre.name).replace(/'/g, "\\'")}')">${escHtml(genre.name)}</button>`).join('')}
        ${pathMeta}
        <span class="videos-landing-meta">${filteredVideos.length} files</span>
      </div>
      ${visibleSeriesGroups.length ? renderVideoSection('Series', visibleSeriesGroups, { countLabel: `${visibleSeriesGroups.length} title${visibleSeriesGroups.length === 1 ? '' : 's'}` }) : ''}
      ${visibleMovieVideos.length ? renderVideoSection('Movies', visibleMovieVideos, { countLabel: `${visibleMovieVideos.length} title${visibleMovieVideos.length === 1 ? '' : 's'}` }) : ''}
      ${(!visibleSeriesGroups.length && !visibleMovieVideos.length) ? `<div class="videos-landing-empty"><div class="videos-empty-title">Nothing to show</div><div class="videos-empty-sub">${escHtml(emptyFilterMessage)}</div></div>` : ''}
    `;
  }

  main.innerHTML = `
    <div class="tab-content">
      <div class="videos-app-shell">
        ${hero}
        ${!subtitleEngine.available && subtitleEngine.message ? `<div class="videos-engine-note">${escHtml(subtitleEngine.message)}</div>` : ''}
        <div class="videos-content-shell">
          ${sectionsHtml}
        </div>
      </div>
    </div>`;
}

function getVideoLibraryPlayer() {
  return document.getElementById('videoLibraryPlayer');
}

function videoPlayerSubtitleToggle() {
  const selectedVideo = videoLibrarySelectedVideo();
  const subtitles = Array.isArray(selectedVideo?.subtitles) ? selectedVideo.subtitles : [];
  if (!subtitles.length) return;
  const currentIndex = subtitles.findIndex((subtitle) => String(subtitle.id) === String(_selectedVideoSubtitleId || ''));
  if (currentIndex < 0) {
    setVideoSubtitle(subtitles[0]?.id || '');
    return;
  }
  if (currentIndex >= subtitles.length - 1) {
    setVideoSubtitle('');
    return;
  }
  setVideoSubtitle(subtitles[currentIndex + 1]?.id || '');
}

function updateVideoControlsUI() {
  const player = getVideoLibraryPlayer();
  const selectedVideo = videoLibrarySelectedVideo();
  const playBtn = document.getElementById('videoControlPlay');
  const muteBtn = document.getElementById('videoControlMute');
  const subtitleBtn = document.getElementById('videoControlSubtitle');
  const speedBtn = document.getElementById('videoControlSpeed');
  const seekBar = document.getElementById('videoSeekBar');
  const timeCurrent = document.getElementById('videoTimeCurrent');
  const timeDuration = document.getElementById('videoTimeDuration');
  const audioSelect = document.getElementById('videoAudioTrackSelect');

  if (playBtn && player) {
    const paused = videoPlayerIsPaused(player);
    playBtn.innerHTML = paused ? videoControlIcon('play') : videoControlIcon('pause');
    playBtn.title = paused ? 'Play' : 'Pause';
    playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    playBtn.classList.toggle('active', !paused);
  }

  if (muteBtn && player) {
    const muted = videoPlayerIsMuted(player);
    muteBtn.innerHTML = muted ? videoControlIcon('mute') : videoControlIcon('volume');
    muteBtn.title = muted ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    muteBtn.classList.toggle('active', !muted);
  }

  if (subtitleBtn) {
    const subtitleOn = !!_selectedVideoSubtitleId;
    const subtitles = Array.isArray(selectedVideo?.subtitles) ? selectedVideo.subtitles : [];
    const activeSubtitle = subtitles.find((subtitle) => String(subtitle.id) === String(_selectedVideoSubtitleId || ''));
    subtitleBtn.classList.toggle('active', subtitleOn);
    subtitleBtn.title = subtitleOn ? `Subtitles: ${activeSubtitle?.label || 'On'}` : 'Subtitles off';
    subtitleBtn.setAttribute('aria-label', subtitleOn ? `Subtitles ${activeSubtitle?.label || 'on'}` : 'Subtitles off');
  }

  if (audioSelect) {
    const activeAudio = videoLibraryAudioTracks(selectedVideo).find((track) => String(track.id || '') === String(_selectedVideoAudioTrackId || ''));
    const defaultAudio = videoLibraryDefaultAudioTrack(selectedVideo);
    audioSelect.value = String(_selectedVideoAudioTrackId || '');
    audioSelect.title = _videoAudioSwitchLoading
      ? `Preparing ${activeAudio?.label || defaultAudio?.label || 'audio track'}...`
      : (activeAudio?.label || defaultAudio?.label || 'Audio track');
  }

  if (speedBtn && player) {
    const rate = videoPlayerPlaybackRate(player);
    const label = Number.isInteger(rate) ? `${rate}x` : `${rate.toFixed(2).replace(/0$/, '')}x`;
    speedBtn.innerHTML = `${videoControlIcon('speed')}<span>${label}</span>`;
    speedBtn.title = `Playback speed ${label}`;
    speedBtn.setAttribute('aria-label', `Playback speed ${label}`);
  }

  if (player && seekBar) {
    const current = videoPlayerCurrentSeconds(player, selectedVideo);
    const duration = videoPlayerExpectedDuration(player, selectedVideo);
    const progress = duration > 0 ? Math.max(0, Math.min(1000, Math.round((current / duration) * 1000))) : 0;
    seekBar.value = String(progress);
    seekBar.disabled = !(duration > 0);
    seekBar.style.setProperty('--seek-fill', `${progress / 10}%`);
    if (timeCurrent) timeCurrent.textContent = videoFormatTime(current);
    if (timeDuration) timeDuration.textContent = videoFormatTime(duration);
  } else {
    if (timeCurrent) timeCurrent.textContent = '0:00';
    if (timeDuration) timeDuration.textContent = '0:00';
  }
  renderVideoSubtitleCue();
}

function videoPlayerToggle() {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  if (videoPlayerIsPaused(player)) {
    _videoPendingSourceState = null;
    videoPlayerPlay().catch(() => {});
  }
  else videoPlayerPause();
}

function videoPlayerSeek(seconds) {
  const player = getVideoLibraryPlayer();
  const video = videoLibrarySelectedVideo();
  if (!player || !video) return;
  _videoPendingSourceState = null;
  const duration = Number(videoPlayerExpectedDuration(player, video) || videoPlayerSeekableDuration(player) || 0);
  const upperBound = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
  const target = Math.max(0, Math.min(upperBound, videoPlayerCurrentSeconds(player, video) + Number(seconds || 0)));
  if (videoPlayerIsAltAudioActive()) {
    setVideoAudioTrackPosition(target, !videoPlayerIsPaused(player));
    return;
  }
  setVideoPlayerCurrentTime(target);
  updateVideoControlsUI();
}

function videoPlayerSeekTo(value) {
  const player = getVideoLibraryPlayer();
  const video = videoLibrarySelectedVideo();
  if (!player || !video) return;
  _videoPendingSourceState = null;
  const duration = Number(videoPlayerExpectedDuration(player, video) || videoPlayerSeekableDuration(player) || 0);
  const progress = Number(value || 0);
  if (!(duration > 0)) return;
  const target = Math.max(0, Math.min(duration, (progress / 1000) * duration));
  if (videoPlayerIsAltAudioActive()) {
    setVideoAudioTrackPosition(target, !videoPlayerIsPaused(player));
    return;
  }
  setVideoPlayerCurrentTime(target);
  updateVideoControlsUI();
}

function videoPlayerMute() {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  setVideoPlayerMuted(!videoPlayerIsMuted(player));
  updateVideoControlsUI();
}

function setVideoAudioTrack(value) {
  const video = videoLibrarySelectedVideo();
  const player = getVideoLibraryPlayer();
  const tracks = videoLibraryAudioTracks(video);
  const candidateValue = tracks.some((track) => String(track.id || '') === String(value || '')) ? String(value || '') : '';
  const nextValue = normalizeVideoAudioTrackSelection(video, candidateValue);
  if (String(_selectedVideoAudioTrackId || '') === nextValue) {
    updateVideoControlsUI();
    return;
  }
  cancelPendingVideoAudioSwitch();
  _selectedVideoAudioTrackId = nextValue;
  saveVideoAudioTrackPreference(video, nextValue);
  if (!player || !video) {
    _videoAudioStreamOffsetSeconds = 0;
    _videoAltAudioOutputMuted = false;
    _videoPendingSourceState = null;
    clearVideoLibraryAltAudioPlayer();
    updateVideoControlsUI();
    return;
  }
  const resumeAt = videoPlayerCurrentSeconds(player, video);
  const wasPlaying = !videoPlayerIsPaused(player);
  const muted = videoPlayerIsMuted(player);
  const playbackRate = videoPlayerPlaybackRate(player);
  if (!nextValue) {
    cancelPendingVideoAudioSwitch();
    clearVideoLibraryAltAudioPlayer();
    _videoPendingSourceState = {
      currentTime: resumeAt,
      wasPlaying,
      muted,
      playbackRate,
      expectedDuration: videoPlayerExpectedDuration(player, video),
      reason: 'audio-switch',
    };
    setVideoLibraryPlayerSource(video, '');
    _videoAudioStreamOffsetSeconds = 0;
    _videoAltAudioOutputMuted = false;
    _videoAltAudioReady = false;
    updateVideoControlsUI();
    return;
  }
  _videoPendingSourceState = {
    currentTime: resumeAt,
    wasPlaying,
    muted,
    playbackRate,
    expectedDuration: videoPlayerExpectedDuration(player, video),
    reason: 'audio-switch',
  };
  clearVideoLibraryAltAudioPlayer();
  _videoAudioSwitchLoading = true;
  setVideoLibraryPlayerSource(video, nextValue);
  _videoAudioSwitchLoading = false;
  updateVideoControlsUI();
}

function setVideoAudioTrackPosition(targetSeconds, autoplay = true) {
  const video = videoLibrarySelectedVideo();
  const player = getVideoLibraryPlayer();
  if (!video || !player || !videoPlayerIsAltAudioActive()) return;
  const clampedTarget = Math.max(0, Number(targetSeconds || 0));
  setVideoPlayerCurrentTime(clampedTarget);
  updateVideoControlsUI();
}

function videoPlayerRate(value) {
  const player = getVideoLibraryPlayer();
  const rate = Number(value || 1);
  if (!player || !Number.isFinite(rate) || rate <= 0) return;
  setVideoPlayerPlaybackRate(rate);
}

function videoPlayerCycleRate() {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  const options = [0.75, 1, 1.25, 1.5, 2];
  const current = videoPlayerPlaybackRate(player);
  const currentIndex = options.findIndex((rate) => Math.abs(rate - current) < 0.01);
  const nextRate = options[(currentIndex + 1 + options.length) % options.length];
  setVideoPlayerPlaybackRate(nextRate);
  updateVideoControlsUI();
}

function videoPlayerFullscreen() {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  videoPlayerRequestFullscreen().catch(() => {});
}

function videoCatalogStatusOptions() {
  return [
    { value: 'all', label: 'All' },
    { value: 'scanned', label: 'Scanned' },
    { value: 'review', label: 'Review' },
    { value: 'published', label: 'Published' },
  ];
}

function renderVideoCatalogModal() {
  window.__modalClassName = 'modal-wide video-catalog-shell-modal';
  const items = Array.isArray(_videoCatalogModalState.items) ? _videoCatalogModalState.items : [];
  const counts = items.reduce((acc, item) => {
    const key = String(item.status || 'scanned');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const selectedStatus = String(_videoCatalogModalState.status || 'all');
  openModal('Video Catalog Sync', `
    <div class="fg">
      <label class="fl full">Scan Path
        <input class="fi" id="videoCatalogScanPath" value="${escHtml(_videoCatalogModalState.path || '')}" placeholder="Server folder path">
      </label>
      <div class="fa">
        <button class="btn btn-p" onclick="videoCatalogScanNow()" ${_videoCatalogModalState.loading ? 'disabled' : ''}>Scan Folder</button>
        <button class="btn btn-s" onclick="videoCatalogPublishReviewReady()">Publish Review Ready</button>
      </div>
      <div class="fa" style="margin-top:8px">
        ${videoCatalogStatusOptions().map((option) => `<button class="btn ${selectedStatus === option.value ? 'btn-p' : 'btn-s'} btn-sm" onclick="videoCatalogSetStatus('${option.value}')">${option.label}${counts[option.value] ? ` (${counts[option.value]})` : ''}</button>`).join('')}
      </div>
      <div style="max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:18px;padding:12px;margin-top:12px">
        ${items.length ? items
          .filter((item) => selectedStatus === 'all' || String(item.status || '') === selectedStatus)
          .map((item) => `
            <div style="padding:14px 12px;border:1px solid var(--line);border-radius:16px;margin-bottom:12px;background:#fff">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                <div>
                  <div style="font-weight:800;font-size:18px">${escHtml(item.display_title || item.folder_name || 'Untitled')}</div>
                  <div style="color:var(--t3);font-size:13px;margin-top:4px">${escHtml(item.media_type || 'movie')} ${item.release_year ? `• ${escHtml(String(item.release_year))}` : ''} ${item.file_exists === false ? '• Not available' : ''}</div>
                </div>
                <button class="btn btn-s btn-sm" onclick="videoCatalogPublishItem(${Number(item.id || 0)})">Publish</button>
              </div>
              <div style="margin-top:8px;color:var(--t2);font-size:13px">${escHtml((item.genres || []).join(', ') || '-')}</div>
              ${item.synopsis ? `<div style="margin-top:8px;color:var(--t2);line-height:1.55">${escHtml(item.synopsis)}</div>` : ''}
              <div style="margin-top:8px;color:var(--t3);font-size:12px">Files: ${Number(item.file_count || 0)} • Confidence: ${Number(item.ai_confidence || 0)} • Status: ${escHtml(item.status || 'scanned')}</div>
            </div>`).join('')
          : '<div style="color:var(--t3)">No catalog entries yet. Scan a folder first.</div>'}
      </div>
    </div>`);
}

async function loadVideoCatalogItems() {
  const result = await api(`/api/admin/videos/catalog?status=all&root_path=${encodeURIComponent(_videoCatalogModalState.path || '')}`);
  _videoCatalogModalState.items = Array.isArray(result?.items) ? result.items : [];
  renderVideoCatalogModal();
}

function showVideoCatalogModal() {
  if (_userRole !== 'admin') {
    toast('Only admins can manage the video catalog.', 'error');
    return;
  }
  _videoCatalogModalState.path = _videoCatalogModalState.path || _videoLibraryData?.settings?.videos_root_path || '';
  renderVideoCatalogModal();
  loadVideoCatalogItems().catch((error) => {
    console.error('loadVideoCatalogItems failed', error);
    toast(error?.message || 'Could not load catalog items.', 'error');
  });
}

function renderVideoCatalogModal() {
  window.__modalClassName = 'modal-wide video-catalog-shell-modal';
  const items = Array.isArray(_videoCatalogModalState.items) ? _videoCatalogModalState.items : [];
  const counts = items.reduce((acc, item) => {
    const key = String(item.status || 'scanned');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const selectedStatus = String(_videoCatalogModalState.status || 'all');
  const visibleItems = items.filter((item) => selectedStatus === 'all' || String(item.status || '') === selectedStatus);
  const totalCount = items.length;
  const reviewCount = Number(counts.review || 0);
  const publishedCount = Number(counts.published || 0);
  const scannedCount = Number(counts.scanned || 0);
  const statusLabel = (value) => {
    const raw = String(value || 'scanned').trim().toLowerCase();
    return raw ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}` : 'Scanned';
  };
  const itemCards = visibleItems.length
    ? visibleItems.map((item) => {
        const itemId = Number(item.id || 0);
        const posterSrc = String(item.poster_stream_url || '').trim();
        const genres = catalogCsv(item.genres);
        const castMembers = catalogCsv(item.cast_members);
        const creators = catalogCsv(item.creators);
        const tags = catalogCsv(item.tags);
        const files = Array.isArray(item.files) ? item.files : [];
        const fileRows = files.map((file) => {
          const primaryLabel = String(item.media_type || '') === 'series'
            ? [String(file.season_label || '').trim(), String(file.episode_label || file.title || file.filename || '').trim()].filter(Boolean).join(' - ')
            : String(file.title || file.filename || 'File');
          const secondaryLabel = [
            file.available === false ? 'Not available' : '',
            file.size_bytes ? videoLibraryFormatBytes(file.size_bytes) : '',
          ].filter(Boolean).join(' • ');
          return `
            <div class="video-catalog-file">
              <div class="video-catalog-file-name">${escHtml(primaryLabel || 'File')}</div>
              <div class="video-catalog-file-meta">${escHtml(secondaryLabel || '')}</div>
            </div>`;
        }).join('');
        const statusClass = (() => {
          const normalized = String(item.status || '').trim().toLowerCase();
          if (normalized === 'review') return 'tag-review';
          if (normalized === 'published') return 'tag-published';
          return 'tag-scanned';
        })();
        const statusIcon = statusClass === 'tag-review'
          ? '<span class="icon-svg" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg></span>'
          : '<span class="icon-svg" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5 6.5 11.5 12.5 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
        const publishIcon = '<span class="icon-svg" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M8 2.5v7m0-7L5.5 5m2.5-2.5L10.5 5M3 10.5v1A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
        const saveIcon = '<span class="icon-svg" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 2.5h7l2 2v8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 2.5v3h5v-3M5.5 13v-4h5v4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>';
        const summaryPills = [
          item.release_year ? `<span class="tag tag-year">${escHtml(String(item.release_year))}</span>` : '',
          `<span class="tag tag-files">Files ${Number(item.file_count || 0)}</span>`,
          `<span class="tag ${statusClass}">${statusIcon}${escHtml(statusLabel(item.status))}</span>`,
          item.file_exists === false ? `<span class="tag tag-warn">Not available</span>` : '',
        ].filter(Boolean).join('');
        return `
          <div class="vcard">
            <div class="vcard-thumb">
              ${posterSrc
                ? `<div class="video-catalog-poster" style="background-image:url('${escHtml(posterSrc)}')"></div>`
                : `<div class="video-catalog-poster video-catalog-poster-fallback">&#127909;</div>`
              }
              ${item.release_year ? `<div class="vcard-thumb-year">${escHtml(String(item.release_year))}</div>` : ''}
            </div>
            <div class="vcard-body">
              <div class="vcard-title">${escHtml(item.display_title || item.folder_name || 'Untitled')}</div>
              <div class="vcard-meta">
                <span>${escHtml(item.media_type || 'movie')}</span>
                ${item.folder_name ? `<div class="dot"></div><span>${escHtml(item.folder_name)}</span>` : ''}
              </div>
              <div class="tag-row">${summaryPills}</div>
              <div class="video-catalog-hidden-fields" aria-hidden="true">
                  <input id="videoCatalogTitle_${itemId}" value="${escHtml(item.display_title || '')}">
                  <select id="videoCatalogType_${itemId}">
                    <option value="movie" ${String(item.media_type || 'movie') === 'movie' ? 'selected' : ''}>Movie</option>
                    <option value="series" ${String(item.media_type || '') === 'series' ? 'selected' : ''}>Series</option>
                  </select>
                  <input id="videoCatalogYear_${itemId}" value="${escHtml(item.release_year != null ? String(item.release_year) : '')}">
                  <input id="videoCatalogPosterUrl_${itemId}" value="${escHtml(item.poster_url || '')}">
                  <input id="videoCatalogPosterPath_${itemId}" value="${escHtml(item.poster_relative_path || '')}">
                  <input id="videoCatalogGenres_${itemId}" value="${escHtml(genres)}">
                  <input id="videoCatalogCast_${itemId}" value="${escHtml(castMembers)}">
                  <input id="videoCatalogCreators_${itemId}" value="${escHtml(creators)}">
                  <input id="videoCatalogTags_${itemId}" value="${escHtml(tags)}">
                  <input id="videoCatalogLanguage_${itemId}" value="${escHtml(item.original_language || '')}">
                  <input id="videoCatalogCountry_${itemId}" value="${escHtml(item.country || '')}">
                  <input id="videoCatalogRating_${itemId}" value="${escHtml(item.content_rating || '')}">
                  <input id="videoCatalogRuntime_${itemId}" value="${escHtml(item.runtime_minutes != null ? String(item.runtime_minutes) : '')}">
                  <input id="videoCatalogSeasons_${itemId}" value="${escHtml(item.season_count != null ? String(item.season_count) : '')}">
                  <input id="videoCatalogEpisodes_${itemId}" value="${escHtml(item.episode_count != null ? String(item.episode_count) : '')}">
                  <textarea id="videoCatalogSynopsis_${itemId}">${escHtml(item.synopsis || '')}</textarea>
                  <textarea id="videoCatalogNotes_${itemId}">${escHtml(item.ai_notes || '')}</textarea>
              </div>
            </div>
            <div class="vcard-actions">
              <button class="vbtn pub" onclick="videoCatalogPublishItem(${itemId})">${publishIcon}<span>Publish</span></button>
              <button class="vbtn save" onclick="videoCatalogSaveItem(${itemId})">${saveIcon}<span>Save</span></button>
            </div>
          </div>`;
      }).join('')
    : '<div class="video-catalog-empty">No catalog entries yet. Scan a folder first.</div>';

  openModal('Video Catalog Sync', `
    <div class="video-catalog-modal">
      <div class="video-catalog-toolbar">
        <div class="video-catalog-hero-shell">
          <div class="video-catalog-hero">
            <div class="video-catalog-hero-mark">
              <div class="video-catalog-hero-icon">VC</div>
              <div class="video-catalog-hero-copy">
                <div class="video-catalog-hero-title">Video Catalog Sync</div>
                <div class="video-catalog-hero-sub">Catalog Workspace - Scan, enrich & publish</div>
              </div>
            </div>
            <button type="button" class="video-catalog-hero-closehint" onclick="closeModal()">&times;</button>
          </div>
          <div class="video-catalog-hero-stats">
            <div class="video-catalog-stat">
              <span class="video-catalog-stat-label">Total</span>
              <strong>${totalCount}</strong>
            </div>
            <div class="video-catalog-stat">
              <span class="video-catalog-stat-label">Scanned</span>
              <strong>${scannedCount}</strong>
            </div>
            <div class="video-catalog-stat">
              <span class="video-catalog-stat-label">Review</span>
              <strong>${reviewCount}</strong>
            </div>
            <div class="video-catalog-stat">
              <span class="video-catalog-stat-label">Published</span>
              <strong>${publishedCount}</strong>
            </div>
          </div>
          <div class="video-catalog-hero-foot">
            <span class="video-catalog-hero-progress"></span>
            <span class="video-catalog-hero-foot-text">${scannedCount}/${totalCount || scannedCount || 0} scanned</span>
          </div>
        </div>

        <div class="video-catalog-intro">
          Scan folders and publish only the entries you approve.
        </div>

        <div class="video-catalog-path-row">
          <div class="video-catalog-path-card">
            <input class="fi" id="videoCatalogScanPath" value="${escHtml(_videoCatalogModalState.path || '')}" placeholder="Scan path - e.g. /media/movies or leave blank for all">
          </div>
          <button class="btn btn-p video-catalog-browse-btn" onclick="document.getElementById('videoCatalogScanPath')?.focus()">Browse</button>
        </div>

        <div class="video-catalog-toolbar-main">
          <div class="video-catalog-toolbar-actions">
            ${videoCatalogIsBusy()
              ? `<button class="btn btn-g" onclick="videoCatalogStopNow()">Stop</button>`
              : `<button class="btn btn-p" onclick="videoCatalogScanNow()">Scan Folder</button>`}
            <button class="btn btn-s" onclick="showVideoSeriesManagerModal()">Series Manager</button>
            <button class="btn btn-s" onclick="videoCatalogPublishReviewReady()" ${videoCatalogIsBusy() ? 'disabled' : ''}>Publish Review Ready</button>
            <button class="btn btn-s" onclick="videoCatalogClearNow()" ${videoCatalogIsBusy() ? 'disabled' : ''}>Clean Structure</button>
          </div>
        </div>
        ${_videoCatalogModalState.loading || _videoCatalogModalState.scanNotice
          ? `<div class="video-catalog-status-strip">
              ${_videoCatalogModalState.loading ? '<span class="video-catalog-pill status-note">Preparing recursive scan...</span>' : ''}
              ${_videoCatalogModalState.scanNotice ? `<span class="video-catalog-pill status-note">${escHtml(_videoCatalogModalState.scanNotice)}</span>` : ''}
            </div>`
          : ''}
      </div>
      <div class="video-catalog-content">
        <div class="video-catalog-filters">
          ${videoCatalogStatusOptions().map((option) => `<button class="btn ${selectedStatus === option.value ? 'btn-p' : 'btn-s'} btn-sm" onclick="videoCatalogSetStatus('${option.value}')">${option.label}${counts[option.value] ? ` <span class="video-catalog-filter-count">${counts[option.value]}</span>` : ''}</button>`).join('')}
        </div>
        <div class="video-catalog-scroll">
          ${itemCards}
        </div>
      </div>
    </div>`);
}

function renderVideoCatalogModal() {
  window.__modalClassName = 'modal-wide video-catalog-shell-modal';
  const items = Array.isArray(_videoCatalogModalState.items) ? _videoCatalogModalState.items : [];
  const counts = items.reduce((acc, item) => {
    const key = String(item.status || 'scanned');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const selectedStatus = String(_videoCatalogModalState.status || 'all');
  const visibleItems = items.filter((item) => selectedStatus === 'all' || String(item.status || '') === selectedStatus);
  const totalCount = items.length;
  const reviewCount = Number(counts.review || 0);
  const publishedCount = Number(counts.published || 0);
  const scannedCount = Number(counts.scanned || 0);
  const statusLabel = (value) => {
    const raw = String(value || 'scanned').trim().toLowerCase();
    return raw ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}` : 'Scanned';
  };
  const itemCards = visibleItems.length
    ? visibleItems.map((item) => {
        const itemId = Number(item.id || 0);
        const posterSrc = String(item.poster_stream_url || '').trim();
        const genres = catalogCsv(item.genres);
        const castMembers = catalogCsv(item.cast_members);
        const creators = catalogCsv(item.creators);
        const tags = catalogCsv(item.tags);
        const files = Array.isArray(item.files) ? item.files : [];
        const fileRows = files.map((file) => {
          const fileId = Number(file.id || 0);
          const secondaryLabel = [
            file.file_exists === false ? 'Not available' : '',
            file.size_bytes ? videoLibraryFormatBytes(file.size_bytes) : '',
          ].filter(Boolean).join(' • ');
          return `
            <div class="video-catalog-file-editor" data-video-catalog-file data-item-id="${itemId}" data-file-id="${fileId}">
              <div class="video-catalog-file-top">
                <div>
                  <div class="video-catalog-file-name">${escHtml(String(file.filename || 'File'))}</div>
                  <div class="video-catalog-file-meta">${escHtml(secondaryLabel || '')}</div>
                </div>
                <div class="video-catalog-file-path">${escHtml(String(file.relative_path || '').trim() || '-')}</div>
              </div>
              <div class="video-catalog-edit-grid video-catalog-edit-grid-files">
                <label class="video-catalog-field">
                  <span>Series Title</span>
                  <input class="fi" id="videoCatalogFileSeries_${itemId}_${fileId}" value="${escHtml(String(file.series_title || item.display_title || '').trim())}" placeholder="Lost">
                </label>
                <label class="video-catalog-field">
                  <span>Season Label</span>
                  <input class="fi" id="videoCatalogFileSeasonLabel_${itemId}_${fileId}" value="${escHtml(String(file.season_label || '').trim())}" placeholder="Season 1">
                </label>
                <label class="video-catalog-field">
                  <span>Season No.</span>
                  <input class="fi" id="videoCatalogFileSeasonNumber_${itemId}_${fileId}" value="${escHtml(file.season_number != null ? String(file.season_number) : '')}" placeholder="1">
                </label>
                <label class="video-catalog-field">
                  <span>Episode Title</span>
                  <input class="fi" id="videoCatalogFileEpisodeLabel_${itemId}_${fileId}" value="${escHtml(String(file.episode_label || '').trim())}" placeholder="Pilot - Part 1">
                </label>
                <label class="video-catalog-field">
                  <span>Episode No.</span>
                  <input class="fi" id="videoCatalogFileEpisodeNumber_${itemId}_${fileId}" value="${escHtml(file.episode_number != null ? String(file.episode_number) : '')}" placeholder="1">
                </label>
              </div>
            </div>`;
        }).join('');
        const statusClass = (() => {
          const normalized = String(item.status || '').trim().toLowerCase();
          if (normalized === 'review') return 'tag-review';
          if (normalized === 'published') return 'tag-published';
          return 'tag-scanned';
        })();
        const statusIcon = statusClass === 'tag-review'
          ? '<span class="icon-svg" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg></span>'
          : '<span class="icon-svg" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5 6.5 11.5 12.5 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
        const publishIcon = '<span class="icon-svg" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M8 2.5v7m0-7L5.5 5m2.5-2.5L10.5 5M3 10.5v1A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
        const saveIcon = '<span class="icon-svg" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 2.5h7l2 2v8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 2.5v3h5v-3M5.5 13v-4h5v4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>';
        const summaryPills = [
          item.release_year ? `<span class="tag tag-year">${escHtml(String(item.release_year))}</span>` : '',
          `<span class="tag tag-files">Files ${Number(item.file_count || 0)}</span>`,
          `<span class="tag ${statusClass}">${statusIcon}${escHtml(statusLabel(item.status))}</span>`,
          item.file_exists === false ? `<span class="tag tag-warn">Not available</span>` : '',
        ].filter(Boolean).join('');
        return `
          <div class="vcard">
            <div class="vcard-thumb">
              ${posterSrc
                ? `<div class="video-catalog-poster" style="background-image:url('${escHtml(posterSrc)}')"></div>`
                : `<div class="video-catalog-poster video-catalog-poster-fallback">&#127909;</div>`
              }
              ${item.release_year ? `<div class="vcard-thumb-year">${escHtml(String(item.release_year))}</div>` : ''}
            </div>
            <div class="vcard-body">
              <div class="vcard-title">${escHtml(item.display_title || item.folder_name || 'Untitled')}</div>
              <div class="vcard-meta">
                <span>${escHtml(item.media_type || 'movie')}</span>
                ${item.folder_name ? `<div class="dot"></div><span>${escHtml(item.folder_name)}</span>` : ''}
              </div>
              <div class="tag-row">${summaryPills}</div>
              <div class="video-catalog-edit-grid">
                <label class="video-catalog-field">
                  <span>Title</span>
                  <input class="fi" id="videoCatalogTitle_${itemId}" value="${escHtml(item.display_title || '')}" placeholder="Series or movie title">
                </label>
                <label class="video-catalog-field">
                  <span>Type</span>
                  <select class="fi" id="videoCatalogType_${itemId}">
                    <option value="movie" ${String(item.media_type || 'movie') === 'movie' ? 'selected' : ''}>Movie</option>
                    <option value="series" ${String(item.media_type || '') === 'series' ? 'selected' : ''}>Series</option>
                  </select>
                </label>
                <label class="video-catalog-field">
                  <span>Year</span>
                  <input class="fi" id="videoCatalogYear_${itemId}" value="${escHtml(item.release_year != null ? String(item.release_year) : '')}" placeholder="2004">
                </label>
                <label class="video-catalog-field">
                  <span>Seasons</span>
                  <input class="fi" id="videoCatalogSeasons_${itemId}" value="${escHtml(item.season_count != null ? String(item.season_count) : '')}" placeholder="1">
                </label>
                <label class="video-catalog-field">
                  <span>Episodes</span>
                  <input class="fi" id="videoCatalogEpisodes_${itemId}" value="${escHtml(item.episode_count != null ? String(item.episode_count) : '')}" placeholder="25">
                </label>
                <label class="video-catalog-field">
                  <span>Runtime</span>
                  <input class="fi" id="videoCatalogRuntime_${itemId}" value="${escHtml(item.runtime_minutes != null ? String(item.runtime_minutes) : '')}" placeholder="42">
                </label>
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Genres</span>
                  <input class="fi" id="videoCatalogGenres_${itemId}" value="${escHtml(genres)}" placeholder="Drama, Mystery">
                </label>
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Cast</span>
                  <input class="fi" id="videoCatalogCast_${itemId}" value="${escHtml(castMembers)}" placeholder="Cast members">
                </label>
                <label class="video-catalog-field">
                  <span>Language</span>
                  <input class="fi" id="videoCatalogLanguage_${itemId}" value="${escHtml(item.original_language || '')}" placeholder="English">
                </label>
                <label class="video-catalog-field">
                  <span>Country</span>
                  <input class="fi" id="videoCatalogCountry_${itemId}" value="${escHtml(item.country || '')}" placeholder="USA">
                </label>
                <label class="video-catalog-field">
                  <span>Rating</span>
                  <input class="fi" id="videoCatalogRating_${itemId}" value="${escHtml(item.content_rating || '')}" placeholder="TV-14">
                </label>
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Creators</span>
                  <input class="fi" id="videoCatalogCreators_${itemId}" value="${escHtml(creators)}" placeholder="Creators">
                </label>
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Tags</span>
                  <input class="fi" id="videoCatalogTags_${itemId}" value="${escHtml(tags)}" placeholder="mystery, island">
                </label>
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Poster URL</span>
                  <input class="fi" id="videoCatalogPosterUrl_${itemId}" value="${escHtml(item.poster_url || '')}" placeholder="https://...">
                </label>
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Poster Path</span>
                  <input class="fi" id="videoCatalogPosterPath_${itemId}" value="${escHtml(item.poster_relative_path || '')}" placeholder="relative/poster.jpg">
                </label>
                <label class="video-catalog-field video-catalog-field-wide video-catalog-textarea-field">
                  <span>Synopsis</span>
                  <textarea class="fi" id="videoCatalogSynopsis_${itemId}" placeholder="Short synopsis">${escHtml(item.synopsis || '')}</textarea>
                </label>
                <label class="video-catalog-field video-catalog-field-wide video-catalog-textarea-field">
                  <span>Notes</span>
                  <textarea class="fi" id="videoCatalogNotes_${itemId}" placeholder="Internal notes">${escHtml(item.ai_notes || '')}</textarea>
                </label>
              </div>
              <div class="video-catalog-files">
                <div class="video-catalog-files-head">
                  <div class="video-catalog-files-title">Series / Season / Episode Mapping</div>
                  ${files.length ? `<button type="button" class="btn btn-s btn-sm" onclick="videoCatalogApplyTitleToFiles(${itemId})">Use Title For Files</button>` : ''}
                </div>
                <div class="video-catalog-file-list">
                  ${fileRows || '<div class="video-catalog-file-empty">No files found for this entry.</div>'}
                </div>
              </div>
            </div>
            <div class="vcard-actions">
              <button class="vbtn pub" onclick="videoCatalogPublishItem(${itemId})">${publishIcon}<span>Publish</span></button>
              <button class="vbtn save" onclick="videoCatalogSaveItem(${itemId})">${saveIcon}<span>Save</span></button>
            </div>
          </div>`;
      }).join('')
    : '<div class="video-catalog-empty">No catalog entries yet. Scan a folder first.</div>';

  openModal('Video Catalog Sync', `
    <div class="video-catalog-modal">
      <div class="video-catalog-toolbar">
        <div class="video-catalog-hero-shell">
          <div class="video-catalog-hero">
            <div class="video-catalog-hero-mark">
              <div class="video-catalog-hero-icon">VC</div>
              <div class="video-catalog-hero-copy">
                <div class="video-catalog-hero-title">Video Catalog Sync</div>
                <div class="video-catalog-hero-sub">Catalog Workspace - Scan, enrich & publish</div>
              </div>
            </div>
            <button type="button" class="video-catalog-hero-closehint" onclick="closeModal()">&times;</button>
          </div>
          <div class="video-catalog-hero-stats">
            <div class="video-catalog-stat">
              <span class="video-catalog-stat-label">Total</span>
              <strong>${totalCount}</strong>
            </div>
            <div class="video-catalog-stat">
              <span class="video-catalog-stat-label">Scanned</span>
              <strong>${scannedCount}</strong>
            </div>
            <div class="video-catalog-stat">
              <span class="video-catalog-stat-label">Review</span>
              <strong>${reviewCount}</strong>
            </div>
            <div class="video-catalog-stat">
              <span class="video-catalog-stat-label">Published</span>
              <strong>${publishedCount}</strong>
            </div>
          </div>
          <div class="video-catalog-hero-foot">
            <span class="video-catalog-hero-progress"></span>
            <span class="video-catalog-hero-foot-text">${scannedCount}/${totalCount || scannedCount || 0} scanned</span>
          </div>
        </div>
        <div class="video-catalog-intro">
          Scan folders and publish only the entries you approve.
        </div>
        <div class="video-catalog-path-row">
          <div class="video-catalog-path-card">
            <input class="fi" id="videoCatalogScanPath" value="${escHtml(_videoCatalogModalState.path || '')}" placeholder="Scan path - e.g. /media/movies or leave blank for all">
          </div>
          <button class="btn btn-p video-catalog-browse-btn" onclick="document.getElementById('videoCatalogScanPath')?.focus()">Browse</button>
        </div>
        <div class="video-catalog-toolbar-main">
          <div class="video-catalog-toolbar-actions">
            ${videoCatalogIsBusy()
              ? `<button class="btn btn-g" onclick="videoCatalogStopNow()">Stop</button>`
              : `<button class="btn btn-p" onclick="videoCatalogScanNow()">Scan Folder</button>`}
            <button class="btn btn-s" onclick="videoCatalogPublishReviewReady()" ${videoCatalogIsBusy() ? 'disabled' : ''}>Publish Review Ready</button>
            <button class="btn btn-s" onclick="videoCatalogClearNow()" ${videoCatalogIsBusy() ? 'disabled' : ''}>Clean Structure</button>
          </div>
        </div>
        ${_videoCatalogModalState.loading || _videoCatalogModalState.scanNotice
          ? `<div class="video-catalog-status-strip">
              ${_videoCatalogModalState.loading ? '<span class="video-catalog-pill status-note">Preparing recursive scan...</span>' : ''}
              ${_videoCatalogModalState.scanNotice ? `<span class="video-catalog-pill status-note">${escHtml(_videoCatalogModalState.scanNotice)}</span>` : ''}
            </div>`
          : ''}
      </div>
      <div class="video-catalog-content">
        <div class="video-catalog-filters">
          ${videoCatalogStatusOptions().map((option) => `<button class="btn ${selectedStatus === option.value ? 'btn-p' : 'btn-s'} btn-sm" onclick="videoCatalogSetStatus('${option.value}')">${option.label}${counts[option.value] ? ` <span class="video-catalog-filter-count">${counts[option.value]}</span>` : ''}</button>`).join('')}
        </div>
        <div class="video-catalog-scroll">
          ${itemCards}
        </div>
      </div>
    </div>`);
}

async function videoCatalogSaveItem(itemId) {
  const id = Number(itemId || 0);
  if (!id) {
    toast('Invalid catalog item.', 'error');
    return;
  }
  const body = {
    display_title: document.getElementById(`videoCatalogTitle_${id}`)?.value?.trim() || '',
    media_type: document.getElementById(`videoCatalogType_${id}`)?.value?.trim() || 'movie',
    release_year: document.getElementById(`videoCatalogYear_${id}`)?.value?.trim() || '',
    poster_url: document.getElementById(`videoCatalogPosterUrl_${id}`)?.value?.trim() || '',
    poster_relative_path: document.getElementById(`videoCatalogPosterPath_${id}`)?.value?.trim() || '',
    genres: document.getElementById(`videoCatalogGenres_${id}`)?.value?.trim() || '',
    cast_members: document.getElementById(`videoCatalogCast_${id}`)?.value?.trim() || '',
    creators: document.getElementById(`videoCatalogCreators_${id}`)?.value?.trim() || '',
    tags: document.getElementById(`videoCatalogTags_${id}`)?.value?.trim() || '',
    original_language: document.getElementById(`videoCatalogLanguage_${id}`)?.value?.trim() || '',
    country: document.getElementById(`videoCatalogCountry_${id}`)?.value?.trim() || '',
    content_rating: document.getElementById(`videoCatalogRating_${id}`)?.value?.trim() || '',
    runtime_minutes: document.getElementById(`videoCatalogRuntime_${id}`)?.value?.trim() || '',
    season_count: document.getElementById(`videoCatalogSeasons_${id}`)?.value?.trim() || '',
    episode_count: document.getElementById(`videoCatalogEpisodes_${id}`)?.value?.trim() || '',
    synopsis: document.getElementById(`videoCatalogSynopsis_${id}`)?.value?.trim() || '',
    ai_notes: document.getElementById(`videoCatalogNotes_${id}`)?.value?.trim() || '',
    files: videoCatalogBuildFilesPayload(id),
  };
  const result = await api(`/api/admin/videos/catalog/${id}`, {
    method: 'PUT',
    body,
  });
  if (!result?.success) {
    toast(result?.error || 'Could not save catalog details.', 'error');
    return;
  }
  _videoCatalogModalState.items = Array.isArray(result.items) ? result.items : _videoCatalogModalState.items;
  toast('Catalog item saved for review', 'success');
  renderVideoCatalogModal();
}

function renderVideoPosterThumb(video, size = 56) {
  const src = video?.poster_stream_url || '';
  if (!src) {
    return `<div style="width:${size}px;height:${size}px;border-radius:14px;background:#edf4ef;display:flex;align-items:center;justify-content:center;font-size:${Math.max(16, Math.round(size * 0.34))}px;color:#7f9a89;flex:0 0 ${size}px">&#127909;</div>`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:14px;background:#edf4ef url('${escHtml(src)}') center/cover no-repeat;flex:0 0 ${size}px;overflow:hidden"></div>`;
}

function renderVideoPlaylistItems(videos = [], selectedVideo = null) {
  const movieItems = [];
  const seriesGroups = new Map();
  videos.forEach((video) => {
    if (String(video.media_type || 'movie') === 'series') {
      const key = String(video.catalog_title || video.series_title || video.folder || 'Series');
      if (!seriesGroups.has(key)) seriesGroups.set(key, []);
      seriesGroups.get(key).push(video);
      return;
    }
    movieItems.push(video);
  });

  const renderVideoButton = (video, compact = false) => `
    <button class="videos-playlist-item ${String(selectedVideo?.id || '') === String(video.id) ? 'active' : ''}" data-video-id="${escHtml(String(video.id || ''))}" onclick="selectVideoLibraryItem('${String(video.id).replace(/'/g, "\\'")}')">
      <div style="display:flex;gap:10px;align-items:flex-start">
        ${renderVideoPosterThumb(video, compact ? 48 : 52)}
        <div style="min-width:0;flex:1">
          <div class="videos-playlist-top">
            <div class="videos-playlist-name">${escHtml(video.title || 'Video')}</div>
            <div class="videos-playlist-size">${escHtml(videoLibraryFormatBytes(video.size_bytes))}</div>
          </div>
          <div class="videos-playlist-meta">
            <span>${escHtml(
              String(video.media_type || 'movie') === 'series'
                ? [video.season_label, video.episode_label].filter(Boolean).join(' · ') || (video.catalog_title || video.folder || 'Series')
                : (video.release_year ? `${video.release_year}` : (video.catalog_title || video.folder || 'Root folder'))
            )}</span>
            <span>${escHtml(video.available === false ? 'Not available' : (videoProgressLabel(video.progress) || (fmtDate ? fmtDate(video.updated_at) : (video.updated_at || '-'))))}</span>
          </div>
          ${videoProgressPercent(video.progress) > 0 ? `<div class="videos-progress"><span class="videos-progress-bar ${video.progress?.is_completed ? 'completed' : ''}" style="width:${videoProgressPercent(video.progress)}%"></span></div>` : ''}
        </div>
      </div>
    </button>`;

  const movieSection = movieItems.length
    ? `
      <div class="videos-panel-title videos-panel-title-spaced">Movies</div>
      ${movieItems.map((video) => renderVideoButton(video)).join('')}`
    : '';

  const seriesSection = [...seriesGroups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([seriesTitle, entries]) => {
    const seasons = new Map();
    entries
      .sort((a, b) => {
        const seasonDiff = Number(a.season_number || 0) - Number(b.season_number || 0);
        if (seasonDiff) return seasonDiff;
        const epDiff = Number(a.episode_number || 0) - Number(b.episode_number || 0);
        if (epDiff) return epDiff;
        return String(a.title || '').localeCompare(String(b.title || ''));
      })
      .forEach((video) => {
        const key = String(video.season_label || 'Season 1');
        if (!seasons.has(key)) seasons.set(key, []);
        seasons.get(key).push(video);
      });
    const posterSrc = entries[0]?.poster_stream_url || '';
    return `
      <div style="padding:12px 0 6px">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
          ${posterSrc ? `<div style="width:40px;height:52px;border-radius:12px;background:#edf4ef url('${escHtml(posterSrc)}') center/cover no-repeat;flex:0 0 40px"></div>` : ''}
          <div>
            <div style="font-weight:800;color:var(--t1)">${escHtml(seriesTitle)}</div>
            <div style="font-size:12px;color:var(--t3)">${entries[0]?.season_count ? `${entries[0].season_count} season${entries[0].season_count === 1 ? '' : 's'}` : 'Series'} · ${entries.length} episode${entries.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        ${[...seasons.entries()].map(([seasonLabel, seasonVideos]) => `
          <div style="margin:8px 0 10px">
            <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">${escHtml(seasonLabel)}</div>
            ${seasonVideos.map((video) => renderVideoButton(video, true)).join('')}
          </div>`).join('')}
      </div>`;
  }).join('');

  return `${movieSection}${seriesSection ? `${movieSection ? '<div class="videos-panel-title videos-panel-title-spaced">Series</div>' : ''}${seriesSection}` : ''}` || '<div style="color:var(--t3);font-size:13px">No matching titles.</div>';
}

function catalogCsv(value) {
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

function videoCatalogBuildFilesPayload(itemId) {
  const id = Number(itemId || 0);
  if (!id) return [];
  const item = (Array.isArray(_videoCatalogModalState.items) ? _videoCatalogModalState.items : [])
    .find((entry) => Number(entry?.id || 0) === id);
  const files = Array.isArray(item?.files) ? item.files : [];
  return files.map((file) => {
    const fileId = Number(file.id || 0);
    return {
      id: fileId,
      series_title: document.getElementById(`videoCatalogFileSeries_${id}_${fileId}`)?.value?.trim() || '',
      season_label: document.getElementById(`videoCatalogFileSeasonLabel_${id}_${fileId}`)?.value?.trim() || '',
      season_number: document.getElementById(`videoCatalogFileSeasonNumber_${id}_${fileId}`)?.value?.trim() || '',
      episode_label: document.getElementById(`videoCatalogFileEpisodeLabel_${id}_${fileId}`)?.value?.trim() || '',
      episode_number: document.getElementById(`videoCatalogFileEpisodeNumber_${id}_${fileId}`)?.value?.trim() || '',
    };
  });
}




function videoCatalogApplyTitleToFiles(itemId) {
  const id = Number(itemId || 0);
  if (!id) return;
  const title = document.getElementById(`videoCatalogTitle_${id}`)?.value?.trim() || '';
  if (!title) {
    toast('Enter the title first.', 'error');
    return;
  }
  const item = (Array.isArray(_videoCatalogModalState.items) ? _videoCatalogModalState.items : [])
    .find((entry) => Number(entry?.id || 0) === id);
  const files = Array.isArray(item?.files) ? item.files : [];
  files.forEach((file) => {
    const input = document.getElementById(`videoCatalogFileSeries_${id}_${Number(file.id || 0)}`);
    if (input) input.value = title;
  });
  toast('Applied title to file metadata.', 'success');
}

function videoCatalogRelativeParts(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
}

function videoCatalogFolderParts(value) {
  const parts = videoCatalogRelativeParts(value);
  return parts.length > 1 ? parts.slice(0, -1) : [];
}

function videoCatalogFileLabelFromPath(value, fallback = '') {
  const parts = videoCatalogRelativeParts(value);
  return parts.length ? parts[parts.length - 1] : String(fallback || '');
}


function videoCatalogSeasonNumberFromText(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const seasonMatch = text.match(/\bseason\s*0*(\d{1,2})\b/i) || text.match(/\bs\s*0*(\d{1,2})\b/i);
  if (seasonMatch) return Number(seasonMatch[1]);
  return null;
}

function videoCatalogEpisodeNumberFromText(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const sxMatch = text.match(/\bs\d{1,2}\s*e\s*0*(\d{1,3})\b/i);
  if (sxMatch) return Number(sxMatch[1]);
  const eMatch = text.match(/\bepisode\s*0*(\d{1,3})\b/i) || text.match(/\be\s*0*(\d{1,3})\b/i);
  if (eMatch) return Number(eMatch[1]);
  const altMatch = text.match(/\b\d{1,2}x0*(\d{1,3})\b/i);
  if (altMatch) return Number(altMatch[1]);
  return null;
}

function videoCatalogSeriesManagerFolderToken(depth) {
  return `folder:${Number(depth || 0)}`;
}

function videoCatalogSeriesManagerFolderValue(parts, token) {
  const match = String(token || '').match(/^folder:(\d+)$/);
  const depth = match ? Number(match[1]) : 0;
  if (!depth) return '';
  return String(Array.isArray(parts) ? parts[depth - 1] || '' : '').trim();
}

function videoCatalogSeriesManagerEpisodeText(value, fallback = '') {
  const cleaned = videoLibraryCleanEpisodeText(value || fallback || '');
  return cleaned || String(fallback || '').trim();
}

function videoCatalogSeriesManagerSeriesTitleForRow(row, groupIndex = null) {
  const manualTitle = groupIndex == null
    ? String(row?.seriesTitle || '').trim()
    : (document.getElementById(`videoSeriesManagerTitle_${Number(groupIndex || 0)}`)?.value?.trim() || '');
  const source = groupIndex == null
    ? String(row?.seriesSource || 'manual')
    : (document.getElementById(`videoSeriesManagerSeriesSource_${Number(groupIndex || 0)}`)?.value?.trim() || 'manual');
  if (source === 'manual') return manualTitle;
  const folderValue = videoCatalogSeriesManagerFolderValue(row?.folderParts, source);
  return videoLibraryNormalizedSeriesName(folderValue) || manualTitle || row?.seriesTitle || 'Series';
}

function videoCatalogSeriesManagerSeasonMetaForRow(row, groupIndex = null) {
  const source = groupIndex == null
    ? String(row?.seasonSource || 'none')
    : (document.getElementById(`videoSeriesManagerSeasonSource_${Number(groupIndex || 0)}`)?.value?.trim() || 'none');
  const rawFolder = source === 'none' ? '' : videoCatalogSeriesManagerFolderValue(row?.folderParts, source);
  const seasonNumber = videoCatalogSeasonNumberFromText(rawFolder)
    || Number(row?.seasonNumber || 0)
    || videoCatalogSeasonNumberFromText(row?.fileName)
    || 1;
  return {
    season_number: seasonNumber,
    season_label: `Season ${seasonNumber}`,
  };
}

function videoCatalogSeriesManagerEpisodeMetaForRow(row, groupIndex = null) {
  const source = groupIndex == null
    ? String(row?.episodeSource || 'filename')
    : (document.getElementById(`videoSeriesManagerEpisodeSource_${Number(groupIndex || 0)}`)?.value?.trim() || 'filename');
  let rawLabel = '';
  if (source === 'existing') rawLabel = String(row?.episodeLabel || '').trim();
  else if (source === 'filename') rawLabel = String(row?.fileName || '').trim();
  else rawLabel = videoCatalogSeriesManagerFolderValue(row?.folderParts, source);
  const episodeNumber = videoCatalogEpisodeNumberFromText(rawLabel)
    || Number(row?.episodeNumber || 0)
    || videoCatalogEpisodeNumberFromText(row?.fileName)
    || null;
  const cleaned = videoCatalogSeriesManagerEpisodeText(rawLabel, row?.fileName || 'Episode');
  return {
    episode_number: episodeNumber,
    episode_label: episodeNumber ? `Episode ${episodeNumber}${cleaned && !new RegExp(`^episode\\s*${episodeNumber}$`, 'i').test(cleaned) ? ` - ${cleaned}` : ''}` : cleaned,
  };
}

function videoCatalogSeriesManagerPreviewData(group, groupIndex = null) {
  const rows = Array.isArray(group?.rows) ? group.rows : [];
  const mappedRows = rows.map((row) => {
    const seasonMeta = videoCatalogSeriesManagerSeasonMetaForRow(row, groupIndex);
    const episodeMeta = videoCatalogSeriesManagerEpisodeMetaForRow(row, groupIndex);
    return {
      ...row,
      resolvedSeriesTitle: videoCatalogSeriesManagerSeriesTitleForRow(row, groupIndex) || group?.title || 'Series',
      resolvedSeasonNumber: seasonMeta.season_number,
      resolvedSeasonLabel: seasonMeta.season_label,
      resolvedEpisodeNumber: episodeMeta.episode_number,
      resolvedEpisodeLabel: episodeMeta.episode_label,
    };
  });
  const seriesTitle = mappedRows[0]?.resolvedSeriesTitle || group?.title || 'Series';
  const seasons = new Map();
  mappedRows.forEach((row) => {
    const key = `${Number(row.resolvedSeasonNumber || 1)}:${String(row.resolvedSeasonLabel || '').toLowerCase()}`;
    if (!seasons.has(key)) {
      seasons.set(key, {
        season_number: Number(row.resolvedSeasonNumber || 1),
        season_label: row.resolvedSeasonLabel || `Season ${Number(row.resolvedSeasonNumber || 1)}`,
        entries: [],
      });
    }
    seasons.get(key).entries.push(row);
  });
  const seasonList = [...seasons.values()].sort((a, b) => Number(a.season_number || 0) - Number(b.season_number || 0));
  seasonList.forEach((season) => {
    season.entries.sort((a, b) => {
      const episodeDiff = Number(a.resolvedEpisodeNumber || 0) - Number(b.resolvedEpisodeNumber || 0);
      if (episodeDiff) return episodeDiff;
      return String(a.fileName || '').localeCompare(String(b.fileName || ''));
    });
  });
  return {
    seriesTitle,
    seasons: seasonList,
    totalEpisodes: mappedRows.length,
  };
}

function renderVideoSeriesManagerPreview(groupIndex) {
  const groups = Array.isArray(window.__videoSeriesManagerGroups) ? window.__videoSeriesManagerGroups : [];
  const group = groups[Number(groupIndex || 0)];
  const node = document.getElementById(`videoSeriesManagerPreview_${Number(groupIndex || 0)}`);
  if (!group || !node) return;
  const preview = videoCatalogSeriesManagerPreviewData(group, groupIndex);
  node.innerHTML = `
    <div class="video-series-manager-preview-head">
      <div class="video-series-manager-preview-title">${escHtml(preview.seriesTitle || 'Series')}</div>
      <div class="video-series-manager-preview-meta">${preview.seasons.length} season${preview.seasons.length === 1 ? '' : 's'} • ${preview.totalEpisodes} episode${preview.totalEpisodes === 1 ? '' : 's'}</div>
    </div>
    <div class="video-series-manager-preview-seasons">
      ${preview.seasons.map((season) => `
        <div class="video-series-manager-preview-season">
          <div class="video-series-manager-preview-season-label">${escHtml(season.season_label || `Season ${Number(season.season_number || 1)}`)}</div>
          <div class="video-series-manager-preview-episodes">
            ${season.entries.map((entry) => `
              <div class="video-series-manager-preview-episode">
                <span class="video-series-manager-preview-badge">${escHtml(Number(entry.resolvedEpisodeNumber || 0) > 0 ? `E${String(entry.resolvedEpisodeNumber).padStart(2, '0')}` : 'EP')}</span>
                <span>${escHtml(entry.resolvedEpisodeLabel || entry.fileName || 'Episode')}</span>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function videoCatalogSeriesManagerScanPath(groupIndex) {
  return document.getElementById(`videoSeriesManagerScanPath_${Number(groupIndex || 0)}`)?.value?.trim() || '';
}

function videoCatalogSeriesManagerGroups() {
  const items = Array.isArray(_videoCatalogModalState.items) ? _videoCatalogModalState.items : [];
  const groups = new Map();
  items.forEach((item) => {
    const files = Array.isArray(item.files) ? item.files : [];
    const relevantFiles = files.length ? files : [{
      id: `item_${item.id}`,
      filename: item.display_title || item.folder_name || 'Untitled',
      relative_path: item.folder_relative_path || item.folder_name || item.display_title || 'Untitled',
      season_label: '',
      season_number: null,
      episode_label: '',
      episode_number: null,
      series_title: item.display_title || '',
    }];
    relevantFiles.forEach((file) => {
      const seed = file.series_title || item.display_title || item.folder_name || file.filename || '';
      const key = videoLibraryNormalizedSeriesName(seed) || `series_${item.id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: videoLibrarySeriesDisplayTitle({ catalog_title: item.display_title, series_title: file.series_title, title: file.filename, folder: item.folder_name }),
          items: [],
          rows: [],
        });
      }
      const group = groups.get(key);
      if (!group.items.some((entry) => Number(entry.id || 0) === Number(item.id || 0))) {
        group.items.push(item);
      }
      const relativePath = String(file.relative_path || item.folder_relative_path || file.filename || '').trim();
      group.rows.push({
        itemId: Number(item.id || 0),
        fileId: Number(file.id || 0),
        fileName: videoCatalogFileLabelFromPath(relativePath, String(file.filename || item.display_title || 'File')),
        relativePath,
        folderParts: videoCatalogFolderParts(relativePath),
        seasonLabel: String(file.season_label || '').trim(),
        seasonNumber: file.season_number,
        episodeLabel: String(file.episode_label || '').trim(),
        episodeNumber: file.episode_number,
        seriesTitle: String(file.series_title || item.display_title || '').trim(),
      });
    });
  });
  return [...groups.values()].map((group) => {
    const maxDepth = Math.max(0, ...group.rows.map((row) => Array.isArray(row.folderParts) ? row.folderParts.length : 0));
    group.folderOptions = Array.from({ length: maxDepth }, (_value, index) => {
      const depth = index + 1;
      const samples = [...new Set(group.rows.map((row) => String(row.folderParts?.[index] || '').trim()).filter(Boolean))];
      return {
        value: videoCatalogSeriesManagerFolderToken(depth),
        label: `Folder ${depth}${samples.length ? ` - ${samples.slice(0, 2).join(', ')}${samples.length > 2 ? '...' : ''}` : ''}`,
      };
    });
    group.defaultSeasonSource = group.folderOptions.length ? group.folderOptions[group.folderOptions.length - 1].value : 'none';
    group.pathPreview = [...new Set(group.rows.map((row) => row.folderParts.join(' / ')).filter(Boolean))].slice(0, 3);
    group.scanPath = String(_videoCatalogModalState.path || _videoLibraryData?.settings?.videos_root_path || '').trim();
    return group;
  }).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

function showVideoSeriesManagerModal() {
  if (_userRole !== 'admin') {
    toast('Only admins can manage series.', 'error');
    return;
  }
  const openSeriesManager = () => {
    const groups = videoCatalogSeriesManagerGroups().filter((group) => group.rows.length);
    openModal('Series Manager', `
      <div class="video-series-manager">
        <div class="video-series-manager-top">
          <div>
            <div class="video-series-manager-title">Series Manager</div>
            <div class="video-series-manager-intro">Group files into proper <strong>Series -> Seasons -> Episodes</strong>. Save one series group and the browser library will use the same structure.</div>
          </div>
          <button type="button" class="video-series-manager-close" onclick="closeModal()" aria-label="Close">&times;</button>
        </div>
        <div class="video-series-manager-list">
          ${groups.length ? groups.map((group, groupIndex) => `
            <div class="video-series-manager-card">
              <div class="video-series-manager-head">
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Series Name</span>
                  <input class="fi" id="videoSeriesManagerTitle_${groupIndex}" value="${escHtml(group.title || '')}" placeholder="Lost">
                </label>
                <button type="button" class="btn btn-p" onclick="saveVideoSeriesManagerGroup(${groupIndex})">Save Series</button>
              </div>
              <div class="video-series-manager-meta">${group.rows.length} episode file${group.rows.length === 1 ? '' : 's'} • ${group.items.length} catalog entr${group.items.length === 1 ? 'y' : 'ies'}</div>
              <div class="video-series-manager-grid">
                ${group.rows.map((row, rowIndex) => `
                  <div class="video-series-manager-row">
                    <div class="video-series-manager-file">${escHtml(row.fileName)}</div>
                    <input class="fi" id="videoSeriesManagerSeasonLabel_${groupIndex}_${rowIndex}" value="${escHtml(row.seasonLabel || '')}" placeholder="Season 1">
                    <input class="fi" id="videoSeriesManagerSeasonNumber_${groupIndex}_${rowIndex}" value="${escHtml(row.seasonNumber != null ? String(row.seasonNumber) : '')}" placeholder="1">
                    <input class="fi" id="videoSeriesManagerEpisodeLabel_${groupIndex}_${rowIndex}" value="${escHtml(row.episodeLabel || '')}" placeholder="Episode title">
                    <input class="fi" id="videoSeriesManagerEpisodeNumber_${groupIndex}_${rowIndex}" value="${escHtml(row.episodeNumber != null ? String(row.episodeNumber) : '')}" placeholder="1">
                  </div>`).join('')}
              </div>
            </div>`).join('') : '<div class="video-catalog-empty">No detected series files yet. Run Catalog Sync first.</div>'}
        </div>
      </div>`);
    window.__videoSeriesManagerGroups = groups;
  };
  if (!Array.isArray(_videoCatalogModalState.items) || !_videoCatalogModalState.items.length) {
    _videoCatalogModalState.path = _videoCatalogModalState.path || _videoLibraryData?.settings?.videos_root_path || '';
    loadVideoCatalogItems().then(openSeriesManager).catch((error) => {
      console.error('showVideoSeriesManagerModal failed', error);
      toast(error?.message || 'Could not load series manager.', 'error');
    });
    return;
  }
  openSeriesManager();
}

async function saveVideoSeriesManagerGroup(groupIndex) {
  const groups = Array.isArray(window.__videoSeriesManagerGroups) ? window.__videoSeriesManagerGroups : [];
  const group = groups[Number(groupIndex || 0)];
  if (!group) {
    toast('Series group not found.', 'error');
    return;
  }
  const seriesTitle = document.getElementById(`videoSeriesManagerTitle_${Number(groupIndex || 0)}`)?.value?.trim() || '';
  if (!seriesTitle) {
    toast('Enter series name.', 'error');
    return;
  }
  const itemsById = new Map();
  group.rows.forEach((row, rowIndex) => {
    if (!itemsById.has(row.itemId)) itemsById.set(row.itemId, []);
    itemsById.get(row.itemId).push({
      id: row.fileId,
      series_title: seriesTitle,
      season_label: document.getElementById(`videoSeriesManagerSeasonLabel_${Number(groupIndex || 0)}_${rowIndex}`)?.value?.trim() || '',
      season_number: document.getElementById(`videoSeriesManagerSeasonNumber_${Number(groupIndex || 0)}_${rowIndex}`)?.value?.trim() || '',
      episode_label: document.getElementById(`videoSeriesManagerEpisodeLabel_${Number(groupIndex || 0)}_${rowIndex}`)?.value?.trim() || '',
      episode_number: document.getElementById(`videoSeriesManagerEpisodeNumber_${Number(groupIndex || 0)}_${rowIndex}`)?.value?.trim() || '',
    });
  });
  for (const [itemId, files] of itemsById.entries()) {
    const item = (_videoCatalogModalState.items || []).find((entry) => Number(entry?.id || 0) === Number(itemId || 0));
    const result = await api(`/api/admin/videos/catalog/${itemId}`, {
      method: 'PUT',
      body: {
        display_title: seriesTitle,
        media_type: 'series',
        release_year: item?.release_year != null ? String(item.release_year) : '',
        poster_url: item?.poster_url || '',
        poster_relative_path: item?.poster_relative_path || '',
        genres: catalogCsv(item?.genres),
        cast_members: catalogCsv(item?.cast_members),
        creators: catalogCsv(item?.creators),
        tags: catalogCsv(item?.tags),
        original_language: item?.original_language || '',
        country: item?.country || '',
        content_rating: item?.content_rating || '',
        runtime_minutes: item?.runtime_minutes != null ? String(item.runtime_minutes) : '',
        season_count: item?.season_count != null ? String(item.season_count) : '',
        episode_count: item?.episode_count != null ? String(item.episode_count) : '',
        synopsis: item?.synopsis || '',
        ai_notes: item?.ai_notes || '',
        files,
      },
    });
    if (!result?.success) {
      toast(result?.error || 'Could not save series group.', 'error');
      return;
    }
    _videoCatalogModalState.items = Array.isArray(result.items) ? result.items : _videoCatalogModalState.items;
  }
  toast(`Saved ${seriesTitle}`, 'success');
  showVideoSeriesManagerModal();
}

function showVideoSeriesManagerModal() {
  if (_userRole !== 'admin') {
    toast('Only admins can manage series.', 'error');
    return;
  }
  const openSeriesManager = () => {
    const groups = videoCatalogSeriesManagerGroups().filter((group) => group.rows.length);
    openModal('Series Manager', `
      <div class="video-series-manager">
        <div class="video-series-manager-top">
          <div>
            <div class="video-series-manager-title">Series Manager</div>
            <div class="video-series-manager-intro">Pick which folder level should become the <strong>series</strong>, which should become the <strong>season</strong>, and the browser will build episode names from there.</div>
          </div>
          <button type="button" class="video-series-manager-close" onclick="closeModal()" aria-label="Close">&times;</button>
        </div>
        <div class="video-series-manager-list">
          ${groups.length ? groups.map((group, groupIndex) => `
            <div class="video-series-manager-card">
              <div class="video-series-manager-head">
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Series Name</span>
                  <input class="fi" id="videoSeriesManagerTitle_${groupIndex}" value="${escHtml(group.title || '')}" placeholder="Lost" oninput="renderVideoSeriesManagerPreview(${groupIndex})">
                </label>
                <label class="video-catalog-field">
                  <span>Series Source</span>
                  <select class="fi" id="videoSeriesManagerSeriesSource_${groupIndex}" onchange="renderVideoSeriesManagerPreview(${groupIndex})">
                    <option value="manual">Manual title</option>
                    ${group.folderOptions.map((option) => `<option value="${escHtml(option.value)}">${escHtml(option.label)}</option>`).join('')}
                  </select>
                </label>
                <label class="video-catalog-field">
                  <span>Season Source</span>
                  <select class="fi" id="videoSeriesManagerSeasonSource_${groupIndex}" onchange="renderVideoSeriesManagerPreview(${groupIndex})">
                    <option value="none">No season folder</option>
                    ${group.folderOptions.map((option) => `<option value="${escHtml(option.value)}"${option.value === group.defaultSeasonSource ? ' selected' : ''}>${escHtml(option.label)}</option>`).join('')}
                  </select>
                </label>
                <label class="video-catalog-field">
                  <span>Episode Source</span>
                  <select class="fi" id="videoSeriesManagerEpisodeSource_${groupIndex}" onchange="renderVideoSeriesManagerPreview(${groupIndex})">
                    <option value="filename">Filename</option>
                    <option value="existing">Saved label</option>
                    ${group.folderOptions.map((option) => `<option value="${escHtml(option.value)}">${escHtml(option.label)}</option>`).join('')}
                  </select>
                </label>
                <button type="button" class="btn btn-p" onclick="saveVideoSeriesManagerGroup(${groupIndex})">Save Series</button>
              </div>
              <div class="video-series-manager-folderbar">
                <label class="video-catalog-field video-catalog-field-wide">
                  <span>Series Folder Path</span>
                  <input class="fi" id="videoSeriesManagerScanPath_${groupIndex}" value="${escHtml(group.scanPath || '')}" placeholder="D:\\Series\\English\\Lost">
                </label>
                <button type="button" class="btn btn-s" onclick="scanVideoSeriesManagerFolder(${groupIndex})">Scan Folder</button>
                <button type="button" class="btn btn-s danger" onclick="removeVideoSeriesManagerGroup(${groupIndex})">Remove Folder</button>
              </div>
              <div class="video-series-manager-meta">${group.rows.length} episode file${group.rows.length === 1 ? '' : 's'} • ${group.items.length} catalog entr${group.items.length === 1 ? 'y' : 'ies'}</div>
              <div class="video-series-manager-paths">
                ${group.pathPreview.map((entry) => `<div class="video-series-manager-path">${escHtml(entry)}</div>`).join('')}
              </div>
              <div class="video-series-manager-preview" id="videoSeriesManagerPreview_${groupIndex}"></div>
              <div class="video-series-manager-grid">
                ${group.rows.map((row) => `
                  <div class="video-series-manager-row">
                    <div class="video-series-manager-file">${escHtml(row.fileName)}</div>
                    <div class="video-series-manager-file-sub">${escHtml(row.relativePath || '-')}</div>
                  </div>`).join('')}
              </div>
            </div>`).join('') : '<div class="video-catalog-empty">No detected series files yet. Run Catalog Sync first.</div>'}
        </div>
      </div>`);
    window.__videoSeriesManagerGroups = groups;
    groups.forEach((_group, groupIndex) => renderVideoSeriesManagerPreview(groupIndex));
  };
  if (!Array.isArray(_videoCatalogModalState.items) || !_videoCatalogModalState.items.length) {
    _videoCatalogModalState.path = _videoCatalogModalState.path || _videoLibraryData?.settings?.videos_root_path || '';
    loadVideoCatalogItems().then(openSeriesManager).catch((error) => {
      console.error('showVideoSeriesManagerModal failed', error);
      toast(error?.message || 'Could not load series manager.', 'error');
    });
    return;
  }
  openSeriesManager();
}

async function saveVideoSeriesManagerGroup(groupIndex) {
  const groups = Array.isArray(window.__videoSeriesManagerGroups) ? window.__videoSeriesManagerGroups : [];
  const group = groups[Number(groupIndex || 0)];
  if (!group) {
    toast('Series group not found.', 'error');
    return;
  }
  const seriesSource = document.getElementById(`videoSeriesManagerSeriesSource_${Number(groupIndex || 0)}`)?.value?.trim() || 'manual';
  const manualTitle = document.getElementById(`videoSeriesManagerTitle_${Number(groupIndex || 0)}`)?.value?.trim() || '';
  if (!manualTitle && seriesSource === 'manual') {
    toast('Enter series name.', 'error');
    return;
  }
  const preview = videoCatalogSeriesManagerPreviewData(group, groupIndex);
  const resolvedSeriesTitle = String(preview.seriesTitle || manualTitle || group.title || 'Series').trim();
  const itemsById = new Map();
  group.rows.forEach((row) => {
    const seasonMeta = videoCatalogSeriesManagerSeasonMetaForRow(row, groupIndex);
    const episodeMeta = videoCatalogSeriesManagerEpisodeMetaForRow(row, groupIndex);
    if (!itemsById.has(row.itemId)) itemsById.set(row.itemId, []);
    itemsById.get(row.itemId).push({
      id: row.fileId,
      series_title: videoCatalogSeriesManagerSeriesTitleForRow(row, groupIndex) || resolvedSeriesTitle,
      season_label: seasonMeta.season_label,
      season_number: seasonMeta.season_number,
      episode_label: episodeMeta.episode_label,
      episode_number: episodeMeta.episode_number,
    });
  });
  for (const [itemId, files] of itemsById.entries()) {
    const item = (_videoCatalogModalState.items || []).find((entry) => Number(entry?.id || 0) === Number(itemId || 0));
    const result = await api(`/api/admin/videos/catalog/${itemId}`, {
      method: 'PUT',
      body: {
        display_title: resolvedSeriesTitle,
        media_type: 'series',
        release_year: item?.release_year != null ? String(item.release_year) : '',
        poster_url: item?.poster_url || '',
        poster_relative_path: item?.poster_relative_path || '',
        genres: catalogCsv(item?.genres),
        cast_members: catalogCsv(item?.cast_members),
        creators: catalogCsv(item?.creators),
        tags: catalogCsv(item?.tags),
        original_language: item?.original_language || '',
        country: item?.country || '',
        content_rating: item?.content_rating || '',
        runtime_minutes: item?.runtime_minutes != null ? String(item.runtime_minutes) : '',
        season_count: preview.seasons.length ? String(preview.seasons.length) : (item?.season_count != null ? String(item.season_count) : ''),
        episode_count: preview.totalEpisodes ? String(preview.totalEpisodes) : (item?.episode_count != null ? String(item.episode_count) : ''),
        synopsis: item?.synopsis || '',
        ai_notes: item?.ai_notes || '',
        files,
      },
    });
    if (!result?.success) {
      toast(result?.error || 'Could not save series group.', 'error');
      return;
    }
    _videoCatalogModalState.items = Array.isArray(result.items) ? result.items : _videoCatalogModalState.items;
  }
  toast(`Saved ${resolvedSeriesTitle}`, 'success');
  showVideoSeriesManagerModal();
}

async function scanVideoSeriesManagerFolder(groupIndex) {
  const scanPath = videoCatalogSeriesManagerScanPath(groupIndex);
  if (!scanPath) {
    toast('Enter series folder path first.', 'error');
    return;
  }
  const result = await videoCatalogApi('/api/admin/videos/catalog/scan', {
    method: 'POST',
    body: { scan_path: scanPath },
  });
  if (!result?.success) {
    toast(result?.error || 'Could not scan this folder.', 'error');
    return;
  }
  _videoCatalogModalState.path = String(result?.result?.root_path || scanPath).trim();
  _videoCatalogModalState.items = Array.isArray(result.items) ? result.items : [];
  toast(`Scanned ${result?.result?.scanned_count || 0} item${Number(result?.result?.scanned_count || 0) === 1 ? '' : 's'}`, 'success');
  showVideoSeriesManagerModal();
}

async function removeVideoSeriesManagerGroup(groupIndex) {
  const groups = Array.isArray(window.__videoSeriesManagerGroups) ? window.__videoSeriesManagerGroups : [];
  const group = groups[Number(groupIndex || 0)];
  if (!group) {
    toast('Series group not found.', 'error');
    return;
  }
  const itemIds = (Array.isArray(group.items) ? group.items : []).map((item) => Number(item?.id || 0)).filter((id) => id > 0);
  if (!itemIds.length) {
    toast('No folder items found to remove.', 'error');
    return;
  }
  const confirmed = window.confirm(`Remove "${group.title || 'this folder'}" from the video catalog?`);
  if (!confirmed) return;
  const result = await api('/api/admin/videos/catalog/delete', {
    method: 'POST',
    body: { item_ids: itemIds },
  });
  if (!result?.success) {
    toast(result?.error || 'Could not remove folder.', 'error');
    return;
  }
  _videoCatalogModalState.items = Array.isArray(result.items) ? result.items : [];
  toast(`Removed ${group.title || 'folder'}`, 'success');
  showVideoSeriesManagerModal();
}

function videoCatalogSetStatus(status) {
  _videoCatalogModalState.status = String(status || 'all');
  renderVideoCatalogModal();
}

function clearVideoCatalogRevealTimer() {
  if (_videoCatalogModalState.revealTimer) {
    clearInterval(_videoCatalogModalState.revealTimer);
    _videoCatalogModalState.revealTimer = null;
  }
}

function resetVideoCatalogBusyState() {
  clearVideoCatalogRevealTimer();
  _videoCatalogModalState.loading = false;
  _videoCatalogModalState.aiLoading = false;
  _videoCatalogModalState.abortController = null;
  _videoCatalogModalState.cancelRequested = false;
  _videoCatalogModalState.busyKind = '';
}

function videoCatalogIsBusy() {
  return !!(
    _videoCatalogModalState.loading
    || _videoCatalogModalState.aiLoading
    || _videoCatalogModalState.revealTimer
  );
}

async function videoCatalogApi(url, opts = {}, signal = undefined) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      signal,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      const isRateLimited = Number(res.status || 0) === 429;
      const likelyCreditIssue = /credit|quota|billing|balance|insufficient/i.test(String(text || ''));
      return {
        success: false,
        error: text?.trim() || `Request failed with status ${res.status}`,
        status: res.status,
        rate_limited: isRateLimited,
        quota_exhausted: isRateLimited && likelyCreditIssue,
      };
    }
    const data = await res.json();
    if (Number(res.status || 0) === 429) {
      const message = String(data?.error || data?.message || '').trim();
      const likelyCreditIssue = /credit|quota|billing|balance|insufficient/i.test(message);
      return {
        success: false,
        status: res.status,
        ...data,
        rate_limited: true,
        quota_exhausted: Boolean(data?.quota_exhausted) || likelyCreditIssue,
      };
    }
    if (res.ok) return data;
    return { success: false, status: res.status, ...data };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { success: false, aborted: true, error: 'Stopped' };
    }
    return { success: false, error: err?.message || 'Network request failed' };
  }
}

function videoCatalogStopNow() {
  _videoCatalogModalState.cancelRequested = true;
  if (_videoCatalogModalState.abortController) {
    try { _videoCatalogModalState.abortController.abort(); } catch (_err) {}
  }
  clearVideoCatalogRevealTimer();
  _videoCatalogModalState.loading = false;
  _videoCatalogModalState.aiLoading = false;
  _videoCatalogModalState.busyKind = '';
  _videoCatalogModalState.scanNotice = 'Process stopped';
  renderVideoCatalogModal();
  toast('Video catalog process stopped', 'success');
}

function videoCatalogFinishAiRun(message = '', toastMessage = '', toastType = 'warning') {
  _videoCatalogModalState.cancelRequested = true;
  if (_videoCatalogModalState.abortController) {
    try { _videoCatalogModalState.abortController.abort(); } catch (_err) {}
  }
  clearVideoCatalogRevealTimer();
  _videoCatalogModalState.loading = false;
  _videoCatalogModalState.aiLoading = false;
  _videoCatalogModalState.busyKind = '';
  _videoCatalogModalState.abortController = null;
  if (message) _videoCatalogModalState.scanNotice = String(message);
  renderVideoCatalogModal();
  if (toastMessage) toast(toastMessage, toastType);
}

function videoCatalogSleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function videoCatalogShortTitle(item) {
  const raw = String(item?.display_title || item?.folder_name || '').trim();
  if (!raw) return 'Untitled';
  return raw.length > 48 ? `${raw.slice(0, 48).trim()}...` : raw;
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

async function videoCatalogApiWithTimeout(url, opts = {}, externalController = null, timeoutMs = 60000) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    try { timeoutController.abort(); } catch (_err) {}
  }, Math.max(1000, Number(timeoutMs || 0)));
  try {
    let signal = timeoutController.signal;
    if (externalController?.signal) {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        signal = AbortSignal.any([externalController.signal, timeoutController.signal]);
      } else {
        externalController.signal.addEventListener('abort', () => {
          try { timeoutController.abort(); } catch (_err) {}
        }, { once: true });
      }
    }
    return await videoCatalogApi(url, opts, signal);
  } finally {
    clearTimeout(timer);
  }
}

function revealVideoCatalogItems(items = [], doneMessage = '') {
  clearVideoCatalogRevealTimer();
  const queue = Array.isArray(items) ? [...items] : [];
  if (!queue.length) {
    _videoCatalogModalState.items = [];
    _videoCatalogModalState.scanNotice = doneMessage || '';
    renderVideoCatalogModal();
    return;
  }
  _videoCatalogModalState.items = [];
  _videoCatalogModalState.scanNotice = `Loading ${queue.length} file${queue.length === 1 ? '' : 's'}...`;
  renderVideoCatalogModal();
  const step = Math.min(8, Math.max(1, Math.ceil(queue.length / 18)));
  _videoCatalogModalState.revealTimer = setInterval(() => {
    if (_videoCatalogModalState.cancelRequested) {
      clearVideoCatalogRevealTimer();
      _videoCatalogModalState.scanNotice = 'Process stopped';
      renderVideoCatalogModal();
      return;
    }
    _videoCatalogModalState.items = _videoCatalogModalState.items.concat(queue.splice(0, step));
    _videoCatalogModalState.scanNotice = queue.length
      ? `Loading files... ${_videoCatalogModalState.items.length}/${items.length}`
      : (doneMessage || `Loaded ${items.length} file${items.length === 1 ? '' : 's'}`);
    renderVideoCatalogModal();
    if (!queue.length) {
      clearVideoCatalogRevealTimer();
    }
  }, 60);
}

async function videoCatalogScanNow() {
  _videoCatalogModalState.path = document.getElementById('videoCatalogScanPath')?.value?.trim() || _videoCatalogModalState.path || '';
  _videoCatalogModalState.cancelRequested = false;
  clearVideoCatalogRevealTimer();
  _videoCatalogModalState.loading = true;
  _videoCatalogModalState.busyKind = 'scan';
  _videoCatalogModalState.abortController = new AbortController();
  _videoCatalogModalState.scanNotice = 'Preparing recursive scan...';
  renderVideoCatalogModal();
  try {
    const result = await videoCatalogApi('/api/admin/videos/catalog/scan', {
      method: 'POST',
      body: { scan_path: _videoCatalogModalState.path },
    }, _videoCatalogModalState.abortController.signal);
    if (result?.aborted || _videoCatalogModalState.cancelRequested) return;
    if (!result?.success) throw new Error(result?.error || 'Could not scan the folder.');
    const scannedItems = Array.isArray(result.items) ? result.items : [];
    _videoCatalogModalState.status = 'all';
    revealVideoCatalogItems(scannedItems, `Scanned ${result?.result?.scanned_count || scannedItems.length || 0} file${(result?.result?.scanned_count || scannedItems.length || 0) === 1 ? '' : 's'}`);
    toast(`Scanned ${result?.result?.scanned_count || scannedItems.length || 0} file${(result?.result?.scanned_count || scannedItems.length || 0) === 1 ? '' : 's'}`, 'success');
  } catch (error) {
    if (_videoCatalogModalState.cancelRequested) return;
    toast(error?.message || 'Could not scan the folder.', 'error');
  } finally {
    _videoCatalogModalState.loading = false;
    _videoCatalogModalState.abortController = null;
    _videoCatalogModalState.busyKind = '';
    renderVideoCatalogModal();
  }
}

async function videoCatalogAiDraftNow() {
  _videoCatalogModalState.path = document.getElementById('videoCatalogScanPath')?.value?.trim() || _videoCatalogModalState.path || '';
  clearVideoCatalogRevealTimer();
  const sourceItems = Array.isArray(_videoCatalogModalState.items) ? _videoCatalogModalState.items : [];
  const totalItems = sourceItems.length;
  const targetItems = sourceItems.filter((item) => {
    const status = String(item.status || '').trim().toLowerCase();
    const missingPoster = !String(item.poster_relative_path || '').trim();
    return status === 'scanned' || status === 'review' || missingPoster;
  }).sort((a, b) => {
    const scoreDiff = scoreVideoCatalogAiCandidate(a) - scoreVideoCatalogAiCandidate(b);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.display_title || a.folder_name || '').localeCompare(String(b.display_title || b.folder_name || ''));
  });
  const completedBefore = totalItems - targetItems.length;
  if (!targetItems.length) {
    toast('All titles already have AI metadata and posters.', 'success');
    return;
  }
  _videoCatalogModalState.cancelRequested = false;
  _videoCatalogModalState.aiLoading = true;
  _videoCatalogModalState.busyKind = 'ai';
  _videoCatalogModalState.scanNotice = `Preparing AI metadata and posters for ${targetItems.length} pending title${targetItems.length === 1 ? '' : 's'}...`;
  renderVideoCatalogModal();
  try {
    let completed = 0;
    let failed = 0;
    let latestItems = sourceItems;
    const batchSize = 3;
    let consecutiveRateLimitedBatches = 0;
    for (let batchIndex = 0; batchIndex < targetItems.length; batchIndex += batchSize) {
      if (_videoCatalogModalState.cancelRequested) break;
      const batch = targetItems.slice(batchIndex, batchIndex + batchSize);
      const batchLabel = videoCatalogShortTitle(batch[0]);
      let batchCompleted = false;
      let attempts = 0;
      while (!batchCompleted && attempts < 3 && !_videoCatalogModalState.cancelRequested) {
        attempts += 1;
        _videoCatalogModalState.scanNotice = attempts > 1
          ? `Retrying ${batchLabel} batch... ${completedBefore + completed}/${totalItems} (attempt ${attempts}/3)`
          : `Fetching ${batchLabel} batch... ${completedBefore + completed}/${totalItems}`;
        renderVideoCatalogModal();
        try {
          _videoCatalogModalState.abortController = new AbortController();
          const result = await videoCatalogApiWithTimeout('/api/admin/videos/catalog/ai-draft', {
            method: 'POST',
            body: {
              root_path: _videoCatalogModalState.path,
              item_ids: batch.map((item) => Number(item.id || 0)).filter((id) => id > 0),
            },
          }, _videoCatalogModalState.abortController, 120000);
          _videoCatalogModalState.abortController = null;
          if (result?.aborted || _videoCatalogModalState.cancelRequested) break;
          if (Number(result?.status || 0) === 429 && !result?.rate_limited) {
            const likelyCreditIssue = /credit|quota|billing|balance|insufficient/i.test(String(result?.error || ''));
            videoCatalogFinishAiRun(
              likelyCreditIssue
                ? 'OpenAI API balance appears exhausted. Please recharge your API credit and retry.'
                : 'OpenAI is rate limited right now. Please wait a little and retry.',
              likelyCreditIssue
                ? 'OpenAI API balance appears exhausted. Please recharge and try again.'
                : 'OpenAI is rate limited right now. Please retry after a short wait.',
              'warning'
            );
            return;
          }
          if (result?.quota_exhausted) {
            failed += batch.length;
            videoCatalogFinishAiRun(
              'OpenAI API balance appears exhausted. Please recharge your API credit and retry.',
              'OpenAI API balance appears exhausted. Please recharge and try again.',
              'warning'
            );
            return;
          }
          if (result?.rate_limited) {
            failed += batch.length;
            consecutiveRateLimitedBatches += 1;
            const likelyCreditIssue = Boolean(result?.quota_exhausted) || /credit|quota|billing|balance|insufficient/i.test(String(result?.error || ''));
            videoCatalogFinishAiRun(
              likelyCreditIssue
                ? 'OpenAI API balance appears exhausted. Please recharge your API credit and retry.'
                : 'OpenAI is rate limited right now. Please wait a little and retry.',
              likelyCreditIssue
                ? 'OpenAI API balance appears exhausted. Please recharge and try again.'
                : 'OpenAI is rate limited right now. Please retry after a short wait.',
              'warning'
            );
            return;
          }
          if (!result?.success) {
            const err = new Error(result?.error || 'Could not fetch AI details.');
            err.status = Number(result?.status || 0);
            throw err;
          }
          const updatedCount = Math.max(0, Number(result?.updated_count || batch.length || 0));
          completed += updatedCount;
          consecutiveRateLimitedBatches = 0;
          batchCompleted = true;
          latestItems = Array.isArray(result.items) ? result.items : latestItems;
          _videoCatalogModalState.items = latestItems;
          _videoCatalogModalState.scanNotice = `Fetched ${batchLabel} batch. ${completedBefore + completed}/${totalItems}`;
          renderVideoCatalogModal();
          if (!_videoCatalogModalState.cancelRequested) {
            await videoCatalogSleep(2600);
          }
        } catch (error) {
          _videoCatalogModalState.abortController = null;
          if (_videoCatalogModalState.cancelRequested) break;
          const status = Number(error?.status || 0);
          if (status === 429) {
            failed += batch.length;
            consecutiveRateLimitedBatches += 1;
            const likelyCreditIssue = /credit|quota|billing|balance|insufficient/i.test(String(error?.message || ''));
            videoCatalogFinishAiRun(
              likelyCreditIssue
                ? 'OpenAI API balance appears exhausted. Please recharge your API credit and retry.'
                : 'OpenAI is rate limited right now. Please wait a little and retry.',
              likelyCreditIssue
                ? 'OpenAI API balance appears exhausted. Please recharge and try again.'
                : 'OpenAI is rate limited right now. Please retry after a short wait.',
              'warning'
            );
            return;
          }
          failed += batch.length;
          _videoCatalogModalState.scanNotice = `Skipped ${batchLabel} batch. ${completedBefore + completed}/${totalItems}`;
          renderVideoCatalogModal();
          break;
        }
      }
    }
    if (_videoCatalogModalState.cancelRequested) return;
    _videoCatalogModalState.items = Array.isArray(latestItems) ? latestItems : _videoCatalogModalState.items;
    _videoCatalogModalState.status = 'review';
    _videoCatalogModalState.scanNotice = failed
      ? `AI metadata/posters finished. ${completedBefore + completed}/${totalItems} completed, ${failed} skipped`
      : `AI metadata and posters ready. ${completedBefore + completed}/${totalItems} completed`;
    toast(
      failed
        ? `AI metadata fetched for ${completed} title${completed === 1 ? '' : 's'}; ${failed} skipped`
        : `AI metadata fetched for ${completed} title${completed === 1 ? '' : 's'}`,
      failed ? 'warning' : 'success'
    );
  } catch (error) {
    if (_videoCatalogModalState.cancelRequested) return;
    toast(error?.message || 'Could not fetch AI details.', 'error');
  } finally {
    clearVideoCatalogRevealTimer();
    _videoCatalogModalState.aiLoading = false;
    _videoCatalogModalState.abortController = null;
    _videoCatalogModalState.busyKind = '';
    renderVideoCatalogModal();
  }
}


async function videoCatalogClearNow() {
  _videoCatalogModalState.path = document.getElementById('videoCatalogScanPath')?.value?.trim() || _videoCatalogModalState.path || '';
  const targetPath = _videoCatalogModalState.path || '';
  const message = targetPath
    ? `Clean all existing scanned/published video structure for:\n${targetPath}\n\nThis only clears the saved catalog data, not your actual video files.`
    : 'Clean all existing saved video catalog structure?\n\nThis only clears the saved catalog data, not your actual video files.';
  if (!confirm(message)) return;
  clearVideoCatalogRevealTimer();
  _videoCatalogModalState.loading = true;
  _videoCatalogModalState.scanNotice = 'Cleaning existing catalog structure...';
  renderVideoCatalogModal();
  try {
    const result = await api('/api/admin/videos/catalog/clear', {
      method: 'POST',
      body: { root_path: targetPath },
    });
    if (!result?.success) throw new Error(result?.error || 'Could not clear the existing structure.');
    _videoCatalogModalState.items = [];
    _videoCatalogModalState.status = 'all';
    _videoCatalogModalState.scanNotice = `Cleared ${result?.result?.cleared_count || 0} catalog entr${Number(result?.result?.cleared_count || 0) === 1 ? 'y' : 'ies'}`;
    toast('Existing video catalog structure cleared', 'success');
    renderVideoCatalogModal();
    await loadVideosPage();
  } catch (error) {
    toast(error?.message || 'Could not clear the existing structure.', 'error');
  } finally {
    _videoCatalogModalState.loading = false;
    renderVideoCatalogModal();
  }
}

async function videoCatalogPublishItem(itemId) {
  const result = await api('/api/admin/videos/catalog/publish', {
    method: 'POST',
    body: { item_ids: [Number(itemId || 0)] },
  });
  if (!result?.success) {
    toast(result?.error || 'Could not publish the title.', 'error');
    return;
  }
  _videoCatalogModalState.items = Array.isArray(result.items) ? result.items : [];
  toast('Title published to the live library', 'success');
  renderVideoCatalogModal();
  await loadVideosPage();
}

async function videoCatalogPublishReviewReady() {
  const reviewIds = (Array.isArray(_videoCatalogModalState.items) ? _videoCatalogModalState.items : [])
    .filter((item) => {
      const status = String(item.status || '').trim().toLowerCase();
      return status === 'review' || status === 'scanned';
    })
    .map((item) => Number(item.id || 0))
    .filter((itemId) => itemId > 0);
  if (!reviewIds.length) {
    toast('No scanned or review-ready titles found.', 'error');
    return;
  }
  const result = await api('/api/admin/videos/catalog/publish', {
    method: 'POST',
    body: { item_ids: reviewIds },
  });
  if (!result?.success) {
    toast(result?.error || 'Could not publish titles.', 'error');
    return;
  }
  _videoCatalogModalState.items = Array.isArray(result.items) ? result.items : [];
  toast(`Published ${result?.result?.published_count || 0} titles`, 'success');
  renderVideoCatalogModal();
  await loadVideosPage();
}

let _videoAdminPanelState = {
  settings: null,
  moviesTree: null,
  seriesTree: null,
};

function videoAdminNormalizeHiddenPaths(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/\r?\n|,/)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  return [...new Set(source)];
}

function videoAdminReadSettingsFromModal() {
  const previous = _videoAdminPanelState.settings || {};
  return {
    library_title: document.getElementById('videoAdminLibraryTitle')?.value?.trim() || previous.library_title || 'Video Library',
    videos_root_path: document.getElementById('videoAdminDefaultRoot')?.value?.trim()
      || document.getElementById('videoAdminSeriesRoot')?.value?.trim()
      || document.getElementById('videoAdminMoviesRoot')?.value?.trim()
      || previous.videos_root_path
      || '',
    movies_root_path: document.getElementById('videoAdminMoviesRoot')?.value?.trim() || '',
    series_root_path: document.getElementById('videoAdminSeriesRoot')?.value?.trim() || '',
    recursive_scan: !!document.getElementById('videoAdminRecursive')?.checked,
    allowed_extensions: document.getElementById('videoAdminExtensions')?.value?.trim() || '.mp4, .webm, .ogg, .mov, .m4v, .mkv',
    hidden_paths: videoAdminNormalizeHiddenPaths(document.getElementById('videoAdminHiddenPaths')?.value || previous.hidden_paths || []),
  };
}

async function videoAdminFetchTree(rootPath) {
  const pathValue = String(rootPath || '').trim();
  if (!pathValue) return null;
  const result = await api(`/api/admin/videos/folders/tree?root_path=${encodeURIComponent(pathValue)}&max_depth=5`);
  if (!result?.success) throw new Error(result?.error || 'Could not load folder tree.');
  return result.tree || null;
}

async function loadVideoAdminPanel() {
  const settingsResult = await api('/api/admin/videos/settings');
  if (!settingsResult?.success) throw new Error(settingsResult?.error || 'Could not load video settings.');
  const settings = settingsResult.settings || {};
  const [moviesTree, seriesTree] = await Promise.all([
    settings.movies_root_path ? videoAdminFetchTree(settings.movies_root_path) : Promise.resolve(null),
    settings.series_root_path ? videoAdminFetchTree(settings.series_root_path) : Promise.resolve(null),
  ]);
  _videoAdminPanelState = { settings, moviesTree, seriesTree };
}

function renderVideoAdminTreeNode(node, kind, depth = 0) {
  if (!node) return '';
  const absolutePath = String(node.absolute_path || '').trim();
  const isHidden = !!node.hidden;
  return `
    <div class="video-admin-tree-node" style="margin-left:${depth * 14}px">
      <div class="video-admin-tree-row">
        <div class="video-admin-tree-copy">
          <div class="video-admin-tree-name">${escHtml(node.name || node.relative_path || absolutePath || 'Folder')}</div>
          <div class="video-admin-tree-meta">${escHtml(absolutePath || '')} • ${Number(node.video_file_count || 0)} video files • ${Number(node.folder_count || 0)} subfolders${isHidden ? ' • Hidden' : ''}</div>
        </div>
        <div class="video-admin-tree-actions">
          <button class="btn btn-s btn-sm" type="button" onclick='videoAdminAssignRoot("${kind}", ${JSON.stringify(absolutePath)})'>Use Here</button>
          <button class="btn btn-s btn-sm" type="button" onclick='videoAdminScanFolderPath(${JSON.stringify(absolutePath)})'>Scan</button>
          <button class="btn btn-s btn-sm" type="button" onclick='videoAdminToggleHidden(${JSON.stringify(absolutePath)}, ${isHidden ? 'false' : 'true'})'>${isHidden ? 'Unhide' : 'Hide'}</button>
        </div>
      </div>
      ${(Array.isArray(node.children) && node.children.length) ? `<div class="video-admin-tree-children">${node.children.map((child) => renderVideoAdminTreeNode(child, kind, depth + 1)).join('')}</div>` : ''}
    </div>`;
}

function renderVideoAdminPanel() {
  const settings = _videoAdminPanelState.settings || {};
  const hiddenPaths = Array.isArray(settings.hidden_paths) ? settings.hidden_paths : [];
  openModal('Video Admin Panel', `
    <div class="video-admin-panel">
      <div class="video-admin-header">
        <div>
          <div class="video-admin-title">Video Admin Panel</div>
          <div class="video-admin-sub">Choose separate movie and series folders, browse the real folder structure, scan only the folders you want, and hide anything from the browser library.</div>
        </div>
        <button type="button" class="video-series-manager-close" onclick="closeModal()" aria-label="Close">&times;</button>
      </div>
      <div class="video-admin-grid">
        <label class="video-catalog-field video-catalog-field-wide">
          <span>Library Title</span>
          <input class="fi" id="videoAdminLibraryTitle" value="${escHtml(settings.library_title || 'Video Library')}" placeholder="Video Library">
        </label>
        <label class="video-catalog-field">
          <span>Movies Root</span>
          <input class="fi" id="videoAdminMoviesRoot" value="${escHtml(settings.movies_root_path || '')}" placeholder="D:\\Movies">
        </label>
        <label class="video-catalog-field">
          <span>Series Root</span>
          <input class="fi" id="videoAdminSeriesRoot" value="${escHtml(settings.series_root_path || '')}" placeholder="D:\\Series">
        </label>
        <label class="video-catalog-field">
          <span>Default Runtime Root</span>
          <input class="fi" id="videoAdminDefaultRoot" value="${escHtml(settings.videos_root_path || '')}" placeholder="Fallback root">
        </label>
        <label class="video-catalog-field">
          <span>Allowed Extensions</span>
          <input class="fi" id="videoAdminExtensions" value="${escHtml((settings.allowed_extensions || ['.mp4', '.webm', '.ogg', '.mov', '.m4v', '.mkv']).join(', '))}" placeholder=".mp4, .mkv">
        </label>
        <label class="video-catalog-field video-catalog-field-wide" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="videoAdminRecursive" ${settings.recursive_scan !== false ? 'checked' : ''} style="width:16px;height:16px">
          Scan subfolders recursively
        </label>
        <label class="video-catalog-field video-catalog-field-wide">
          <span>Hidden Folders</span>
          <textarea class="fi" id="videoAdminHiddenPaths" rows="4" placeholder="One absolute folder path per line">${escHtml(hiddenPaths.join('\n'))}</textarea>
        </label>
      </div>
      <div class="video-admin-actions">
        <button class="btn btn-p" type="button" onclick="saveVideoLibrarySettings()">Save Admin Settings</button>
        <button class="btn btn-s" type="button" onclick="videoAdminLoadTreeForRoot('movies')">Load Movies Tree</button>
        <button class="btn btn-s" type="button" onclick="videoAdminLoadTreeForRoot('series')">Load Series Tree</button>
        <button class="btn btn-s" type="button" onclick="videoAdminScanRoot('movies')">Scan Movies Root</button>
        <button class="btn btn-s" type="button" onclick="videoAdminScanRoot('series')">Scan Series Root</button>
        <button class="btn btn-g" type="button" onclick="showVideoSeriesManagerModal()">Series Mapping</button>
      </div>
      <div class="video-admin-columns">
        <div class="video-admin-card">
          <div class="video-admin-card-head">
            <div class="video-admin-card-title">Movies Folder Structure</div>
            <div class="video-admin-card-meta">${escHtml(settings.movies_root_path || 'Set a movies root to browse folders')}</div>
          </div>
          <div class="video-admin-tree">${_videoAdminPanelState.moviesTree ? renderVideoAdminTreeNode(_videoAdminPanelState.moviesTree, 'movies') : '<div class="video-catalog-empty">No movies folder loaded yet.</div>'}</div>
        </div>
        <div class="video-admin-card">
          <div class="video-admin-card-head">
            <div class="video-admin-card-title">Series Folder Structure</div>
            <div class="video-admin-card-meta">${escHtml(settings.series_root_path || 'Set a series root to browse folders')}</div>
          </div>
          <div class="video-admin-tree">${_videoAdminPanelState.seriesTree ? renderVideoAdminTreeNode(_videoAdminPanelState.seriesTree, 'series') : '<div class="video-catalog-empty">No series folder loaded yet.</div>'}</div>
        </div>
      </div>
    </div>`);
}

async function videoAdminLoadTreeForRoot(kind) {
  const isMovies = String(kind || '') === 'movies';
  const inputId = isMovies ? 'videoAdminMoviesRoot' : 'videoAdminSeriesRoot';
  const rootPath = document.getElementById(inputId)?.value?.trim() || '';
  if (!rootPath) {
    toast(`Enter ${isMovies ? 'movies' : 'series'} root first.`, 'error');
    return;
  }
  const tree = await videoAdminFetchTree(rootPath);
  _videoAdminPanelState.settings = videoAdminReadSettingsFromModal();
  if (isMovies) _videoAdminPanelState.moviesTree = tree;
  else _videoAdminPanelState.seriesTree = tree;
  renderVideoAdminPanel();
}

function videoAdminAssignRoot(kind, folderPath) {
  const inputId = String(kind || '') === 'movies' ? 'videoAdminMoviesRoot' : 'videoAdminSeriesRoot';
  const input = document.getElementById(inputId);
  if (input) input.value = String(folderPath || '').trim();
}

async function videoAdminScanFolderPath(folderPath) {
  const pathValue = String(folderPath || '').trim();
  if (!pathValue) {
    toast('Folder path is missing.', 'error');
    return;
  }
  const result = await videoCatalogApi('/api/admin/videos/catalog/scan', {
    method: 'POST',
    body: { scan_path: pathValue },
  });
  if (!result?.success) {
    toast(result?.error || 'Could not scan folder.', 'error');
    return;
  }
  _videoCatalogModalState.path = String(result?.result?.root_path || pathValue).trim();
  _videoCatalogModalState.items = Array.isArray(result.items) ? result.items : [];
  toast(`Scanned ${result?.result?.scanned_count || 0} folders`, 'success');
}

async function videoAdminScanRoot(kind) {
  const inputId = String(kind || '') === 'movies' ? 'videoAdminMoviesRoot' : 'videoAdminSeriesRoot';
  const rootPath = document.getElementById(inputId)?.value?.trim() || '';
  if (!rootPath) {
    toast(`Enter ${kind} root first.`, 'error');
    return;
  }
  await videoAdminScanFolderPath(rootPath);
}

async function videoAdminToggleHidden(folderPath, shouldHide = true) {
  const settings = videoAdminReadSettingsFromModal();
  const nextHidden = new Set(videoAdminNormalizeHiddenPaths(settings.hidden_paths));
  if (shouldHide) nextHidden.add(String(folderPath || '').trim());
  else nextHidden.delete(String(folderPath || '').trim());
  settings.hidden_paths = [...nextHidden];
  const result = await api('/api/admin/videos/settings', {
    method: 'PUT',
    body: settings,
  });
  if (!result?.success) {
    toast(result?.error || 'Could not update hidden folders.', 'error');
    return;
  }
  await loadVideoAdminPanel();
  renderVideoAdminPanel();
  await loadVideosPage();
  toast(shouldHide ? 'Folder hidden from browser library' : 'Folder visible again', 'success');
}

function showVideoLibrarySettingsModal() {
  if (_userRole !== 'admin') {
    toast('Only admins can change video settings.', 'error');
    return;
  }
  openModal('Video Admin Panel', '<div class="video-catalog-empty">Loading admin panel...</div>');
  loadVideoAdminPanel().then(renderVideoAdminPanel).catch((error) => {
    console.error('showVideoLibrarySettingsModal failed', error);
    toast(error?.message || 'Could not load video admin panel.', 'error');
    closeModal();
  });
}

async function saveVideoLibrarySettings() {
  const payload = videoAdminReadSettingsFromModal();
  const result = await api('/api/admin/videos/settings', {
    method: 'PUT',
    body: payload,
  });
  if (!result?.success) {
    toast(result?.error || 'Could not save video settings.', 'error');
    return;
  }
  _videoAdminPanelState.settings = result.settings || payload;
  await loadVideoAdminPanel();
  renderVideoAdminPanel();
  toast('Video admin settings saved', 'success');
  await loadVideosPage();
}

window.loadVideosPage = loadVideosPage;
window.setVideoLibrarySearch = setVideoLibrarySearch;
window.setVideoLibraryMediaFilter = setVideoLibraryMediaFilter;
window.setVideoLibraryGenreFilter = setVideoLibraryGenreFilter;
window.selectVideoLibraryItem = selectVideoLibraryItem;
window.selectVideoLibraryFolder = selectVideoLibraryFolder;
window.openVideoLibraryDetail = openVideoLibraryDetail;
window.closeVideoLibraryDetail = closeVideoLibraryDetail;
window.videoLibraryPlaySeriesEpisode = videoLibraryPlaySeriesEpisode;
window.scrollVideoLibrarySection = scrollVideoLibrarySection;
window.videoLibraryOpenRandom = videoLibraryOpenRandom;
window.videoPlayerSeekTo = videoPlayerSeekTo;
window.videoPlayerToggle = videoPlayerToggle;
window.videoPlayerSeek = videoPlayerSeek;
window.videoPlayerMute = videoPlayerMute;
window.setVideoAudioTrack = setVideoAudioTrack;
window.videoPlayerSubtitleToggle = videoPlayerSubtitleToggle;
window.videoPlayerRate = videoPlayerRate;
window.videoPlayerCycleRate = videoPlayerCycleRate;
window.videoPlayerFullscreen = videoPlayerFullscreen;
window.showVideoCatalogModal = showVideoCatalogModal;
window.showVideoSeriesManagerModal = showVideoSeriesManagerModal;
window.saveVideoSeriesManagerGroup = saveVideoSeriesManagerGroup;
window.renderVideoSeriesManagerPreview = renderVideoSeriesManagerPreview;
window.scanVideoSeriesManagerFolder = scanVideoSeriesManagerFolder;
window.removeVideoSeriesManagerGroup = removeVideoSeriesManagerGroup;
window.setVideoLibraryDetailSeason = setVideoLibraryDetailSeason;
window.videoCatalogSetStatus = videoCatalogSetStatus;
window.videoCatalogScanNow = videoCatalogScanNow;
window.videoCatalogAiDraftNow = videoCatalogAiDraftNow;
window.videoCatalogClearNow = videoCatalogClearNow;
window.videoCatalogSaveItem = videoCatalogSaveItem;
window.videoCatalogPublishItem = videoCatalogPublishItem;
window.videoCatalogPublishReviewReady = videoCatalogPublishReviewReady;
window.showVideoLibrarySettingsModal = showVideoLibrarySettingsModal;
window.videoAdminLoadTreeForRoot = videoAdminLoadTreeForRoot;
window.videoAdminAssignRoot = videoAdminAssignRoot;
window.videoAdminScanRoot = videoAdminScanRoot;
window.videoAdminScanFolderPath = videoAdminScanFolderPath;
window.videoAdminToggleHidden = videoAdminToggleHidden;
window.saveVideoLibrarySettings = saveVideoLibrarySettings;
window.flushVideoPlaybackProgress = flushVideoPlaybackProgress;
window.flushVideoPlaybackProgressWithTimeout = flushVideoPlaybackProgressWithTimeout;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!sendVideoPlaybackProgressBeacon()) {
      flushVideoPlaybackProgress();
    }
  }
});
window.addEventListener('pagehide', () => {
  if (!sendVideoPlaybackProgressBeacon()) {
    flushVideoPlaybackProgress();
  }
});
