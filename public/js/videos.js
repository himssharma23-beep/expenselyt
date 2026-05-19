let _videoLibraryLoading = false;
let _videoLibraryData = { configured: false, root_exists: true, settings: null, videos: [], message: '', subtitle_engine: { available: false, message: '' } };
let _selectedVideoLibraryId = '';
let _videoLibrarySearch = '';
let _selectedVideoSubtitleId = '';
let _selectedVideoFolder = '';
let _videoProgressBoundVideoId = '';
let _videoProgressSaveTimer = null;

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
  const folder = String(_selectedVideoFolder || '').trim();
  return list.filter((video) => {
    if (folder) {
      const videoFolder = String(video.folder || '').trim();
      if (!(videoFolder === folder || videoFolder.startsWith(`${folder}/`))) return false;
    }
    if (!query) return true;
    const haystack = [
      video.title,
      video.filename,
      video.folder,
      video.relative_path,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
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

function setVideoLibrarySearch(value) {
  _videoLibrarySearch = String(value || '');
  const filtered = videoLibraryFilteredVideos();
  if (filtered.length && !filtered.some((video) => String(video.id) === String(_selectedVideoLibraryId))) {
    _selectedVideoLibraryId = String(filtered[0].id || '');
  }
  renderVideosPage();
}

function selectVideoLibraryItem(videoId) {
  flushVideoPlaybackProgress().finally(() => {
    _selectedVideoLibraryId = String(videoId || '');
    _selectedVideoSubtitleId = '';
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
    >`).join('');
}

function setVideoSubtitle(value) {
  _selectedVideoSubtitleId = String(value || '');
  const player = getVideoLibraryPlayer();
  if (!player) return;
  const textTracks = [...(player.textTracks || [])];
  textTracks.forEach((track) => {
    track.mode = 'disabled';
  });
  const trackEls = [...player.querySelectorAll('track')];
  trackEls.forEach((trackEl) => {
    trackEl.default = false;
  });
  if (!_selectedVideoSubtitleId) {
    updateVideoControlsUI();
    return;
  }
  const subtitles = Array.isArray(videoLibrarySelectedVideo()?.subtitles) ? videoLibrarySelectedVideo().subtitles : [];
  const selectedIndex = subtitles.findIndex((subtitle) => String(subtitle.id) === String(_selectedVideoSubtitleId));
  if (selectedIndex >= 0) {
    if (trackEls[selectedIndex]) trackEls[selectedIndex].default = true;
    if (textTracks[selectedIndex]) {
      try { textTracks[selectedIndex].mode = 'hidden'; } catch (_err) {}
      setTimeout(() => {
        try { textTracks[selectedIndex].mode = 'showing'; } catch (_err) {}
      }, 0);
    }
  }
  updateVideoControlsUI();
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
  if (!player || !video?.relative_path) return;
  const duration = Number(player.duration || video.progress?.duration_seconds || 0);
  const current = forceComplete ? duration : Number(player.currentTime || 0);
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
        ? _videoLibraryData.videos.map((item) => String(item.relative_path || '') === String(video.relative_path || '')
          ? { ...item, progress: optimisticProgress }
          : item)
        : [],
    };
  }
  const result = await api('/api/videos/progress', {
    method: 'POST',
    body: {
      relative_path: video.relative_path,
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
      ? _videoLibraryData.videos.map((item) => String(item.relative_path || '') === String(video.relative_path || '')
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
  const duration = Number(player.duration || video.progress?.duration_seconds || 0);
  const current = Number(player.currentTime || 0);
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

function setupVideoPlayerProgress() {
  const player = getVideoLibraryPlayer();
  const video = videoLibrarySelectedVideo();
  if (!player || !video) return;
  if (_videoProgressBoundVideoId === String(video.id) && player.dataset.progressBound === '1') return;
  _videoProgressBoundVideoId = String(video.id);
  player.dataset.progressBound = '1';
  clearVideoProgressTimer();

  player.onloadedmetadata = () => {
    const progress = video.progress || null;
    const resumeAt = Number(progress?.current_seconds || 0);
    const isCompleted = !!progress?.is_completed;
    if (!isCompleted && resumeAt > 5 && Number(player.duration || 0) > resumeAt + 5) {
      try { player.currentTime = resumeAt; } catch (_err) {}
    }
    setVideoSubtitle(_selectedVideoSubtitleId);
    updateVideoControlsUI();
  };
  player.ontimeupdate = () => {
    if (player.seeking) return;
    queueVideoPlaybackProgressSave();
  };
  player.onplay = () => {
    updateVideoControlsUI();
  };
  player.onpause = () => {
    queueVideoPlaybackProgressSave();
    updateVideoControlsUI();
  };
  player.onended = () => {
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
      const folders = videoLibraryFolders();
      if (_selectedVideoFolder && !folders.some((folder) => String(folder.folder) === String(_selectedVideoFolder))) {
        _selectedVideoFolder = folders[0]?.folder || '';
      }
      if (!_selectedVideoFolder && folders.length === 1 && folders[0].folder) {
        _selectedVideoFolder = folders[0].folder;
      }
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
  const folders = videoLibraryFolders();
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
    ? `<button class="btn btn-s btn-sm" onclick="showVideoLibrarySettingsModal()">Library Settings</button>`
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
                  <span>${escHtml(video.folder || 'Root folder')}</span>
                  <span>${escHtml(videoProgressLabel(video.progress) || (fmtDate ? fmtDate(video.updated_at) : (video.updated_at || '-')))}</span>
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
              <video id="videoLibraryPlayer" class="videos-player" src="${escHtml(selectedVideo?.stream_url || '')}" controls controlslist="nodownload noplaybackrate" preload="metadata" playsinline oncontextmenu="return false">
                ${videoLibrarySubtitleTracks(selectedVideo)}
              </video>
            </div>
            <div class="videos-controls">
              <button id="videoControlPlay" class="videos-control-btn" type="button" onclick="videoPlayerToggle()" title="Play" aria-label="Play">${videoControlIcon('play')}</button>
              <button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoPlayerSeek(-10)" title="Back 10 seconds" aria-label="Back 10 seconds">${videoControlIcon('back')}<span>-10</span></button>
              <button class="videos-control-btn videos-control-btn-seek" type="button" onclick="videoPlayerSeek(10)" title="Forward 10 seconds" aria-label="Forward 10 seconds">${videoControlIcon('forward')}<span>+10</span></button>
              <button id="videoControlMute" class="videos-control-btn" type="button" onclick="videoPlayerMute()" title="Mute" aria-label="Mute">${videoControlIcon('volume')}</button>
              ${(selectedVideo?.subtitles || []).length ? `
                <button id="videoControlSubtitle" class="videos-control-btn videos-control-btn-subtitle" type="button" onclick="videoPlayerSubtitleToggle()" title="Subtitles" aria-label="Subtitles">${videoControlIcon('subtitle')}</button>` : ''}
              <button id="videoControlSpeed" class="videos-control-btn videos-control-btn-speed" type="button" onclick="videoPlayerCycleRate()" title="Playback speed" aria-label="Playback speed">${videoControlIcon('speed')}<span>1x</span></button>
              <button class="videos-control-btn videos-control-btn-primary" type="button" onclick="videoPlayerFullscreen()" title="Fullscreen" aria-label="Fullscreen">${videoControlIcon('fullscreen')}</button>
            </div>
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
  const playBtn = document.getElementById('videoControlPlay');
  const muteBtn = document.getElementById('videoControlMute');
  const subtitleBtn = document.getElementById('videoControlSubtitle');
  const speedBtn = document.getElementById('videoControlSpeed');

  if (playBtn && player) {
    const paused = !!player.paused;
    playBtn.innerHTML = paused ? videoControlIcon('play') : videoControlIcon('pause');
    playBtn.title = paused ? 'Play' : 'Pause';
    playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    playBtn.classList.toggle('active', !paused);
  }

  if (muteBtn && player) {
    const muted = !!player.muted;
    muteBtn.innerHTML = muted ? videoControlIcon('mute') : videoControlIcon('volume');
    muteBtn.title = muted ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    muteBtn.classList.toggle('active', !muted);
  }

  if (subtitleBtn) {
    const subtitleOn = !!_selectedVideoSubtitleId;
    const subtitles = Array.isArray(videoLibrarySelectedVideo()?.subtitles) ? videoLibrarySelectedVideo().subtitles : [];
    const activeSubtitle = subtitles.find((subtitle) => String(subtitle.id) === String(_selectedVideoSubtitleId || ''));
    subtitleBtn.classList.toggle('active', subtitleOn);
    subtitleBtn.title = subtitleOn ? `Subtitles: ${activeSubtitle?.label || 'On'}` : 'Subtitles off';
    subtitleBtn.setAttribute('aria-label', subtitleOn ? `Subtitles ${activeSubtitle?.label || 'on'}` : 'Subtitles off');
  }

  if (speedBtn && player) {
    const rate = Number(player.playbackRate || 1);
    const label = Number.isInteger(rate) ? `${rate}x` : `${rate.toFixed(2).replace(/0$/, '')}x`;
    speedBtn.innerHTML = `${videoControlIcon('speed')}<span>${label}</span>`;
    speedBtn.title = `Playback speed ${label}`;
    speedBtn.setAttribute('aria-label', `Playback speed ${label}`);
  }
}

function videoPlayerToggle() {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  if (player.paused) player.play().catch(() => {});
  else player.pause();
}

function videoPlayerSeek(seconds) {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  player.currentTime = Math.max(0, Number(player.currentTime || 0) + Number(seconds || 0));
}

function videoPlayerMute() {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  player.muted = !player.muted;
}

function videoPlayerRate(value) {
  const player = getVideoLibraryPlayer();
  const rate = Number(value || 1);
  if (!player || !Number.isFinite(rate) || rate <= 0) return;
  player.playbackRate = rate;
}

function videoPlayerCycleRate() {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  const options = [0.75, 1, 1.25, 1.5, 2];
  const current = Number(player.playbackRate || 1);
  const currentIndex = options.findIndex((rate) => Math.abs(rate - current) < 0.01);
  const nextRate = options[(currentIndex + 1 + options.length) % options.length];
  player.playbackRate = nextRate;
  updateVideoControlsUI();
}

function videoPlayerFullscreen() {
  const player = getVideoLibraryPlayer();
  if (!player) return;
  if (typeof player.requestFullscreen === 'function') player.requestFullscreen().catch(() => {});
}

function showVideoLibrarySettingsModal() {
  if (_userRole !== 'admin') {
    toast('Only admins can change video settings.', 'error');
    return;
  }
  const settings = _videoLibraryData?.settings || {};
  openModal('Video Library Settings', `
    <div class="fg">
      <label class="fl full">Library Title
        <input class="fi" id="videoLibraryTitle" value="${escHtml(settings.library_title || 'Video Library')}" placeholder="Video Library">
      </label>
      <label class="fl full">Server Video Folder Path
        <input class="fi" id="videoLibraryPath" value="${escHtml(settings.videos_root_path || '')}" placeholder="e.g. D:\\Videos or /srv/videos">
      </label>
      <label class="fl full" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="videoLibraryRecursive" ${settings.recursive_scan !== false ? 'checked' : ''} style="width:16px;height:16px">
        Scan subfolders recursively
      </label>
      <label class="fl full">Allowed Extensions
        <input class="fi" id="videoLibraryExtensions" value="${escHtml((settings.allowed_extensions || ['.mp4', '.webm', '.ogg', '.mov', '.m4v']).join(', '))}" placeholder=".mp4, .webm, .ogg">
      </label>
      <div style="font-size:12px;color:var(--t3);line-height:1.7">
        Save the folder where video files exist on the server. Users will only see supported video files from this folder in the Videos page.
      </div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="saveVideoLibrarySettings()">Save Settings</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveVideoLibrarySettings() {
  const library_title = document.getElementById('videoLibraryTitle')?.value?.trim() || 'Video Library';
  const videos_root_path = document.getElementById('videoLibraryPath')?.value?.trim() || '';
  const recursive_scan = !!document.getElementById('videoLibraryRecursive')?.checked;
  const allowed_extensions = document.getElementById('videoLibraryExtensions')?.value?.trim() || '.mp4, .webm, .ogg, .mov, .m4v';

  const result = await api('/api/admin/videos/settings', {
    method: 'PUT',
    body: { library_title, videos_root_path, recursive_scan, allowed_extensions },
  });
  if (!result?.success) {
    toast(result?.error || 'Could not save video settings.', 'error');
    return;
  }
  closeModal();
  toast('Video library settings saved', 'success');
  await loadVideosPage();
}

window.loadVideosPage = loadVideosPage;
window.setVideoLibrarySearch = setVideoLibrarySearch;
window.selectVideoLibraryItem = selectVideoLibraryItem;
window.selectVideoLibraryFolder = selectVideoLibraryFolder;
window.videoPlayerToggle = videoPlayerToggle;
window.videoPlayerSeek = videoPlayerSeek;
window.videoPlayerMute = videoPlayerMute;
window.videoPlayerSubtitleToggle = videoPlayerSubtitleToggle;
window.videoPlayerRate = videoPlayerRate;
window.videoPlayerCycleRate = videoPlayerCycleRate;
window.videoPlayerFullscreen = videoPlayerFullscreen;
window.showVideoLibrarySettingsModal = showVideoLibrarySettingsModal;
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
