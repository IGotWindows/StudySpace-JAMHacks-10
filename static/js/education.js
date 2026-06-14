document.addEventListener('DOMContentLoaded', () => {
  if (!StudiousAuth.requireAuth()) return;

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function set(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ── Focus stats ───────────────────────────────────────────
  function loadFocusStats() {
    try {
      const data = JSON.parse(localStorage.getItem('studywell_data') || 'null');
      if (!data) return;
      const today = todayStr();
      const sessions = (data.sessions || []).filter(s => s.date === today && s.completed);
      const totalMins = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
      const count = sessions.length;
      set('edu-sessions-today', count);
      set('edu-focus-badge', `${count} session${count !== 1 ? 's' : ''} today`);
      set('edu-focus-stat', totalMins > 0
        ? `${totalMins} minutes focused today`
        : 'No sessions yet today — start one!');
    } catch (_) {}
  }

  // ── Study / flashcard stats ───────────────────────────────
  function loadStudyStats() {
    try {
      const cards = JSON.parse(localStorage.getItem('studious_flashcards') || '[]');
      const count = cards.length;
      set('edu-flashcard-count', count);
      set('edu-study-badge', `${count} card${count !== 1 ? 's' : ''} saved`);
      set('edu-study-stat', count > 0
        ? `${count} flashcard${count !== 1 ? 's' : ''} ready to review`
        : 'Upload notes to generate flashcards');
    } catch (_) {}
  }

  // ── Assessment stats (from calendar-events.js) ────────────
  function loadAssessmentStats() {
    try {
      const allEvents  = loadAllEvents();
      const upcoming   = getUpcomingEvents(allEvents, { weekOnly: false })
        .filter(e => e.event.isAssessment);
      const count = upcoming.length;
      set('edu-assessments-count', count);
      set('edu-grades-badge', `${count} upcoming test${count !== 1 ? 's' : ''}`);
      set('edu-grades-stat', count > 0
        ? `Next: ${upcoming[0].dateLabel} — ${upcoming[0].event.title}`
        : 'Add assessments on your calendar');
    } catch (_) {}
  }

  loadFocusStats();
  loadStudyStats();
  loadAssessmentStats();
});
