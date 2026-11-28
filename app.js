(() => {
  'use strict';

  const CHOICES = [
    { id: 'wall-sit', label: 'Wall-sit' },
    { id: 'bridge', label: 'Bridge' },
    { id: 'plank', label: 'Plank' },
    { id: 'superman', label: 'Superman' },
    { id: 'push-up hold', label: 'Push-up hold' },
    { id: 'pull-up hold', label: 'Pull-up hold' }
  ];
  const CHOICE_MAP = Object.fromEntries(CHOICES.map(x => [x.id, x.label]));
  const SETTINGS_KEY = 'move-freeform-routines-v1'; // Keep previous settings when upgrading.
  const BESTS_KEY = 'move-freeform-personal-bests-v3';
  const HISTORY_KEY = 'move-freeform-last-ten-v3';
  const VOICE_LANG = 'en-US';
  const ANNOUNCEMENT_DELAY_MS = 5000;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  const dom = Object.fromEntries([
    'setupScreen', 'workoutScreen', 'completeScreen', 'roundCount', 'roundTabs', 'roundHeading',
    'exerciseCount', 'exerciseRows', 'addExerciseBtn', 'gongToggle', 'announceToggle',
    'copyRoundToggle', 'copyRoundNotice', 'editRoundOneButton', 'voiceButton', 'voiceStatus',
    'voiceCompatibleMode', 'voiceOfflineMode', 'voiceWorkoutButton', 'voiceWorkoutStatus', 'voiceLastHeard',
    'routineSummary', 'beginButton', 'roundProgress', 'exerciseProgress', 'liveIndicator',
    'activeStage', 'reviewStage', 'floatingName', 'activePB', 'reviewName', 'reviewPB',
    'resultTime', 'nextCue', 'stopButton', 'nextButton', 'workoutHint', 'exitButton',
    'wakeStatus', 'finishDescription', 'completedRounds', 'completedExercises', 'totalElapsed',
    'postWorkoutNote', 'newWorkoutButton', 'announcer', 'historyButton',
    'historyFinishedButton', 'historyDialog', 'historyCloseButton', 'historyList',
    'historyCount', 'historyFootnote'
  ].map(id => [id, document.getElementById(id)]));

  const model = {
    rounds: [['wall-sit', 'bridge', 'plank']],
    selectedRound: 0,
    copyRoundOne: false,
    gong: true, announce: true,
    personalBests: {}, history: [],
    phase: 'setup', // setup | running | review | complete
    agenda: [], currentIndex: 0, startedAt: 0,
    results: [], lastResult: null,
    pendingAnnouncement: null, announcementCountdown: null, announceDue: 0,
    wakeLock: null, wakeDeadline: 0, wakeTimer: null,
    audioContext: null,
    voiceEnabled: false, voiceMode: 'compatible', voiceRecognition: null,
    voiceRestartTimer: null, voiceStartWatchdog: null, voiceSpeechWatchdog: null,
    voiceQuietUntil: 0, voiceChecking: false, voiceSpeechHold: false,
    voiceState: 'off', voiceLastHeard: '', voiceLastCommandAt: 0,
    voiceRestartFailures: 0, voiceSpeechSerial: 0
  };

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { /* Private mode / limited storage: timer still works. */ }
  }
  function validRound(round) {
    return Array.isArray(round) && round.length >= 1 && round.length <= 10 &&
      round.every(id => Object.prototype.hasOwnProperty.call(CHOICE_MAP, id));
  }
  function syncRoundsFromFirst() {
    if (!model.copyRoundOne) return;
    for (let i = 1; i < model.rounds.length; i++) model.rounds[i] = [...model.rounds[0]];
  }
  function loadSavedData() {
    const settings = readJSON(SETTINGS_KEY);
    if (settings && Array.isArray(settings.rounds) && settings.rounds.length >= 1 &&
        settings.rounds.length <= 8 && settings.rounds.every(validRound)) {
      model.rounds = settings.rounds.map(round => [...round]);
    }
    if (settings && typeof settings.gong === 'boolean') model.gong = settings.gong;
    if (settings && typeof settings.announce === 'boolean') model.announce = settings.announce;
    if (settings && typeof settings.copyRoundOne === 'boolean') model.copyRoundOne = settings.copyRoundOne;
    if (settings && ['compatible', 'offline'].includes(settings.voiceMode)) model.voiceMode = settings.voiceMode;
    syncRoundsFromFirst();

    const bests = readJSON(BESTS_KEY);
    if (bests && typeof bests === 'object' && !Array.isArray(bests)) {
      CHOICES.forEach(({id}) => {
        if (typeof bests[id] === 'number' && Number.isFinite(bests[id]) && bests[id] >= 0)
          model.personalBests[id] = bests[id];
      });
    }
    const history = readJSON(HISTORY_KEY);
    if (Array.isArray(history)) {
      model.history = history.filter(workout =>
        workout && typeof workout.date === 'string' && Array.isArray(workout.results) &&
        workout.results.length <= 80 && workout.results.every(item =>
          item && Object.prototype.hasOwnProperty.call(CHOICE_MAP, item.id) &&
          Number.isFinite(item.elapsed) && item.elapsed >= 0 &&
          Number.isInteger(item.roundIndex) && Number.isInteger(item.exerciseIndex)
        )
      ).slice(0, 10);
    }
  }
  function saveSettings() {
    writeJSON(SETTINGS_KEY, {rounds: model.rounds, gong: model.gong,
      announce: model.announce, copyRoundOne: model.copyRoundOne, voiceMode: model.voiceMode});
  }
  function afterRoutineEdit() {
    syncRoundsFromFirst(); saveSettings(); renderSetup();
  }

  function formatted(ms) {
    const tenths = Math.max(0, Math.floor(ms / 100));
    const hours = Math.floor(tenths / 36000);
    const minutes = Math.floor(tenths / 600) % 60;
    const seconds = Math.floor(tenths / 10) % 60;
    const tenth = tenths % 10;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenth}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenth}`;
  }
  function labelFor(id) { return CHOICE_MAP[id] || id; }
  function personalBestText(id, prefix = 'PERSONAL BEST') {
    return Number.isFinite(model.personalBests[id]) ? `${prefix} · ${formatted(model.personalBests[id])}` : `${prefix} · —`;
  }
  function optionsHTML(selected) {
    return CHOICES.map(x => `<option value="${x.id}"${x.id === selected ? ' selected' : ''}>${x.label}</option>`).join('');
  }
  function allExerciseCount() { return model.rounds.reduce((sum, round) => sum + round.length, 0); }
  function notify(message) { dom.announcer.textContent = message; }

  function renderRoundTabs() {
    dom.roundTabs.replaceChildren();
    model.rounds.forEach((_, i) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'round-tab'; button.role = 'tab';
      button.textContent = `Round ${i + 1}`;
      button.setAttribute('aria-selected', String(i === model.selectedRound));
      if (model.copyRoundOne && i > 0) button.title = 'Mirrors Round 1';
      button.addEventListener('click', () => { model.selectedRound = i; renderSetup(); });
      dom.roundTabs.append(button);
    });
  }
  function makeButton(text, className, title, action, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = text; button.className = className;
    button.title = title; button.setAttribute('aria-label', title); button.disabled = disabled;
    button.addEventListener('click', action);
    return button;
  }
  function renderExerciseRows() {
    const round = model.rounds[model.selectedRound];
    const linkedReadOnly = model.copyRoundOne && model.selectedRound > 0;
    dom.roundHeading.textContent = `ROUND ${model.selectedRound + 1}`;
    dom.exerciseCount.textContent = `${round.length} EXERCISE${round.length === 1 ? '' : 'S'}${linkedReadOnly ? ' · LINKED' : ''}`;
    dom.copyRoundNotice.hidden = !linkedReadOnly;
    dom.exerciseRows.replaceChildren();
    round.forEach((id, i) => {
      const wrapper = document.createElement('div'); wrapper.className = 'exercise-row';
      const n = document.createElement('span'); n.className = 'exercise-index';
      n.textContent = String(i + 1).padStart(2, '0');
      const detail = document.createElement('div'); detail.className = 'exercise-detail';
      const selectWrap = document.createElement('div'); selectWrap.className = 'select-wrap exercise-select-wrap';
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Round ${model.selectedRound + 1}, exercise ${i + 1}`);
      select.innerHTML = optionsHTML(id);
      select.disabled = linkedReadOnly;
      const record = document.createElement('div'); record.className = 'mini-record';
      record.textContent = personalBestText(id, 'PB');
      select.addEventListener('change', () => {
        round[i] = select.value;
        record.textContent = personalBestText(select.value, 'PB');
        syncRoundsFromFirst(); saveSettings();
      });
      selectWrap.append(select); detail.append(selectWrap, record);
      const moveContainer = document.createElement('div'); moveContainer.className = 'move-btns';
      const up = makeButton('↑', 'move-btn', `Move exercise ${i + 1} up`, () => {
        [round[i - 1], round[i]] = [round[i], round[i - 1]]; afterRoutineEdit();
      }, linkedReadOnly || i === 0);
      const down = makeButton('↓', 'move-btn', `Move exercise ${i + 1} down`, () => {
        [round[i + 1], round[i]] = [round[i], round[i + 1]]; afterRoutineEdit();
      }, linkedReadOnly || i === round.length - 1);
      moveContainer.append(up, down);
      const remove = makeButton('×', 'remove-btn', `Remove exercise ${i + 1}`, () => {
        round.splice(i, 1); afterRoutineEdit();
      }, linkedReadOnly || round.length === 1);
      wrapper.append(n, detail, moveContainer, remove);
      dom.exerciseRows.append(wrapper);
    });
    dom.addExerciseBtn.disabled = linkedReadOnly || round.length >= 10;
    dom.addExerciseBtn.textContent = linkedReadOnly ? 'Edit the sequence in Round 1' :
      round.length >= 10 ? 'Maximum 10 exercises per round' : '＋ Add exercise';
  }
  function renderSetup() {
    dom.roundCount.value = String(model.rounds.length);
    dom.copyRoundToggle.checked = model.copyRoundOne;
    dom.gongToggle.checked = model.gong;
    dom.announceToggle.checked = model.announce;
    renderRoundTabs(); renderExerciseRows();
    const n = allExerciseCount();
    dom.routineSummary.textContent = `${model.rounds.length} ROUND${model.rounds.length === 1 ? '' : 'S'} · ${n} EXERCISE${n === 1 ? '' : 'S'}`;
    dom.historyCount.textContent = `${model.history.length} SAVED`;
    dom.historyFinishedButton.textContent = `View workout history (${model.history.length})`;
  }
  function changeRoundCount() {
    const wanted = Math.max(1, Math.min(8, Number(dom.roundCount.value) || 1));
    while (model.rounds.length < wanted) model.rounds.push(model.copyRoundOne ? [...model.rounds[0]] : ['wall-sit']);
    model.rounds.length = wanted;
    model.selectedRound = Math.min(model.selectedRound, wanted - 1);
    afterRoutineEdit();
  }
  function showScreen(screen) {
    dom.setupScreen.hidden = screen !== 'setup';
    dom.workoutScreen.hidden = screen !== 'workout';
    dom.completeScreen.hidden = screen !== 'complete';
    window.scrollTo({top: 0, behavior: 'instant'});
  }
  function makeAgenda() {
    return model.rounds.flatMap((round, roundIndex) => round.map((id, exerciseIndex) => ({id, roundIndex, exerciseIndex})));
  }

  function unlockAudio() {
    if (!model.audioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { model.audioContext = new AC(); } catch (_) {} }
    }
    if (model.audioContext && model.audioContext.state === 'suspended')
      model.audioContext.resume().catch(() => {});
  }
  function gong() {
    if (!model.gong || !model.audioContext) return;
    try {
      const ctx = model.audioContext, t = ctx.currentTime + 0.015;
      [{f:220, a:.18, d:2.4},{f:332,a:.12,d:2.0},{f:447,a:.07,d:1.7},
       {f:564,a:.035,d:1.5},{f:733,a:.025,d:1.1}].forEach(({f,a,d}) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(f, t);
        gain.gain.setValueAtTime(.0001, t);
        gain.gain.exponentialRampToValueAtTime(a, t + .018);
        gain.gain.exponentialRampToValueAtTime(.0001, t + d);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + d + .04);
      });
    } catch (_) { /* Optional audio. */ }
  }
  // Pause the microphone while the phone speaks. Otherwise the recognizer can
  // mistake its own announcements for START / STOP, and iOS can lose its audio session.
  function say(message) {
    if (!model.announce || !('speechSynthesis' in window)) return;
    const serial = ++model.voiceSpeechSerial;
    model.voiceSpeechHold = true;
    model.voiceQuietUntil = Date.now() + 600;
    stopVoiceRecognition();
    const finishSpeech = () => {
      if (serial !== model.voiceSpeechSerial) return;
      if (model.voiceSpeechWatchdog) clearInterval(model.voiceSpeechWatchdog);
      model.voiceSpeechWatchdog = null;
      model.voiceSpeechHold = false;
      model.voiceQuietUntil = Date.now() + 450;
      if (model.voiceEnabled && model.phase !== 'complete') scheduleVoiceRestart(650);
      else updateVoiceUI();
    };
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = VOICE_LANG; utterance.rate = .94; utterance.pitch = 1;
      const localVoice = window.speechSynthesis.getVoices().find(v =>
        v.localService && v.lang.toLowerCase().startsWith('en'));
      if (localVoice) utterance.voice = localVoice;
      utterance.onstart = () => { model.voiceQuietUntil = Date.now() + 400; };
      utterance.onend = finishSpeech;
      utterance.onerror = finishSpeech;
      window.speechSynthesis.speak(utterance);
      // Some mobile browsers omit onend. Poll until the synthesizer goes idle.
      // Allow enough startup time to avoid prematurely restarting recognition.
      const began = Date.now();
      model.voiceSpeechWatchdog = setInterval(() => {
        if (serial !== model.voiceSpeechSerial) {clearInterval(model.voiceSpeechWatchdog); return;}
        if (Date.now() - began > 1700 && !window.speechSynthesis.speaking &&
            !window.speechSynthesis.pending) finishSpeech();
        else if (Date.now() - began > Math.max(13000, message.length * 180 + 5000)) finishSpeech();
      }, 450);
    } catch (_) { finishSpeech(); }
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || typeof navigator.wakeLock.request !== 'function') {
      dom.wakeStatus.textContent = 'Keep-awake not supported here; keep your phone active.';
      return;
    }
    if (document.visibilityState !== 'visible' || model.wakeLock) return;
    if (model.wakeDeadline && Date.now() >= model.wakeDeadline) { await releaseWakeLock(); return; }
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      model.wakeLock = sentinel;
      dom.wakeStatus.textContent = 'Screen wake lock ON';
      sentinel.addEventListener('release', () => {
        if (model.wakeLock === sentinel) model.wakeLock = null;
        if (model.phase === 'running' || model.phase === 'review' ||
            (model.wakeDeadline && Date.now() < model.wakeDeadline)) {
          dom.wakeStatus.textContent = 'Wake lock paused; keep the app foregrounded.';
        }
      });
    } catch (_) { dom.wakeStatus.textContent = 'Unable to keep this screen awake.'; }
  }
  async function releaseWakeLock() {
    const lock = model.wakeLock; model.wakeLock = null;
    if (lock) { try { await lock.release(); } catch (_) {} }
    dom.wakeStatus.textContent = 'Keep-awake finished';
    if (model.phase === 'complete') dom.postWorkoutNote.textContent =
      'The one-minute keep-awake period has ended. Your workout is saved.';
  }
  function clearFinalWakeHold() {
    if (model.wakeTimer) clearTimeout(model.wakeTimer);
    model.wakeTimer = null; model.wakeDeadline = 0;
    void releaseWakeLock();
  }
  function scheduleFinalWakeHold() {
    model.wakeDeadline = Date.now() + 60_000;
    if (model.wakeTimer) clearTimeout(model.wakeTimer);
    dom.postWorkoutNote.textContent = 'Keeping the screen awake for 1 minute after your final exercise.';
    model.wakeTimer = setTimeout(() => {
      model.wakeTimer = null; model.wakeDeadline = 0;
      void releaseWakeLock();
    }, 60_000);
  }

  function cancelNextAnnouncement() {
    if (model.pendingAnnouncement !== null) clearTimeout(model.pendingAnnouncement);
    if (model.announcementCountdown !== null) clearInterval(model.announcementCountdown);
    model.pendingAnnouncement = null;
    model.announcementCountdown = null;
    model.announceDue = 0;
  }
  function scheduleNextAnnouncement(message, displayText) {
    cancelNextAnnouncement();
    model.announceDue = Date.now() + ANNOUNCEMENT_DELAY_MS;
    function updateCountdown() {
      if (model.phase !== 'review') return;
      const left = Math.max(0, Math.ceil((model.announceDue - Date.now()) / 1000));
      dom.nextCue.textContent = left ? `NEXT ANNOUNCEMENT IN ${left}s` : displayText;
    }
    updateCountdown();
    model.announcementCountdown = setInterval(updateCountdown, 250);
    model.pendingAnnouncement = setTimeout(() => {
      cancelNextAnnouncement();
      if (model.phase !== 'review') return;
      dom.nextCue.textContent = displayText;
      say(message);
      notify(message);
    }, ANNOUNCEMENT_DELAY_MS);
  }
  function startExercise() {
    if (model.phase !== 'setup' && model.phase !== 'review') return;
    cancelNextAnnouncement(); // An early START must not cause a stale “Next up” while exercising.
    unlockAudio();
    if (model.phase === 'setup') {
      model.agenda = makeAgenda();
      model.currentIndex = 0; model.results = []; model.lastResult = null;
      clearFinalWakeHold();
    }
    const item = model.agenda[model.currentIndex];
    if (!item) return;
    model.startedAt = performance.now();
    model.phase = 'running';
    dom.roundProgress.textContent = `${item.roundIndex + 1} / ${model.rounds.length}`;
    dom.exerciseProgress.textContent = `${item.exerciseIndex + 1} / ${model.rounds[item.roundIndex].length}`;
    dom.floatingName.textContent = labelFor(item.id);
    dom.activePB.textContent = personalBestText(item.id);
    dom.liveIndicator.innerHTML = '<span class="red-dot"></span> IN PROGRESS';
    dom.activeStage.hidden = false; dom.reviewStage.hidden = true;
    dom.stopButton.hidden = false; dom.nextButton.hidden = true;
    dom.workoutHint.textContent = 'Say “stop” or tap STOP whenever you finish.';
    showScreen('workout');
    updateVoiceUI();
    void acquireWakeLock();
    gong(); say(labelFor(item.id));
    notify(`${labelFor(item.id)} started. Stopwatch hidden.`);
  }
  function updatePersonalBest(id, elapsed) {
    const before = model.personalBests[id];
    if (before === undefined || elapsed > before) {
      model.personalBests[id] = elapsed;
      writeJSON(BESTS_KEY, model.personalBests);
      return true;
    }
    return false;
  }
  function saveCompletedWorkout() {
    const total = model.results.reduce((sum, x) => sum + x.elapsed, 0);
    const finished = {
      date: new Date().toISOString(),
      roundCount: model.rounds.length,
      total,
      results: model.results.map(x => ({ id: x.id, elapsed: x.elapsed,
        roundIndex: x.roundIndex, exerciseIndex: x.exerciseIndex }))
    };
    model.history.unshift(finished);
    model.history.length = Math.min(10, model.history.length);
    writeJSON(HISTORY_KEY, model.history);
  }
  function stopExercise() {
    if (model.phase !== 'running') return;
    const elapsed = Math.max(0, performance.now() - model.startedAt);
    const item = model.agenda[model.currentIndex];
    const newBest = updatePersonalBest(item.id, elapsed);
    model.lastResult = {...item, elapsed, newBest};
    model.results.push(model.lastResult);
    model.currentIndex += 1;
    const next = model.agenda[model.currentIndex];
    if (next) {
      const finishedRound = item.exerciseIndex === model.rounds[item.roundIndex].length - 1;
      const nextName = labelFor(next.id);
      const message = finishedRound
        ? `Round ${item.roundIndex + 1} finished, coming up round ${next.roundIndex + 1}. Next up, ${nextName}.`
        : `Next up, ${nextName}.`;
      const label = finishedRound
        ? `ROUND ${next.roundIndex + 1} · NEXT UP ${nextName.toUpperCase()}`
        : `NEXT UP · ${nextName.toUpperCase()}`;
      model.phase = 'review';
      dom.liveIndicator.textContent = '● EXERCISE RECORDED';
      dom.reviewName.textContent = labelFor(item.id);
      dom.resultTime.textContent = formatted(elapsed);
      dom.reviewPB.textContent = `${personalBestText(item.id)}${newBest ? ' · NEW RECORD!' : ''}`;
      dom.activeStage.hidden = true; dom.reviewStage.hidden = false;
      dom.stopButton.hidden = true; dom.nextButton.hidden = false;
      dom.nextButton.querySelector('span').textContent = 'Start next exercise';
      dom.workoutHint.textContent = 'The next exercise is announced 5 seconds after STOP. You may START sooner.';
      scheduleNextAnnouncement(message, label);
      showScreen('workout');
      updateVoiceUI();
      notify(`${labelFor(item.id)} recorded: ${formatted(elapsed)}. Next announcement in 5 seconds.`);
    } else {
      // Final round: bypass the five-second delay and announce completion immediately.
      cancelNextAnnouncement();
      model.phase = 'complete';
      saveCompletedWorkout();
      scheduleFinalWakeHold();
      renderFinish(); renderSetup();
      showScreen('complete');
      say(`Round ${item.roundIndex + 1} finished. Final round complete. Workout finished.`);
      notify(`Workout finished. ${model.results.length} exercises recorded.`);
    }
  }
  function renderFinish() {
    dom.completedRounds.textContent = String(model.rounds.length);
    dom.completedExercises.textContent = String(model.results.length);
    dom.totalElapsed.textContent = formatted(model.results.reduce((sum, item) => sum + item.elapsed, 0));
    dom.finishDescription.textContent = `${model.rounds.length} round${model.rounds.length === 1 ? '' : 's'} finished · ${model.results.length} exercises recorded. Results are saved on this device.`;
  }
  function backToSetup() {
    const holdStillActive = model.wakeDeadline && Date.now() < model.wakeDeadline;
    cancelNextAnnouncement();
    model.phase = 'setup'; model.agenda = []; model.currentIndex = 0; model.startedAt = 0;
    if (!holdStillActive) clearFinalWakeHold();
    ++model.voiceSpeechSerial;
    if (model.voiceSpeechWatchdog) clearInterval(model.voiceSpeechWatchdog);
    model.voiceSpeechWatchdog = null; model.voiceSpeechHold = false;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    renderSetup(); showScreen('setup');
    if (model.voiceEnabled) scheduleVoiceRestart(350);
  }

  function renderHistoryRows(container, results) {
    let lastRound = -1;
    results.forEach(item => {
      if (item.roundIndex !== lastRound) {
        const heading = document.createElement('h3'); heading.className = 'round-group-title';
        heading.textContent = `ROUND ${item.roundIndex + 1}`;
        container.append(heading); lastRound = item.roundIndex;
      }
      const row = document.createElement('div'); row.className = 'history-row';
      const label = document.createElement('span');
      const n = document.createElement('span'); n.className = 'history-index';
      n.textContent = String(item.exerciseIndex + 1).padStart(2, '0');
      label.append(n, document.createTextNode(labelFor(item.id)));
      const value = document.createElement('strong'); value.textContent = formatted(item.elapsed);
      row.append(label, value); container.append(row);
    });
  }
  function renderHistory() {
    dom.historyList.replaceChildren();
    if (!model.history.length) {
      const empty = document.createElement('div'); empty.className = 'history-empty';
      empty.textContent = 'No completed workouts yet. Finish your first workout to see it here.';
      dom.historyList.append(empty);
      return;
    }
    model.history.forEach((workout, index) => {
      const details = document.createElement('details'); details.className = 'session-entry';
      if (index === 0) details.open = true;
      const summary = document.createElement('summary'); summary.className = 'session-summary';
      const head = document.createElement('div'); head.className = 'session-head';
      const name = document.createElement('strong');
      let dateLabel;
      try { dateLabel = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium', timeStyle: 'short'
      }).format(new Date(workout.date)); } catch (_) { dateLabel = workout.date; }
      name.textContent = dateLabel;
      const subtitle = document.createElement('span'); subtitle.className = 'session-subtitle';
      const count = Number(workout.roundCount) || Math.max(...workout.results.map(x => x.roundIndex + 1), 1);
      subtitle.textContent = `${count} round${count === 1 ? '' : 's'} · ${workout.results.length} exercises`;
      head.append(name, subtitle);
      const total = document.createElement('span'); total.className = 'session-time';
      total.textContent = formatted(workout.results.reduce((sum, x) => sum + x.elapsed, 0));
      summary.append(head, total); details.append(summary);
      const body = document.createElement('div'); body.className = 'session-body';
      renderHistoryRows(body, workout.results);
      details.append(body); dom.historyList.append(details);
    });
  }
  function openHistory() {
    renderHistory();
    if (typeof dom.historyDialog.showModal === 'function') dom.historyDialog.showModal();
    else dom.historyDialog.setAttribute('open', '');
  }
  function closeHistory() {
    if (typeof dom.historyDialog.close === 'function') dom.historyDialog.close();
    else dom.historyDialog.removeAttribute('open');
  }

  // Two explicit modes: "compatible" uses the browser recognition service (which
  // may process audio online); "offline" requires verified on-device recognition.
  // Older Safari exposes webkitSpeechRecognition but NOT SpeechRecognition.available().
  // Therefore requiring available() for *both* modes previously blocked all commands.
  function setVoiceStatus(message, state) {
    if (state) model.voiceState = state;
    dom.voiceStatus.textContent = message;
    updateVoiceUI();
  }
  function updateVoiceUI() {
    const on = model.voiceEnabled;
    const busy = model.voiceChecking;
    dom.voiceButton.textContent = on ? 'Turn off voice commands' : 'Enable voice commands';
    dom.voiceButton.setAttribute('aria-pressed', String(on));
    dom.voiceButton.disabled = busy;
    dom.voiceCompatibleMode.checked = model.voiceMode === 'compatible';
    dom.voiceOfflineMode.checked = model.voiceMode === 'offline';
    dom.voiceCompatibleMode.disabled = on || busy;
    dom.voiceOfflineMode.disabled = on || busy;
    dom.voiceWorkoutButton.textContent = on ? 'Mic: ON · tap to turn off' : 'Mic: OFF · tap to enable';
    dom.voiceWorkoutButton.setAttribute('aria-pressed', String(on));
    dom.voiceWorkoutButton.disabled = busy;
    let status;
    if (!on && model.voiceState === 'error') status = dom.voiceStatus.textContent;
    else if (!on) status = 'Voice OFF — use the START / STOP buttons';
    else if (model.voiceSpeechHold) status = 'Mic paused for spoken announcement';
    else if (document.visibilityState === 'hidden') status = 'Mic paused while app is in background';
    else if (model.voiceState === 'listening') status = '● Listening — say START or STOP';
    else if (model.voiceState === 'error') status = 'Mic error — toggle voice to retry';
    else status = 'Mic connecting…';
    dom.voiceWorkoutStatus.textContent = status;
    dom.voiceWorkoutStatus.dataset.state = on && model.voiceState === 'listening' ? 'listening' : 'other';
    dom.voiceLastHeard.textContent = model.voiceLastHeard ? `Last heard: “${model.voiceLastHeard}”` : 'No command heard yet.';
  }
  function recognizeCommand(transcript) {
    if (!model.voiceEnabled || model.voiceSpeechHold || Date.now() < model.voiceQuietUntil) return;
    const words = transcript.toLowerCase().trim().replace(/[.!?,:;]/g, ' ').replace(/\s+/g, ' ').trim();
    model.voiceLastHeard = words.slice(0, 100);
    updateVoiceUI();
    // Resist stray words and speech generated by announcements: require a short command.
    const matched = words.match(/^(?:hey move\s+)?(start|stop)(?: (?:the |my )?(?:timer|exercise|workout))?(?: now)?$/);
    if (!matched) {
      setVoiceStatus(`Heard “${words}”. Please say just START or STOP.`, 'listening');
      return;
    }
    const command = matched[1];
    if (Date.now() - model.voiceLastCommandAt < 700) return; // duplicate final events
    model.voiceLastCommandAt = Date.now();
    setVoiceStatus(`✓ Heard ${command.toUpperCase()}.`, 'listening');
    if (command === 'start' && (model.phase === 'setup' || model.phase === 'review')) startExercise();
    else if (command === 'stop' && model.phase === 'running') stopExercise();
    else setVoiceStatus(`Heard ${command.toUpperCase()}, but it is not valid at this stage.`, 'listening');
  }
  function clearVoiceRestartTimers() {
    if (model.voiceRestartTimer !== null) clearTimeout(model.voiceRestartTimer);
    if (model.voiceStartWatchdog !== null) clearTimeout(model.voiceStartWatchdog);
    model.voiceRestartTimer = model.voiceStartWatchdog = null;
  }
  function stopVoiceRecognition() {
    clearVoiceRestartTimers();
    const rec = model.voiceRecognition;
    model.voiceRecognition = null;
    if (rec) {
      rec.onend = null; rec.onerror = null; rec.onresult = null; rec.onstart = null;
      try { rec.abort(); } catch (_) {}
    }
  }
  function scheduleVoiceRestart(delay = 800) {
    if (!model.voiceEnabled || model.voiceChecking || model.voiceSpeechHold ||
        model.phase === 'complete' || document.visibilityState === 'hidden') return;
    if (model.voiceRestartTimer !== null) clearTimeout(model.voiceRestartTimer);
    model.voiceRestartTimer = setTimeout(() => {
      model.voiceRestartTimer = null;
      if (model.voiceEnabled && !model.voiceRecognition && !model.voiceSpeechHold)
        initRecognizer();
    }, delay);
    model.voiceState = 'connecting'; updateVoiceUI();
  }
  function disableVoice(message = 'Voice OFF. On-screen START and STOP work without internet.') {
    model.voiceEnabled = false; model.voiceChecking = false; model.voiceSpeechHold = false;
    stopVoiceRecognition();
    setVoiceStatus(message, 'off');
  }
  function fatalVoiceError(reason) {
    const messages = {
      'not-allowed': 'Microphone or speech recognition blocked. Allow microphone and speech recognition for this site in your phone settings, then try again.',
      'service-not-allowed': 'Speech service disabled by the browser or device. Check speech recognition permissions.',
      'audio-capture': 'No microphone input. Close other apps using your mic, check permissions, then try again.',
      'language-not-supported': 'English recognition is unavailable in this mode. Try Compatible mode.',
      'network': 'This speech service requires internet. Connect to Wi-Fi/mobile data or try Offline-only mode.',
      'phrases-not-supported': 'The browser does not support this recognition setup.'
    };
    disableVoice(messages[reason] || `Speech recognition failed (${reason}). Use START / STOP buttons.`);
    model.voiceState = 'error'; updateVoiceUI();
  }
  function initRecognizer() {
    if (!SpeechRec || !model.voiceEnabled || model.voiceRecognition || model.voiceChecking ||
        model.voiceSpeechHold || document.visibilityState === 'hidden' || model.phase === 'complete') return;
    let rec;
    try { rec = new SpeechRec(); }
    catch (_) {fatalVoiceError('unsupported'); return;}
    rec.lang = VOICE_LANG;
    // iOS Safari usually delivers one phrase then ends, even in continuous mode.
    // Restart automatically for every completed phrase on that platform.
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    rec.continuous = !isIOS;
    rec.interimResults = false; rec.maxAlternatives = 1;
    if ('processLocally' in rec) rec.processLocally = model.voiceMode === 'offline';
    model.voiceRecognition = rec;
    model.voiceState = 'connecting'; updateVoiceUI();
    rec.onstart = () => {
      if (model.voiceRecognition !== rec) return;
      if (model.voiceStartWatchdog !== null) clearTimeout(model.voiceStartWatchdog);
      model.voiceStartWatchdog = null;
      model.voiceRestartFailures = 0;
      setVoiceStatus(`● Listening (${model.voiceMode === 'offline' ? 'on-device' : 'compatible'}). Say START or STOP.`, 'listening');
    };
    rec.onresult = event => {
      if (model.voiceRecognition !== rec) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const alternative = event.results[i][0];
          recognizeCommand(alternative ? alternative.transcript || '' : '');
        }
      }
    };
    rec.onerror = event => {
      if (model.voiceRecognition !== rec) return;
      const reason = event.error || 'unknown';
      if (['not-allowed','service-not-allowed','audio-capture','language-not-supported','network'].includes(reason)) {
        fatalVoiceError(reason);
      } else if (reason !== 'no-speech' && reason !== 'aborted') {
        setVoiceStatus(`Listening interrupted (${reason}); attempting to reconnect…`, 'connecting');
      }
    };
    rec.onend = () => {
      if (model.voiceRecognition !== rec) return;
      model.voiceRecognition = null;
      if (model.voiceStartWatchdog !== null) clearTimeout(model.voiceStartWatchdog);
      model.voiceStartWatchdog = null;
      if (model.voiceEnabled && !model.voiceSpeechHold) {
        setVoiceStatus('Reconnecting microphone…', 'connecting');
        scheduleVoiceRestart(isIOS ? 900 : 450);
      }
    };
    try {
      // Recognition.start() is made in direct response to the enable-button tap
      // for Compatible mode, preserving browser user activation / permissions.
      rec.start();
      model.voiceStartWatchdog = setTimeout(() => {
        if (model.voiceRecognition !== rec || model.voiceState === 'listening') return;
        model.voiceRestartFailures++;
        stopVoiceRecognition();
        if (model.voiceRestartFailures >= 3) fatalVoiceError('recognition did not start');
        else {setVoiceStatus('Microphone did not start; retrying…', 'connecting'); scheduleVoiceRestart(1200);}
      }, 5000);
    } catch (error) {
      model.voiceRecognition = null;
      model.voiceRestartFailures++;
      if (model.voiceRestartFailures >= 3) fatalVoiceError(error.name || 'startup error');
      else {setVoiceStatus(`Microphone startup issue (${error.name || 'unknown'}); retrying…`, 'connecting'); scheduleVoiceRestart(900);}
    }
  }
  async function enableVoice() {
    if (model.voiceChecking) return;
    if (model.voiceEnabled) {disableVoice(); return;}
    if (!window.isSecureContext || !SpeechRec) {
      setVoiceStatus('Voice recognition is not available in this browser or connection. Use HTTPS and Safari / Chrome, or use the on-screen controls.', 'error');
      return;
    }
    if (model.voiceMode === 'compatible') {
      // Critical fix: never require available() in compatibility mode. In Safari,
      // webkitSpeechRecognition can work although available() is absent.
      model.voiceEnabled = true;
      model.voiceRestartFailures = 0;
      model.voiceLastHeard = '';
      setVoiceStatus('Requesting microphone access. Please allow it when prompted.', 'connecting');
      initRecognizer();
      return;
    }
    if (typeof SpeechRec.available !== 'function') {
      setVoiceStatus('This browser does not support verified offline speech recognition. Choose Compatible mode (internet may be needed) or use the touch buttons.', 'error');
      return;
    }
    model.voiceChecking = true; updateVoiceUI();
    setVoiceStatus('Checking for an on-device English speech model…', 'connecting');
    try {
      let status = await SpeechRec.available({langs:[VOICE_LANG], processLocally:true});
      if (status === 'downloadable') {
        setVoiceStatus('Installing the optional offline English speech model. Internet needed once…');
        if (typeof SpeechRec.install !== 'function' || !(await SpeechRec.install({langs:[VOICE_LANG]})))
          throw new Error('offline language pack could not be installed');
        status = await SpeechRec.available({langs:[VOICE_LANG], processLocally:true});
      }
      if (status === 'downloading') throw new Error('language pack is downloading; please try again shortly');
      if (status !== 'available') throw new Error('no on-device English model is available');
      model.voiceEnabled = true;
      model.voiceRestartFailures = 0;
      model.voiceLastHeard = '';
      setVoiceStatus('Local language model ready. Requesting microphone access…', 'connecting');
    } catch (error) {
      setVoiceStatus(`Offline voice unavailable (${error.message || 'unsupported'}). Try Compatible mode.`, 'error');
    } finally {model.voiceChecking = false; updateVoiceUI();}
    if (model.voiceEnabled) initRecognizer();
  }
  function init() {
    loadSavedData();
    for (let i = 1; i <= 8; i++) {
      const option = document.createElement('option'); option.value = String(i);
      option.textContent = `${i} round${i === 1 ? '' : 's'}`; dom.roundCount.append(option);
    }
    dom.roundCount.addEventListener('change', changeRoundCount);
    dom.copyRoundToggle.addEventListener('change', () => {
      model.copyRoundOne = dom.copyRoundToggle.checked;
      // ON replaces other round lists with Round 1. OFF leaves them independently editable.
      afterRoutineEdit();
    });
    dom.editRoundOneButton.addEventListener('click', () => {model.selectedRound = 0; renderSetup();});
    dom.addExerciseBtn.addEventListener('click', () => {
      const round = model.rounds[model.selectedRound];
      if ((model.copyRoundOne && model.selectedRound > 0) || round.length >= 10) return;
      round.push('wall-sit'); afterRoutineEdit();
      const selects = dom.exerciseRows.querySelectorAll('select');
      if (selects.length) selects[selects.length - 1].focus();
    });
    dom.gongToggle.addEventListener('change', () => {model.gong = dom.gongToggle.checked; saveSettings();});
    dom.announceToggle.addEventListener('change', () => {model.announce = dom.announceToggle.checked; saveSettings();});
    dom.beginButton.addEventListener('click', startExercise);
    dom.stopButton.addEventListener('click', stopExercise);
    dom.nextButton.addEventListener('click', startExercise);
    dom.exitButton.addEventListener('click', () => {
      if (model.phase === 'running' && !window.confirm('Exit this workout? Its incomplete results will not be added to history.')) return;
      backToSetup();
    });
    dom.newWorkoutButton.addEventListener('click', backToSetup);
    dom.voiceButton.addEventListener('click', () => {void enableVoice();});
    dom.voiceWorkoutButton.addEventListener('click', () => {void enableVoice();});
    dom.voiceCompatibleMode.addEventListener('change', () => {model.voiceMode = 'compatible'; saveSettings(); updateVoiceUI();});
    dom.voiceOfflineMode.addEventListener('change', () => {model.voiceMode = 'offline'; saveSettings(); updateVoiceUI();});
    dom.historyButton.addEventListener('click', openHistory);
    dom.historyFinishedButton.addEventListener('click', openHistory);
    dom.historyCloseButton.addEventListener('click', closeHistory);
    dom.historyDialog.addEventListener('click', event => {if (event.target === dom.historyDialog) closeHistory();});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        if (model.voiceEnabled) {stopVoiceRecognition(); model.voiceState = 'connecting'; updateVoiceUI();}
        return;
      }
      if (model.voiceEnabled) scheduleVoiceRestart(800);
      if (model.wakeDeadline && Date.now() >= model.wakeDeadline) clearFinalWakeHold();
      else if (model.phase === 'running' || model.phase === 'review' ||
               (model.wakeDeadline && Date.now() < model.wakeDeadline)) void acquireWakeLock();
    });
    document.addEventListener('keydown', event => {
      if (event.code !== 'Space' || event.repeat || event.target.closest('button,select,input,textarea,summary')) return;
      if (model.phase === 'running') {event.preventDefault(); stopExercise();}
      else if (model.phase === 'review') {event.preventDefault(); startExercise();}
    });
    renderSetup(); updateVoiceUI(); showScreen('setup');
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', {updateViaCache:'none'}).catch(() => {});
      });
    }
  }
  init();
})();
