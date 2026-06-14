document.addEventListener('DOMContentLoaded', () => {
  if (!StudiousAuth.requireAuth()) return;

  const user = StudiousAuth.getCurrentUser();

  // ── Profile ───────────────────────────────────────────────
  const firstNameEl   = document.getElementById('profile-first-name');
  const fullNameEl    = document.getElementById('profile-full-name');
  const pictureEl     = document.getElementById('profile-picture');
  const placeholderEl = document.getElementById('profile-placeholder');
  const avatarBtn     = document.getElementById('profile-avatar-btn');
  const fileInput     = document.getElementById('profile-picture-input');

  if (firstNameEl) firstNameEl.textContent = user.username;
  if (fullNameEl)  fullNameEl.textContent  = `${user.firstName} ${user.lastName}`;

  function showProfilePicture(src) {
    if (!pictureEl || !placeholderEl) return;
    if (src) {
      pictureEl.src = src;
      pictureEl.classList.remove('hidden');
      placeholderEl.classList.add('hidden');
      return;
    }
    pictureEl.removeAttribute('src');
    pictureEl.classList.add('hidden');
    placeholderEl.classList.remove('hidden');
  }
  showProfilePicture(user.profilePicture);

  avatarBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (StudiousAuth.updateProfilePicture(reader.result)) showProfilePicture(reader.result);
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
  });

  // ── Date display ──────────────────────────────────────────
  const dateEl = document.getElementById('dash-date');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }

  // ── Utility ───────────────────────────────────────────────
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ── Focus stats ───────────────────────────────────────────
  function loadFocusStats() {
    try {
      const data = JSON.parse(localStorage.getItem('studywell_data') || 'null');
      if (!data) return;
      const today = todayStr();
      const todaySessions = (data.sessions || []).filter(s => s.date === today && s.completed);
      const totalMins = todaySessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
      const last = todaySessions[todaySessions.length - 1];

      const sessEl = document.getElementById('dash-today-sessions');
      const minsEl = document.getElementById('dash-today-minutes');
      const lastEl = document.getElementById('dash-last-session');
      if (sessEl) sessEl.textContent = todaySessions.length;
      if (minsEl) minsEl.textContent = totalMins > 0 ? `${totalMins}m` : '0m';
      if (lastEl) lastEl.textContent = last ? `${last.duration_minutes}m` : '—';
    } catch (_) {}
  }

  function checkActiveFocusSession() {
    try {
      const state = JSON.parse(localStorage.getItem('studious_focus_session') || 'null');
      if (!state || !state.active) return;
      const heroEl    = document.getElementById('dash-focus-hero');
      const badgeEl   = document.getElementById('dash-focus-badge');
      const headingEl = document.getElementById('dash-focus-heading');
      const subEl     = document.getElementById('dash-focus-sub');
      const ctaEl     = document.getElementById('dash-focus-cta');
      if (heroEl)    heroEl.classList.add('focus-hero-active');
      if (badgeEl)   badgeEl.textContent = '● ACTIVE';
      if (headingEl) headingEl.textContent = 'Session in progress!';
      if (subEl)     subEl.textContent = 'Your focus session is running. Keep it up!';
      if (ctaEl)     ctaEl.innerHTML = '<img src="" class="focus-cta-btn-icon" alt="" aria-hidden="true"> Open Session';
    } catch (_) {}
  }

  // ── Flashcard quiz ────────────────────────────────────────
  function loadFlashcardQuiz() {
    const qEl       = document.getElementById('dash-quiz-q');
    const aEl       = document.getElementById('dash-quiz-a');
    const revealBtn = document.getElementById('dash-quiz-reveal');
    if (!qEl) return;
    try {
      const cards = JSON.parse(localStorage.getItem('studious_flashcards') || '[]');
      if (!cards.length) return;
      const card = cards[Math.floor(Math.random() * cards.length)];
      qEl.insertAdjacentHTML('beforebegin', '<span class="dash-quiz-intro">A quick question for you:</span>');
      qEl.textContent = card.question;
      if (aEl) aEl.textContent = card.answer;
      if (revealBtn) {
        revealBtn.classList.remove('hidden');
        revealBtn.addEventListener('click', () => {
          aEl?.classList.remove('hidden');
          revealBtn.classList.add('hidden');
        });
      }
    } catch (_) {}
  }

  // ── Health summary ────────────────────────────────────────
  function loadHealthSummary() {
    const today = todayStr();
    const MOOD_EMOJIS = {
      happy: '😊', content: '🙂', neutral: '😐',
      stressed: '😰', anxious: '😟', tired: '😴', overwhelmed: '😵',
    };

    try {
      const moodData  = JSON.parse(localStorage.getItem('health_mood') || 'null');
      const moodEmoji = document.getElementById('dash-mood-emoji');
      const moodLbl   = document.getElementById('dash-mood-label');
      const moodSub   = document.getElementById('dash-mood-sub');
      if (moodData && moodData.date === today && moodData.mood) {
        const emoji = MOOD_EMOJIS[moodData.mood] || '✨';
        const label = moodData.mood.charAt(0).toUpperCase() + moodData.mood.slice(1);
        if (moodEmoji) moodEmoji.textContent = emoji;
        if (moodLbl)   moodLbl.textContent   = `${label} — ${moodData.score}/10`;
        if (moodSub && moodData.summary) moodSub.textContent = moodData.summary;
      }
    } catch (_) {}

    try {
      const waterData = JSON.parse(localStorage.getItem('health_water') || 'null');
      const waterEl   = document.getElementById('dash-water-val');
      if (waterEl && waterData && waterData.date === today) {
        waterEl.textContent = `${waterData.glasses}/${waterData.goal}`;
      }
    } catch (_) {}

    try {
      const sleepLogs = JSON.parse(localStorage.getItem('health_sleep') || '[]');
      const sleepEl   = document.getElementById('dash-sleep-val');
      if (sleepEl && sleepLogs.length) {
        const last = sleepLogs[sleepLogs.length - 1];
        if (last?.hours) sleepEl.textContent = `${last.hours}h`;
      }
    } catch (_) {}
  }

  // ── Upcoming assessments ──────────────────────────────────
  function loadUpcomingAssessments() {
    const listEl = document.getElementById('dash-assessments-list');
    const noneEl = document.getElementById('dash-no-assessments');
    if (!listEl) return;
    try {
      const allEvents   = loadAllEvents();
      const assessments = getUpcomingEvents(allEvents, { weekOnly: false })
        .filter(e => e.event.isAssessment)
        .slice(0, 4);
      listEl.innerHTML = '';
      if (!assessments.length) {
        noneEl?.classList.remove('hidden');
        return;
      }
      noneEl?.classList.add('hidden');
      assessments.forEach(({ dateLabel, event }) => {
        const li = document.createElement('li');
        li.className = 'dash-list-item';
        li.innerHTML = `
          <span class="dash-list-dot"></span>
          <span class="dash-list-body">
            <span class="dash-list-title">${event.title}</span>
            <span class="dash-list-meta">${dateLabel}</span>
          </span>`;
        listEl.appendChild(li);
      });
    } catch (_) {
      noneEl?.classList.remove('hidden');
    }
  }

  // ── Scroll reveal ─────────────────────────────────────────
  const revealEls = document.querySelectorAll('.scroll-reveal');
  if (revealEls.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const delay = Number(entry.target.dataset.revealDelay || 0) * 120;
          setTimeout(() => entry.target.classList.add('is-visible'), delay);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
    );
    revealEls.forEach((el) => observer.observe(el));
  }

  // ── Run loaders ───────────────────────────────────────────
  loadFocusStats();
  checkActiveFocusSession();
  loadFlashcardQuiz();
  loadHealthSummary();
  loadUpcomingAssessments();
});
