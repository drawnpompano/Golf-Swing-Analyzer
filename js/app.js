(() => {
  'use strict';

  // ---- DOM refs ----
  const els = {
    headerTitle: document.getElementById('header-title'),
    btnBack: document.getElementById('btn-back'),
    btnInstall: document.getElementById('btn-install'),

    viewLibrary: document.getElementById('view-library'),
    viewRecord: document.getElementById('view-record'),
    viewAnalyzer: document.getElementById('view-analyzer'),

    btnUpload: document.getElementById('btn-upload'),
    btnRecord: document.getElementById('btn-record'),
    fileInput: document.getElementById('file-input'),
    libraryGrid: document.getElementById('library-grid'),
    libraryEmpty: document.getElementById('library-empty'),

    recordPreview: document.getElementById('record-preview'),
    recordTimer: document.getElementById('record-timer'),
    btnRecordToggle: document.getElementById('btn-record-toggle'),
    btnRecordCancel: document.getElementById('btn-record-cancel'),

    videoStage: document.getElementById('video-stage'),
    player: document.getElementById('player'),
    overlay: document.getElementById('overlay'),

    scrubber: document.getElementById('scrubber'),
    timeCurrent: document.getElementById('time-current'),
    timeTotal: document.getElementById('time-total'),

    btnStepBack: document.getElementById('btn-step-back'),
    btnPlay: document.getElementById('btn-play'),
    btnStepFwd: document.getElementById('btn-step-fwd'),
    speedSelect: document.getElementById('speed-select'),
    fpsSelect: document.getElementById('fps-select'),
    btnGuide: document.getElementById('btn-guide'),

    toolBtns: Array.from(document.querySelectorAll('.tool-btn')),
    swatches: Array.from(document.querySelectorAll('.swatch')),
    strokeWidth: document.getElementById('stroke-width'),
    btnUndo: document.getElementById('btn-undo'),
    btnClearFrame: document.getElementById('btn-clear-frame'),

    sessionName: document.getElementById('session-name'),
    btnSnapshot: document.getElementById('btn-snapshot'),
    btnDeleteSession: document.getElementById('btn-delete-session'),

    toast: document.getElementById('toast'),
    confirmDialog: document.getElementById('confirm-dialog'),
    confirmMessage: document.getElementById('confirm-message'),
    confirmCancel: document.getElementById('confirm-cancel'),
    confirmOk: document.getElementById('confirm-ok')
  };

  // ---- State ----
  let currentSession = null;
  let currentVideoURL = null;
  let annotator = null;
  let saveTimer = null;
  let recordStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordSeconds = 0;
  let recordInterval = null;
  let deferredInstallEvent = null;

  // ---- Utilities ----
  function showToast(msg, duration = 2200) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.add('hidden'), duration);
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  function frameIndexForTime(t, fps) {
    return Math.round(t * fps);
  }

  function confirmAction(message) {
    return new Promise((resolve) => {
      els.confirmMessage.textContent = message;
      els.confirmDialog.showModal();
      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };
      function cleanup() {
        els.confirmDialog.close();
        els.confirmOk.removeEventListener('click', onOk);
        els.confirmCancel.removeEventListener('click', onCancel);
      }
      els.confirmOk.addEventListener('click', onOk);
      els.confirmCancel.addEventListener('click', onCancel);
    });
  }

  function generateThumbnail(blob) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      const url = URL.createObjectURL(blob);
      v.src = url;

      const finish = (dataURL) => {
        URL.revokeObjectURL(url);
        resolve(dataURL);
      };

      v.addEventListener('loadedmetadata', () => {
        v.currentTime = Math.min(0.4 * (v.duration || 1), 1);
      });
      v.addEventListener('seeked', () => {
        try {
          const c = document.createElement('canvas');
          const scale = 300 / (v.videoWidth || 300);
          c.width = Math.round((v.videoWidth || 300) * scale);
          c.height = Math.round((v.videoHeight || 300) * scale);
          const ctx = c.getContext('2d');
          ctx.drawImage(v, 0, 0, c.width, c.height);
          finish(c.toDataURL('image/jpeg', 0.75));
        } catch (err) {
          finish(null);
        }
      });
      v.addEventListener('error', () => finish(null));
    });
  }

  // ---- View routing ----
  function showView(name) {
    for (const view of [els.viewLibrary, els.viewRecord, els.viewAnalyzer]) {
      view.classList.remove('active');
    }
    if (name === 'library') {
      els.viewLibrary.classList.add('active');
      els.headerTitle.textContent = 'Swing Analyzer';
      els.btnBack.classList.add('hidden');
    } else if (name === 'record') {
      els.viewRecord.classList.add('active');
      els.headerTitle.textContent = 'Record Swing';
      els.btnBack.classList.remove('hidden');
    } else if (name === 'analyzer') {
      els.viewAnalyzer.classList.add('active');
      els.headerTitle.textContent = 'Analyze Swing';
      els.btnBack.classList.remove('hidden');
    }
  }

  // ---- Library ----
  async function renderLibrary() {
    const sessions = await SwingDB.getAllSessions();
    els.libraryGrid.innerHTML = '';
    els.libraryEmpty.classList.toggle('hidden', sessions.length > 0);

    for (const s of sessions) {
      const li = document.createElement('li');
      li.className = 'session-card';
      li.innerHTML = `
        <img class="thumb" src="${s.thumbnail || ''}" alt="" />
        <div class="meta">
          <div class="name"></div>
          <div class="date">${new Date(s.updatedAt).toLocaleDateString()}</div>
        </div>`;
      li.querySelector('.name').textContent = s.name;
      li.addEventListener('click', () => openSession(s.id));
      els.libraryGrid.appendChild(li);
    }
  }

  // ---- Upload flow ----
  els.btnUpload.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files[0];
    els.fileInput.value = '';
    if (!file) return;
    showToast('Loading video…');
    const thumbnail = await generateThumbnail(file);
    const session = await SwingDB.createSession({
      videoBlob: file,
      thumbnail,
      name: file.name.replace(/\.[^/.]+$/, '')
    });
    openSession(session.id);
  });

  // ---- Record flow ----
  els.btnRecord.addEventListener('click', async () => {
    try {
      recordStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      els.recordPreview.srcObject = recordStream;
      showView('record');
    } catch (err) {
      showToast('Camera unavailable: ' + err.message);
    }
  });

  els.btnRecordCancel.addEventListener('click', () => {
    stopRecordStream();
    showView('library');
  });

  function stopRecordStream() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (recordStream) {
      recordStream.getTracks().forEach((t) => t.stop());
      recordStream = null;
    }
    clearInterval(recordInterval);
    recordInterval = null;
    recordSeconds = 0;
    els.recordTimer.classList.add('hidden');
    els.recordTimer.textContent = '00:00';
    els.btnRecordToggle.textContent = '● Start Recording';
  }

  els.btnRecordToggle.addEventListener('click', () => {
    if (!recordStream) return;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    recordedChunks = [];
    const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    mediaRecorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    });
    mediaRecorder.addEventListener('stop', async () => {
      const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
      stopRecordStream();
      if (blob.size === 0) { showView('library'); return; }
      showToast('Saving recording…');
      const thumbnail = await generateThumbnail(blob);
      const session = await SwingDB.createSession({ videoBlob: blob, thumbnail });
      openSession(session.id);
    });
    mediaRecorder.start();
    recordSeconds = 0;
    els.recordTimer.classList.remove('hidden');
    els.recordTimer.textContent = '00:00';
    els.btnRecordToggle.textContent = '■ Stop Recording';
    recordInterval = setInterval(() => {
      recordSeconds += 1;
      const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
      const s = String(recordSeconds % 60).padStart(2, '0');
      els.recordTimer.textContent = `${m}:${s}`;
    }, 1000);
  });

  // ---- Analyzer ----
  function syncCanvasSize() {
    const rect = els.player.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      annotator.resize(rect.width, rect.height);
      loadAnnotationsForCurrentFrame();
    }
  }

  function loadAnnotationsForCurrentFrame() {
    if (!currentSession) return;
    const idx = frameIndexForTime(els.player.currentTime, currentSession.fps);
    annotator.loadShapes(currentSession.annotations[String(idx)] || []);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!currentSession) return;
      SwingDB.updateSession(currentSession.id, { annotations: currentSession.annotations, fps: currentSession.fps, name: currentSession.name });
    }, 500);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    if (!currentSession) return;
    await SwingDB.updateSession(currentSession.id, { annotations: currentSession.annotations, fps: currentSession.fps, name: currentSession.name });
  }

  function onAnnotationChange(shapes) {
    if (!currentSession) return;
    const idx = frameIndexForTime(els.player.currentTime, currentSession.fps);
    if (shapes.length) currentSession.annotations[String(idx)] = shapes;
    else delete currentSession.annotations[String(idx)];
    scheduleSave();
  }

  async function openSession(id) {
    currentSession = await SwingDB.getSession(id);
    if (!currentSession) { showToast('Could not open swing'); return; }

    if (currentVideoURL) URL.revokeObjectURL(currentVideoURL);
    currentVideoURL = URL.createObjectURL(currentSession.videoBlob);
    els.fpsSelect.value = String(currentSession.fps || 30);
    els.sessionName.value = currentSession.name;
    els.speedSelect.value = '0.5';
    els.player.playbackRate = 0.5;
    setPlayIcon(false);

    showView('analyzer');

    function onMeta() {
      els.player.removeEventListener('loadedmetadata', onMeta);
      els.scrubber.max = String(Math.round((els.player.duration || 0) * 1000));
      els.timeTotal.textContent = formatTime(els.player.duration || 0);
      requestAnimationFrame(() => requestAnimationFrame(syncCanvasSize));
    }
    // Attach before assigning src: a fresh recording's blob can report
    // metadata synchronously, which would otherwise race past a listener
    // attached after src is set.
    els.player.addEventListener('loadedmetadata', onMeta, { once: true });
    els.player.src = currentVideoURL;
    els.player.pause();
    if (els.player.readyState >= 1) onMeta();
  }

  function setPlayIcon(playing) {
    els.btnPlay.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
  }

  els.player.addEventListener('play', () => setPlayIcon(true));
  els.player.addEventListener('pause', () => {
    setPlayIcon(false);
    loadAnnotationsForCurrentFrame();
  });
  els.player.addEventListener('seeked', () => {
    els.scrubber.value = String(Math.round(els.player.currentTime * 1000));
    els.timeCurrent.textContent = formatTime(els.player.currentTime);
    if (els.player.paused) loadAnnotationsForCurrentFrame();
  });
  els.player.addEventListener('timeupdate', () => {
    if (!els.player.seeking) {
      els.scrubber.value = String(Math.round(els.player.currentTime * 1000));
      els.timeCurrent.textContent = formatTime(els.player.currentTime);
    }
  });

  els.btnPlay.addEventListener('click', () => {
    if (els.player.paused) els.player.play();
    else els.player.pause();
  });

  function stepFrame(direction) {
    els.player.pause();
    const fps = Number(els.fpsSelect.value) || 30;
    const step = 1 / fps;
    const next = Math.min(Math.max(els.player.currentTime + direction * step, 0), els.player.duration || 0);
    els.player.currentTime = next;
  }
  els.btnStepBack.addEventListener('click', () => stepFrame(-1));
  els.btnStepFwd.addEventListener('click', () => stepFrame(1));

  els.scrubber.addEventListener('input', () => {
    els.player.pause();
    els.player.currentTime = Number(els.scrubber.value) / 1000;
  });

  els.speedSelect.addEventListener('change', () => {
    els.player.playbackRate = Number(els.speedSelect.value);
  });

  els.fpsSelect.addEventListener('change', () => {
    if (!currentSession) return;
    currentSession.fps = Number(els.fpsSelect.value);
    scheduleSave();
    loadAnnotationsForCurrentFrame();
  });

  els.btnGuide.addEventListener('click', () => {
    const active = els.btnGuide.classList.toggle('active');
    annotator.setGuideVisible(active);
  });

  els.toolBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      els.toolBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      annotator.setTool(btn.dataset.tool);
      if (btn.dataset.tool === 'angle') {
        showToast('Drag one line from the joint, lift, then drag the second line from the same joint');
      }
    });
  });

  els.swatches.forEach((btn) => {
    btn.addEventListener('click', () => {
      els.swatches.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      annotator.setColor(btn.dataset.color);
    });
  });

  els.strokeWidth.addEventListener('input', () => annotator.setStrokeWidth(els.strokeWidth.value));

  els.btnUndo.addEventListener('click', () => annotator.undo());
  els.btnClearFrame.addEventListener('click', () => annotator.clear());

  els.sessionName.addEventListener('change', () => {
    if (!currentSession) return;
    currentSession.name = els.sessionName.value.trim() || currentSession.name;
    flushSave();
  });

  els.btnSnapshot.addEventListener('click', () => {
    const vw = els.player.videoWidth, vh = els.player.videoHeight;
    if (!vw || !vh) { showToast('Video not ready'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(els.player, 0, 0, vw, vh);
    const rect = els.player.getBoundingClientRect();
    const scale = rect.width ? vw / rect.width : 1;
    annotator.renderToContext(ctx, scale);
    canvas.toBlob((blob) => {
      if (!blob) { showToast('Export failed'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (currentSession?.name || 'swing').replace(/[^a-z0-9\-_]+/gi, '_');
      a.download = `${safeName}_${formatTime(els.player.currentTime).replace(/[:.]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('Snapshot saved');
    }, 'image/png');
  });

  els.btnDeleteSession.addEventListener('click', async () => {
    if (!currentSession) return;
    const ok = await confirmAction(`Delete "${currentSession.name}"? This cannot be undone.`);
    if (!ok) return;
    await SwingDB.deleteSession(currentSession.id);
    currentSession = null;
    showView('library');
    renderLibrary();
  });

  els.btnBack.addEventListener('click', async () => {
    if (!els.viewRecord.classList.contains('active')) {
      stopRecordStream();
    }
    if (els.viewAnalyzer.classList.contains('active')) {
      els.player.pause();
      await flushSave();
    }
    currentSession = null;
    showView('library');
    renderLibrary();
  });

  window.addEventListener('resize', () => {
    if (els.viewAnalyzer.classList.contains('active')) syncCanvasSize();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSave();
  });

  // ---- Install prompt ----
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallEvent = e;
    els.btnInstall.classList.remove('hidden');
  });
  els.btnInstall.addEventListener('click', async () => {
    if (!deferredInstallEvent) return;
    deferredInstallEvent.prompt();
    await deferredInstallEvent.userChoice;
    deferredInstallEvent = null;
    els.btnInstall.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => els.btnInstall.classList.add('hidden'));

  // ---- Init ----
  function init() {
    annotator = new AnnotationCanvas(els.overlay, { onChange: onAnnotationChange });
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
    showView('library');
    renderLibrary();
  }

  init();
})();
