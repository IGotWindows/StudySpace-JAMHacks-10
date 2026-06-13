'use strict';

var Health = (function () {

  var STORE_SLEEP = 'health_sleep';
  var STORE_WATER = 'health_water';
  var STORE_MOOD  = 'health_mood';
  var STORE_TIPS  = 'health_tips';
  var TIPS_TTL    = 6 * 60 * 60 * 1000;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }

  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function el(id) { return document.getElementById(id); }

  function timeToMins(t) {
    var parts = (t || '00:00').split(':').map(Number);
    return parts[0] * 60 + (parts[1] || 0);
  }

  function mins12(m) {
    m = ((m % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mn = m % 60;
    var ampm = h < 12 ? 'AM' : 'PM';
    return (h % 12 || 12) + ':' + String(mn).padStart(2, '0') + ' ' + ampm;
  }

  // ── Toast ────────────────────────────────────────────────────────────────

  function toast(msg, type) {
    var t = el('health-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'health-toast ' + (type || 'info');
    t.classList.remove('hidden');
    clearTimeout(t._tmr);
    t._tmr = setTimeout(function () { t.classList.add('hidden'); }, 3500);
  }

  // ── Card toggle ──────────────────────────────────────────────────────────

  function toggleCard(cardId) {
    var card = el(cardId);
    if (!card) return;
    var btn  = card.querySelector('.health-card-toggle');
    var body = card.querySelector('.health-card-body');
    var chev = card.querySelector('.card-chevron');
    var expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    body.classList.toggle('hidden', expanded);
    if (chev) chev.textContent = expanded ? '▸' : '▾';
    // Lazy-load tips when tips card opens
    if (!expanded && cardId === 'tips-card') refreshTips(false);
  }

  // ── Sleep module ─────────────────────────────────────────────────────────

  function getSleepLogs() { return load(STORE_SLEEP, []); }

  function getTodaySleep() {
    var logs = getSleepLogs();
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].date === todayStr()) return logs[i];
    }
    return null;
  }

  function logSleep() {
    var bedInput  = el('sleep-bedtime-input');
    var wakeInput = el('sleep-wakeup-input');
    if (!bedInput || !wakeInput || !bedInput.value || !wakeInput.value) {
      toast('Please enter both bedtime and wake-up time.', 'warn'); return;
    }
    var bedMins  = timeToMins(bedInput.value);
    var wakeMins = timeToMins(wakeInput.value);
    if (wakeMins <= bedMins) wakeMins += 1440;
    var hours = Math.round((wakeMins - bedMins) / 6) / 10;

    var logs = getSleepLogs().filter(function (l) { return l.date !== todayStr(); });
    logs.push({ date: todayStr(), bedtime: bedInput.value, wakeup: wakeInput.value, hours: hours });
    save(STORE_SLEEP, logs.slice(-30));

    syncDashboard();
    renderSleep();
    toast('Logged ' + hours + 'h of sleep ✓', 'success');
  }

  function calcSleepDebt() {
    var goalInp = el('sleep-goal-input');
    var goal = parseFloat(goalInp ? goalInp.value : 8) || 8;
    var logs = getSleepLogs();
    var last7 = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var ds = d.toISOString().slice(0, 10);
      var log = null;
      for (var j = 0; j < logs.length; j++) { if (logs[j].date === ds) { log = logs[j]; break; } }
      last7.push(log ? log.hours : null);
    }
    var debt = 0;
    for (var k = 0; k < last7.length; k++) {
      if (last7[k] !== null) debt += Math.max(0, goal - last7[k]);
    }
    return { debt: Math.round(debt * 10) / 10, last7: last7, goal: goal };
  }

  function updateBedtimeTarget() {
    var wakeInp = el('sleep-target-wake');
    var goalInp = el('sleep-goal-input');
    var disp    = el('bedtime-target-display');
    if (!wakeInp || !goalInp || !disp) return;
    var wakeMins = timeToMins(wakeInp.value || '07:00');
    var goal     = parseFloat(goalInp.value) || 8;
    disp.textContent = mins12(wakeMins - goal * 60);
  }

  function scheduleBedtimeReminder() {
    if (!('Notification' in window)) { toast('Notifications not supported in this browser.', 'warn'); return; }
    var goal    = parseFloat((el('sleep-goal-input') || {}).value) || 8;
    var wakeStr = (el('sleep-target-wake') || {}).value || '07:00';
    var bedMins = ((timeToMins(wakeStr) - goal * 60) + 1440) % 1440;
    var bedLabel = mins12(bedMins);

    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('Enable notifications to get reminders.', 'warn'); return; }
      var now    = new Date();
      var target = new Date(now);
      target.setHours(Math.floor(bedMins / 60), bedMins % 60, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      setTimeout(function () {
        new Notification('🌙 Bedtime Reminder', {
          body: 'Time to wind down! Aim for ' + goal + 'h of sleep tonight.',
          icon: '/static/img/camera.svg',
        });
      }, target - now);
      var btn = el('sleep-notify-btn');
      if (btn) btn.textContent = '✓ Reminder set for ' + bedLabel;
      toast('Bedtime reminder set for ' + bedLabel, 'success');
    });
  }

  function drawSleepChart() {
    var canvas = el('sleep-chart');
    if (!canvas || !canvas.getContext) return;
    var sd = calcSleepDebt();
    var last7 = sd.last7, goal = sd.goal;
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    var DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    var dayLabels = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var dow = d.getDay();
      dayLabels.push(DAYS[dow === 0 ? 6 : dow - 1]);
    }

    var pad = { l: 28, r: 8, t: 12, b: 24 };
    var cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var maxH = Math.max(goal + 2, 10);
    var slotW = cw / 7;
    var barW  = Math.floor(slotW * 0.65);

    // Goal dashed line
    var goalY = pad.t + ch - (goal / maxH) * ch;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(176,181,208,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, goalY);
    ctx.lineTo(W - pad.r, goalY);
    ctx.stroke();
    ctx.restore();

    for (var i = 0; i < 7; i++) {
      var h = last7[i];
      var x = pad.l + i * slotW + (slotW - barW) / 2;
      var barH = h !== null ? Math.max(4, (h / maxH) * ch) : 4;
      var y = pad.t + ch - barH;

      ctx.fillStyle = h !== null
        ? (h >= goal ? 'rgba(77,208,225,0.82)' : 'rgba(155,109,255,0.65)')
        : 'rgba(107,112,153,0.2)';

      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, 3);
      else ctx.rect(x, y, barW, barH);
      ctx.fill();

      ctx.fillStyle = 'rgba(176,181,208,0.65)';
      ctx.font = '10px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(dayLabels[i], x + barW / 2, H - 5);

      if (h !== null) {
        ctx.fillStyle = 'rgba(245,247,255,0.75)';
        ctx.font = '9px Lexend, sans-serif';
        ctx.fillText(h + 'h', x + barW / 2, y - 3);
      }
    }

    ctx.fillStyle = 'rgba(176,181,208,0.55)';
    ctx.font = '9px Lexend, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(goal + 'h', pad.l - 3, goalY + 3);
  }

  function renderSleep() {
    var log  = getTodaySleep();
    var sd   = calcSleepDebt();

    var summEl = el('sleep-card-summary');
    if (summEl) summEl.textContent = log ? log.hours + 'h last night' : 'Not logged yet';

    var debtEl = el('sleep-debt-val');
    if (debtEl) {
      debtEl.textContent = sd.debt + 'h';
      debtEl.style.color = sd.debt > 3 ? 'var(--space-coral)' : sd.debt > 1 ? 'var(--space-gold)' : 'var(--space-cyan)';
    }

    var glance = el('glance-sleep-val');
    if (glance) glance.textContent = log ? log.hours + 'h' : '—';

    updateBedtimeTarget();
    drawSleepChart();
  }

  // ── Water module ─────────────────────────────────────────────────────────

  function getWaterData() {
    var d = load(STORE_WATER, {});
    if (d.date !== todayStr()) return { date: todayStr(), glasses: 0, goal: d.goal || 8 };
    return d;
  }

  function addWater(delta) {
    var data = getWaterData();
    data.glasses = Math.max(0, Math.min(data.goal + 4, data.glasses + delta));
    save(STORE_WATER, data);
    syncDashboard();
    renderWater();
    if (delta > 0 && data.glasses === data.goal) toast('🎉 Daily water goal reached!', 'success');
  }

  function setWaterGoal(val) {
    var goal = Math.max(4, Math.min(20, parseInt(val, 10) || 8));
    var data = getWaterData();
    data.goal = goal;
    save(STORE_WATER, data);
    renderWater();
  }

  function scheduleWaterReminder() {
    if (!('Notification' in window)) { toast('Notifications not supported.', 'warn'); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('Enable notifications in browser settings.', 'warn'); return; }
      var count = 0;
      var interval = 90 * 60 * 1000;
      function schedNext() {
        setTimeout(function () {
          if (new Date().getHours() < 21) {
            var data = getWaterData();
            if (data.glasses < data.goal) {
              new Notification('💧 Water Reminder', {
                body: "You've had " + data.glasses + '/' + data.goal + ' glasses. Time to hydrate!',
                icon: '/static/img/camera.svg',
              });
            }
          }
          if (++count < 8) schedNext();
        }, interval);
      }
      schedNext();
      var btn = el('water-notify-btn');
      if (btn) btn.textContent = '✓ Reminders on (every 90 min)';
      toast('Water reminders set every 90 minutes 💧', 'success');
    });
  }

  function renderWater() {
    var data = getWaterData();
    var glasses = data.glasses, goal = data.goal;
    var pct = Math.min(1, glasses / goal);
    var circumference = 314;

    var ring = el('water-ring-fill');
    if (ring) ring.style.strokeDashoffset = (circumference * (1 - pct)).toFixed(1);

    var cnt = el('water-count'); if (cnt) cnt.textContent = glasses;
    var den = el('water-denom'); if (den) den.textContent = '/' + goal;

    var goalInp = el('water-goal-input');
    if (goalInp && String(goalInp.value) !== String(goal)) goalInp.value = goal;

    var row = el('water-glasses-row');
    if (row) {
      row.innerHTML = '';
      var show = Math.min(goal, 12);
      for (var i = 0; i < show; i++) {
        var g = document.createElement('div');
        g.className = 'water-glass ' + (i < glasses ? 'water-glass-full' : 'water-glass-empty');
        g.setAttribute('aria-label', 'Glass ' + (i + 1) + (i < glasses ? ' (drunk)' : ''));
        row.appendChild(g);
      }
    }

    var paceEl = el('water-pace');
    if (paceEl) {
      var hour = new Date().getHours();
      var targetByNow = Math.ceil((hour / 21) * goal);
      if (glasses >= goal) paceEl.textContent = '✓ Daily goal reached!';
      else if (glasses >= targetByNow) paceEl.textContent = 'Great pace — keep it up!';
      else if (glasses < targetByNow - 1) paceEl.textContent = 'A bit behind — try to catch up!';
      else paceEl.textContent = 'On track for today.';
    }

    var summ = el('water-card-summary'); if (summ) summ.textContent = glasses + ' / ' + goal + ' glasses';
    var glance = el('glance-water-val'); if (glance) glance.textContent = glasses + '/' + goal;
  }

  // ── Mood module ──────────────────────────────────────────────────────────

  var MOOD_EMOJIS = {
    happy: '😄', content: '🙂', neutral: '😐',
    stressed: '😰', anxious: '😟', tired: '😴', overwhelmed: '😵',
  };

  var _moodQs = [], _moodAnswers = [], _moodQIdx = 0;

  function startMoodCheckin() {
    el('mood-start-btn').style.display = 'none';
    var msgs = el('mood-chat-messages');
    msgs.innerHTML = '';
    _moodQs = []; _moodAnswers = []; _moodQIdx = 0;

    addBotMsg('Fetching your check-in questions…');

    var stats = buildHealthData();
    fetch('/api/wellness/mood-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stats: stats }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _moodQs = data.questions || ['How are you feeling?', "How's your energy today?", 'Anything stressing you out?'];
        msgs.innerHTML = '';
        askMoodQ(0);
      })
      .catch(function () {
        _moodQs = ['How are you feeling right now?', "How's your energy and focus today?", 'Anything stressing you out lately?'];
        msgs.innerHTML = '';
        askMoodQ(0);
      });
  }

  function askMoodQ(idx) {
    if (idx >= _moodQs.length) { submitMoodAnswers(); return; }
    _moodQIdx = idx;
    addBotMsg(_moodQs[idx]);
    var inputRow = el('mood-chat-input-row');
    if (inputRow) inputRow.style.display = 'flex';
    var inp = el('mood-chat-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }

  function sendMoodAnswer() {
    var inp = el('mood-chat-input');
    var answer = (inp ? inp.value : '').trim();
    if (!answer) return;
    if (inp) inp.value = '';
    addUserMsg(answer);
    _moodAnswers.push({ question: _moodQs[_moodQIdx], answer: answer });
    askMoodQ(_moodQIdx + 1);
  }

  function submitMoodAnswers() {
    var inputRow = el('mood-chat-input-row');
    if (inputRow) inputRow.style.display = 'none';
    addBotMsg('Analyzing your responses…');

    fetch('/api/wellness/mood-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qa: _moodAnswers }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) { showMoodResult(data); })
      .catch(function () { showMoodResult({ mood: 'neutral', score: 5, summary: 'Doing okay today.' }); });
  }

  function showMoodResult(data) {
    var mood    = data.mood || 'neutral';
    var score   = typeof data.score === 'number' ? data.score : 5;
    var summary = data.summary || '';

    save(STORE_MOOD, { date: todayStr(), mood: mood, score: score, summary: summary });
    syncDashboard();

    var chatEl   = el('mood-chat');
    var resultEl = el('mood-result');
    if (chatEl)   chatEl.classList.add('hidden');
    if (resultEl) resultEl.classList.remove('hidden');

    var emojiEl = el('mood-result-emoji'); if (emojiEl) emojiEl.textContent = MOOD_EMOJIS[mood] || '😐';
    var labelEl = el('mood-result-label'); if (labelEl) labelEl.textContent = mood.charAt(0).toUpperCase() + mood.slice(1);
    var summEl  = el('mood-result-summary'); if (summEl) summEl.textContent = summary;

    var bar = el('mood-score-bar');
    if (bar) {
      bar.style.width = (score * 10) + '%';
      bar.style.background = score >= 7 ? 'var(--space-cyan)' : score >= 4 ? 'var(--space-gold)' : 'var(--space-coral)';
    }

    var glance = el('glance-mood-val'); if (glance) glance.textContent = MOOD_EMOJIS[mood] || '😐';
    var summ   = el('mood-card-summary'); if (summ) summ.textContent = (MOOD_EMOJIS[mood] || '😐') + ' ' + mood;
  }

  function resetMood() {
    var chatEl   = el('mood-chat');
    var resultEl = el('mood-result');
    var startBtn = el('mood-start-btn');
    var inputRow = el('mood-chat-input-row');
    var msgs     = el('mood-chat-messages');

    if (chatEl)   chatEl.classList.remove('hidden');
    if (resultEl) resultEl.classList.add('hidden');
    if (startBtn) startBtn.style.display = '';
    if (inputRow) inputRow.style.display = 'none';
    if (msgs) {
      msgs.innerHTML = '';
      addBotMsg("Hey! Let's do a quick check-in. Press Start to begin.");
    }
  }

  function addBotMsg(text) {
    var msgs = el('mood-chat-messages');
    if (!msgs) return;
    var div = document.createElement('div');
    div.className = 'mood-msg mood-msg-bot';
    div.innerHTML = '<span class="mood-bot-avatar">✨</span><span class="mood-msg-text">' + escapeHtml(text) + '</span>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addUserMsg(text) {
    var msgs = el('mood-chat-messages');
    if (!msgs) return;
    var div = document.createElement('div');
    div.className = 'mood-msg mood-msg-user';
    div.innerHTML = '<span class="mood-msg-text">' + escapeHtml(text) + '</span>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMood() {
    var data = load(STORE_MOOD, null);
    if (!data || data.date !== todayStr()) return;
    var glance = el('glance-mood-val'); if (glance) glance.textContent = MOOD_EMOJIS[data.mood] || '😐';
    var summ   = el('mood-card-summary'); if (summ) summ.textContent = (MOOD_EMOJIS[data.mood] || '😐') + ' ' + data.mood;
  }

  // ── Tips module ──────────────────────────────────────────────────────────

  var URGENCY_COLORS = { high: 'var(--space-coral)', medium: 'var(--space-gold)', low: 'var(--space-cyan)' };

  function buildHealthData() {
    var sleepLog  = getTodaySleep();
    var waterData = getWaterData();
    var moodData  = load(STORE_MOOD, null);
    var sd        = calcSleepDebt();
    var goalInp   = el('sleep-goal-input');
    var goal      = parseFloat(goalInp ? goalInp.value : 8) || 8;

    var studyHours = 0, pomodoroCount = 0;
    try {
      var sw = JSON.parse(localStorage.getItem('studywell_data') || '{}');
      var todayLog = null;
      var logs = sw.daily_logs || [];
      for (var i = 0; i < logs.length; i++) { if (logs[i].date === todayStr()) { todayLog = logs[i]; break; } }
      if (todayLog) {
        studyHours   = Math.round((todayLog.study_minutes || 0) / 60 * 10) / 10;
        pomodoroCount = todayLog.sessions_count || 0;
      }
    } catch (e) {}

    return {
      studyHours:    studyHours,
      pomodoroCount: pomodoroCount,
      longestSession: 0,
      sleepHours:    sleepLog ? sleepLog.hours : null,
      sleepTarget:   goal,
      sleepDebt:     sd.debt,
      waterGlasses:  waterData.glasses,
      waterGoal:     waterData.goal,
      mood:          moodData && moodData.date === todayStr() ? moodData.mood : null,
      moodScore:     moodData && moodData.date === todayStr() ? moodData.score : null,
    };
  }

  function refreshTips(force) {
    var cached = load(STORE_TIPS, null);
    if (!force && cached && cached.ts && (Date.now() - cached.ts) < TIPS_TTL) {
      renderTips(cached.tips);
      return;
    }

    var list    = el('tips-list');
    var loading = el('tips-loading');
    var btn     = el('tips-refresh-btn');

    if (list) list.innerHTML = '';
    if (loading) { loading.style.display = 'flex'; if (list) list.appendChild(loading); }
    if (btn) btn.disabled = true;

    fetch('/api/wellness/tips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ healthData: buildHealthData() }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var tips = data.tips || [];
        save(STORE_TIPS, { ts: Date.now(), tips: tips });
        renderTips(tips);
      })
      .catch(function () {
        renderTips([
          { tip: '💧 Stay hydrated — aim for 8 glasses throughout the day.', category: 'water', urgency: 'medium' },
          { tip: '😴 Consistent sleep times improve focus more than total hours.', category: 'sleep', urgency: 'medium' },
          { tip: '🧠 Short breaks between study sessions improve long-term retention.', category: 'study', urgency: 'low' },
        ]);
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function renderTips(tips) {
    var list = el('tips-list');
    if (!list) return;
    list.innerHTML = '';
    if (!tips || !tips.length) {
      list.innerHTML = '<p class="tips-empty">No tips available right now.</p>';
      return;
    }
    tips.forEach(function (tip) {
      var item = document.createElement('div');
      item.className = 'tips-item';
      var dotColor = URGENCY_COLORS[tip.urgency] || URGENCY_COLORS.low;
      item.innerHTML =
        '<span class="tip-urgency-dot" style="background:' + dotColor + '" title="' + (tip.urgency || 'low') + ' priority"></span>' +
        '<span class="tip-text">' + escapeHtml(tip.tip) + '</span>' +
        '<span class="tip-category">' + escapeHtml(tip.category || '') + '</span>';
      list.appendChild(item);
    });
  }

  // ── Dashboard sync ───────────────────────────────────────────────────────

  function syncDashboard() {
    try {
      var sw = JSON.parse(localStorage.getItem('studywell_data') || '{}');
      if (!sw.daily_logs) sw.daily_logs = [];

      var idx = -1;
      for (var i = 0; i < sw.daily_logs.length; i++) {
        if (sw.daily_logs[i].date === todayStr()) { idx = i; break; }
      }
      var log = idx >= 0 ? sw.daily_logs[idx] : {
        date: todayStr(), water_glasses: 0, sleep_hours: 0, mood: 3, sessions_count: 0, study_minutes: 0,
      };

      var water = getWaterData();
      var sleep = getTodaySleep();
      var mood  = load(STORE_MOOD, null);

      log.water_glasses = water.glasses;
      if (sleep) log.sleep_hours = sleep.hours;
      if (mood && mood.date === todayStr()) log.mood = Math.max(1, Math.min(5, Math.round(mood.score / 2)));

      if (idx >= 0) sw.daily_logs[idx] = log;
      else sw.daily_logs.push(log);

      localStorage.setItem('studywell_data', JSON.stringify(sw));
    } catch (e) {}
  }

  // ── Glance bar + greeting ────────────────────────────────────────────────

  function renderGlance() {
    var water = getWaterData();
    var sleep = getTodaySleep();
    var mood  = load(STORE_MOOD, null);

    var score = 0;
    if (sleep) score += Math.min(40, (sleep.hours / 8) * 40);
    score += Math.min(30, (water.glasses / water.goal) * 30);
    if (mood && mood.date === todayStr()) score += Math.min(30, (mood.score / 10) * 30);
    score = Math.round(score);

    var scoreEl = el('glance-score-val'); if (scoreEl) scoreEl.textContent = score + '/100';

    var streak = 0;
    var logs = getSleepLogs();
    for (var i = 1; i <= 30; i++) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var ds = d.toISOString().slice(0, 10);
      var found = false;
      for (var j = 0; j < logs.length; j++) { if (logs[j].date === ds) { found = true; break; } }
      if (found) streak++;
      else break;
    }
    var streakEl = el('health-streak-num'); if (streakEl) streakEl.textContent = streak;

    var h = new Date().getHours();
    var greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    var greetEl = el('health-greeting'); if (greetEl) greetEl.textContent = greet + ". Here's your wellness overview.";
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    renderSleep();
    renderWater();
    renderMood();
    renderGlance();

    var moodInp = el('mood-chat-input');
    if (moodInp) {
      moodInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMoodAnswer(); }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    toggleCard:               toggleCard,
    logSleep:                 logSleep,
    updateBedtimeTarget:      updateBedtimeTarget,
    scheduleBedtimeReminder:  scheduleBedtimeReminder,
    addWater:                 addWater,
    setWaterGoal:             setWaterGoal,
    scheduleWaterReminder:    scheduleWaterReminder,
    startMoodCheckin:         startMoodCheckin,
    sendMoodAnswer:           sendMoodAnswer,
    resetMood:                resetMood,
    refreshTips:              refreshTips,
  };
})();
