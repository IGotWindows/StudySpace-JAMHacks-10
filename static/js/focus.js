import {
  createFaceDetector,
  FocusTracker,
  FOCUS_THRESHOLD,
  DEFAULT_VIDEO_W,
  DEFAULT_VIDEO_H,
  parseBoundingBox,
  toCanvasRect,
} from './focus-tracker.mjs';

let faceDetector;
let video;
let canvas;
let ctx;
let animationId;
let hiddenIntervalId = null;
let statsLoopRunning = false;
const tracker = new FocusTracker();

let sessionActive = false;
let sessionStartedAt = null;
let focusedSeconds = 0;
let isInFocusZone = false;
let countdownMode = false;
let countdownTotal = 0; // seconds
let countdownRemaining = 0; // seconds
let sessionIntervalId = null;

function getVideoSize() {
  return {
    vw: video?.videoWidth || DEFAULT_VIDEO_W,
    vh: video?.videoHeight || DEFAULT_VIDEO_H,
  };
}

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function drawDetections(detections, engagedFace, focusScore) {
  if (!ctx || !canvas || !video) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { vw, vh } = getVideoSize();
  const score = focusScore ?? tracker.currentFocusScore;

  for (const det of detections) {
    const bb = parseBoundingBox(det);
    const rect = toCanvasRect(bb, vw, vh, canvas.width, canvas.height);
    if (!rect) continue;

    ctx.strokeStyle = engagedFace ? '#4ade80' : '#fbbf24';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    const label = `${score}`;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = score >= FOCUS_THRESHOLD ? '#4ade80' : '#fbbf24';
    ctx.fillText(label, rect.x + 4, rect.y > 16 ? rect.y - 4 : rect.y + 14);

    const kps = det.keypoints || det.landmarks || [];
    for (const kp of kps) {
      const rawX = kp.x ?? kp.px ?? 0;
      const rawY = kp.y ?? kp.py ?? 0;
      const kx = rawX <= 1 ? rawX * canvas.width : (rawX / vw) * canvas.width;
      const ky = rawY <= 1 ? rawY * canvas.height : (rawY / vh) * canvas.height;
      ctx.beginPath();
      ctx.arc(kx, ky, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#f472b6';
      ctx.fill();
    }
  }
}

async function startCamera() {
  video = document.getElementById('cam');
  canvas = document.getElementById('overlay');
  if (!video || !canvas) return;
  if (video.srcObject) return;

  ctx = canvas.getContext('2d');

  if (!faceDetector) {
    setStatus('Loading face detector…');
    try {
      faceDetector = await createFaceDetector();
    } catch (err) {
      setStatus('Failed to load face detector');
      console.error(err);
      return;
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: DEFAULT_VIDEO_W, height: DEFAULT_VIDEO_H },
    });
    video.srcObject = stream;
    setStatus('Camera on – face detection active');
    video.onloadedmetadata = () => {
      video.play();
      canvas.width = video.videoWidth || DEFAULT_VIDEO_W;
      canvas.height = video.videoHeight || DEFAULT_VIDEO_H;
      tracker.lastTimestamp = performance.now();
      detectLoop();
      statsUpdateLoop();
      syncHiddenTrackingInterval();
        // If a fallback session interval was running while camera was off, stop it
        if (sessionIntervalId) {
          clearInterval(sessionIntervalId);
          sessionIntervalId = null;
        }
    };
  } catch (err) {
    setStatus('Camera permission denied');
    console.error(err);
  }
}

function syncHiddenTrackingInterval() {
  const shouldRunHidden = document.hidden && video?.srcObject;
  if (shouldRunHidden && !hiddenIntervalId) {
    hiddenIntervalId = window.setInterval(runDetectionTick, 250);
  } else if (!shouldRunHidden && hiddenIntervalId) {
    clearInterval(hiddenIntervalId);
    hiddenIntervalId = null;
  }
}

async function runDetectionTick() {
  if (!video || !faceDetector || !video.srcObject) return;

  const now = performance.now();
  let frame = { dt: 0, hadFace: false, frameEngaged: false, focusScore: 0, hint: '', detections: [] };

  try {
    const results = await faceDetector.detectForVideo(video, now);
    const detections = results?.detections ?? [];
    const { vw, vh } = getVideoSize();
    frame = tracker.analyzeFrame(detections, vw, vh, now);

    if (detections.length > 0) {
      drawDetections(detections, frame.frameEngaged, frame.focusScore);
    } else if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  } catch (err) {
    console.error('detection error', err);
    return;
  }

  if (frame.hadFace) {
    setStatus(frame.frameEngaged ? 'Locked in — facing the screen' : frame.hint);
  } else {
    setStatus('No face detected – stay focused!');
  }

  tickFocusedSession(frame.dt);
}

async function detectLoop() {
  if (!video || !faceDetector || !video.srcObject) return;

  if (document.hidden && hiddenIntervalId) {
    animationId = requestAnimationFrame(detectLoop);
    return;
  }

  await runDetectionTick();
  animationId = requestAnimationFrame(detectLoop);
}

function tickFocusedSession(dt) {
  if (!sessionActive) return;

  // Always decrement countdown remaining while session active (if in countdown mode)
  if (countdownMode && countdownRemaining > 0) {
    countdownRemaining = Math.max(0, countdownRemaining - dt);
  }

  // Track focused time only when focus score is above threshold
  if (tracker.currentFocusScore > FOCUS_THRESHOLD) {
    focusedSeconds += dt;
    isInFocusZone = true;
  } else {
    isInFocusZone = false;
  }

  // If countdown finished, end session and show percent result
  if (countdownMode && countdownRemaining === 0 && countdownTotal > 0) {
    sessionActive = false;
    saveCompletedSession(focusedSeconds);
    updateSessionButtons();
    const pct = Math.min(100, Math.round((focusedSeconds / countdownTotal) * 100));
    const pctEl = document.getElementById('countdown-percent');
    const resultWrap = document.getElementById('countdown-result');
    if (pctEl) pctEl.textContent = `${isFinite(pct) ? pct : 0}%`;
    if (resultWrap) resultWrap.style.display = 'block';
    if (sessionIntervalId) {
      clearInterval(sessionIntervalId);
      sessionIntervalId = null;
    }
  }

  updateTimerDisplay();
  updateTimerStatus();
  syncSessionToStorage();
}

function statsUpdateLoop() {
  if (statsLoopRunning) return;
  statsLoopRunning = true;

  const elLooking = document.getElementById('stat-looking');
  const elFaceSeconds = document.getElementById('stat-face-seconds');
  const elFaceSize = document.getElementById('stat-face-size');
  const elMovement = document.getElementById('stat-movement');
  const elFocus = document.getElementById('stat-focus-score');

  const update = () => {
    if (elFaceSeconds) elFaceSeconds.textContent = `${Math.round(tracker.facePresentTime)}s`;
    if (elFaceSize) {
      const sizePct = Math.min(100, Math.round((tracker.faceSizeEMA || 0) * 100));
      elFaceSize.textContent = `${sizePct}%`;
    }
    if (elMovement) elMovement.textContent = `${Number((tracker.movementEMA || 0).toFixed(3))}`;
    if (elLooking) {
      const { engaged } = tracker.getWindowStats();
      if (!tracker.hasRecentFace()) {
        elLooking.textContent = '—';
      } else if (tracker.currentFrameEngaged) {
        elLooking.textContent = 'Yes';
      } else {
        elLooking.textContent = engaged >= 0.45 ? 'Mostly' : 'No';
      }
    }
    if (elFocus) {
      elFocus.textContent = `${tracker.computeFocusScore()}`;
    }
    if (sessionActive) {
      updateTimerDisplay();
      syncSessionToStorage();
      if (!video?.srcObject) {
        tickFocusedSession(0);
      }
    }
    setTimeout(update, 500);
  };
  update();
}

function closeCamera() {
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  if (animationId) cancelAnimationFrame(animationId);
  if (hiddenIntervalId) {
    clearInterval(hiddenIntervalId);
    hiddenIntervalId = null;
  }
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  setStatus('Camera off');
  tracker.reset();
  statsLoopRunning = false;
}

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function syncSessionToStorage() {
  const api = window.StudiousFocusSession;
  if (!api) return;
  api.sync(sessionActive, sessionStartedAt, focusedSeconds, isInFocusZone);
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function saveCompletedSession(focusedSecs) {
  if (focusedSecs < 30) return; // ignore accidental taps
  try {
    const DATA_KEY = 'studywell_data';
    const today = todayDateStr();
    const durationMins = Math.max(1, Math.round(focusedSecs / 60));
    let data;
    try { data = JSON.parse(localStorage.getItem(DATA_KEY) || 'null'); } catch (_) { data = null; }
    if (!data || typeof data !== 'object') data = { sessions: [], daily_logs: [] };
    if (!Array.isArray(data.sessions)) data.sessions = [];
    if (!Array.isArray(data.daily_logs)) data.daily_logs = [];

    data.sessions.push({ date: today, duration_minutes: durationMins, completed: true });

    const todayCount = data.sessions.filter(s => s.date === today && s.completed).length;
    const logIdx = data.daily_logs.findIndex(l => l.date === today);
    if (logIdx >= 0) {
      data.daily_logs[logIdx].sessions_count = todayCount;
    } else {
      data.daily_logs.push({ date: today, water_glasses: 0, sleep_hours: 0, mood: 3, sessions_count: todayCount });
    }

    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent('studious-session-saved'));
  } catch (_) {}
}

function getElapsedSeconds() {
  if (!sessionActive || sessionStartedAt == null) return 0;
  return (Date.now() - sessionStartedAt) / 1000;
}

function startTimer() {
  if (sessionActive) return;
  // read mode and countdown inputs
  const modeEl = document.getElementById('focus-mode');
  const minEl = document.getElementById('countdown-min');
  const secEl = document.getElementById('countdown-sec');
  countdownMode = modeEl?.value === 'countdown';
  if (countdownMode) {
    const mins = Number(minEl?.value || 0);
    const secs = Number(secEl?.value || 0);
    countdownTotal = Math.max(0, Math.floor(mins * 60 + secs));
    countdownRemaining = countdownTotal;
    const resultWrap = document.getElementById('countdown-result');
    if (resultWrap) resultWrap.style.display = 'none';
    // reset focused time for this countdown
    focusedSeconds = 0;
  } else {
    countdownTotal = 0;
    countdownRemaining = 0;
  }

  sessionActive = true;
  sessionStartedAt = Date.now();
  syncSessionToStorage();
  updateTimerDisplay();
  updateTimerStatus();
  updateSessionButtons();
  window.StudiousFocusSession?.refreshBackgroundTracking?.();
    // If camera/detection isn't running, start a small fallback interval so countdown still decrements
    if (!video || !video.srcObject) {
      if (!sessionIntervalId) {
        sessionIntervalId = setInterval(() => {
          // tick in quarter-second increments
          tickFocusedSession(0.25);
        }, 250);
      }
    }
}

function endSession() {
  saveCompletedSession(focusedSeconds);
  sessionActive = false;
  sessionStartedAt = null;
  focusedSeconds = 0;
  isInFocusZone = false;
  countdownMode = false;
  countdownTotal = 0;
  countdownRemaining = 0;
  const resultWrap = document.getElementById('countdown-result');
  if (resultWrap) resultWrap.style.display = 'none';
  if (sessionIntervalId) { clearInterval(sessionIntervalId); sessionIntervalId = null; }
  syncSessionToStorage();
  updateTimerDisplay();
  updateTimerStatus();
  updateSessionButtons();
  window.StudiousFocusSession?.refreshBackgroundTracking?.();
}

function resetTimer() {
  sessionActive = false;
  sessionStartedAt = null;
  focusedSeconds = 0;
  isInFocusZone = false;
  countdownMode = false;
  countdownTotal = 0;
  countdownRemaining = 0;
  const resultWrap = document.getElementById('countdown-result');
  if (resultWrap) resultWrap.style.display = 'none';
    if (sessionIntervalId) {
      clearInterval(sessionIntervalId);
      sessionIntervalId = null;
    }
  syncSessionToStorage();
  updateTimerDisplay();
  updateTimerStatus();
  updateSessionButtons();
  window.StudiousFocusSession?.refreshBackgroundTracking?.();
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  if (el) {
    // Left (big) timer: show focused time (pausable)
    el.textContent = formatTime(focusedSeconds);
    el.classList.toggle('focus-timer-active', sessionActive && isInFocusZone);
    el.classList.toggle('focus-timer-paused', sessionActive && !isInFocusZone);
  }

  const elapsedEl = document.getElementById('elapsed-timer');
  if (elapsedEl) {
    // Right (small) timer: show countdown remaining when in countdown mode, otherwise show elapsed session time
    if (countdownMode) {
      elapsedEl.textContent = formatTime(countdownRemaining);
    } else {
      elapsedEl.textContent = formatTime(getElapsedSeconds());
    }
    elapsedEl.classList.toggle('focus-elapsed-active', sessionActive);
  }
}

function updateTimerStatus() {
  const el = document.getElementById('timer-status');
  if (!el) return;

  if (!sessionActive) {
    el.textContent = 'Turn on your webcam, then press Start.';
    return;
  }

  if (!video?.srcObject) {
    el.textContent = 'Camera is off — turn it on to earn focused time.';
    return;
  }

  if (isInFocusZone) {
    el.textContent = `Focused — score ${tracker.currentFocusScore} (above ${FOCUS_THRESHOLD}).`;
    return;
  }

  el.textContent = `Paused — score ${tracker.currentFocusScore}. Stay on screen to go above ${FOCUS_THRESHOLD}.`;
}

function updateSessionButtons() {
  const startBtn = document.getElementById('btn-start');
  const endBtn   = document.getElementById('btn-end');
  if (startBtn) startBtn.classList.toggle('hidden', sessionActive);
  if (endBtn)   endBtn.classList.toggle('hidden', !sessionActive);
}

window.startCamera = startCamera;
window.closeCamera = closeCamera;
window.startTimer  = startTimer;
window.resetTimer  = resetTimer;
window.endSession  = endSession;

document.addEventListener('visibilitychange', syncHiddenTrackingInterval);

document.addEventListener('DOMContentLoaded', async () => {
  const saved = window.StudiousFocusSession?.load();
  if (saved?.active && saved.sessionStartedAt) {
    sessionActive = true;
    sessionStartedAt = saved.sessionStartedAt;
    focusedSeconds = saved.focusedSeconds || 0;
    isInFocusZone = false;
  }
  updateTimerDisplay();
  updateTimerStatus();
  updateSessionButtons();

  if (sessionActive) {
    window.StudiousFocusSession?.refreshBackgroundTracking?.();
    await startCamera();
  }
});
