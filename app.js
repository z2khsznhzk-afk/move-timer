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
  const CHOICE_MAP = Object.fromEntries(CHOICES.map(item => [item.id, item.label]));
  const STORE_KEY = 'move-freeform-routines-v1';
  const VOICE_LANG = 'en-US';
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const dom = Object.fromEntries([
    'setupScreen', 'workoutScreen', 'completeScreen', 'roundCount', 'roundTabs',
    'roundHeading', 'exerciseCount', 'exerciseRows', 'addExerciseBtn', 'gongToggle',
    'announceToggle', 'voiceButton', 'voiceStatus', 'routineSummary', 'beginButton',
    'roundProgress', 'exerciseProgress', 'liveIndicator', 'activeStage', 'reviewStage',
    'floatingName', 'reviewName', 'resultTime', 'nextCue', 'stopButton', 'nextButton',
    'workoutHint', 'exitButton', 'wakeStatus', 'finishDescription', 'completedRounds',
    'completedExercises', 'totalElapsed', 'resultsList', 'postWorkoutNote',
    'newWorkoutButton', 'announcer'
  ].map(id => [id, document.getElementById(id)]));

  const model = {
    rounds: [['wall-sit', 'bridge', 'plank']],
    selectedRound: 0,
    gong: true,
    announce: true,
    phase: 'setup', // setup, running, review, complete
    agenda: [],
    currentIndex: 0,
    startedAt: 0,
    results: [],
    lastResult: null,
    wakeLock: null,
    wakeDeadline: 0,
    wakeTimer: null,
    audioContext: null,
    voiceEnabled: false,
    voiceBusy: false,
    voiceRecognition: null,
    voiceRestartTimer: null,
    voiceQuietUntil: 0,
    voiceStatusText: '',
    voiceChecking: false
  };

  function loadSettings() {
    try {
      const loaded = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (Array.isArray(loaded.rounds) && loaded.rounds.length >= 1 && loaded.rounds.length <= 8 &&
          loaded.rounds.every(round => Array.isArray(round) && round.length >= 1 && round.length <= 10 &&
            round.every(choice => Object.prototype.hasOwnProperty.call(CHOICE_MAP, choice)))) {
        model.rounds = loaded.rounds.map(round => [...round]);
      }
      if (typeof loaded.gong === 'boolean') model.gong = loaded.gong;
      if (typeof loaded.announce === 'boolean') model.announce = loaded.announce;
    } catch (_) { /* Private browsing may block storage. */ }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({rounds:model.rounds,gong:model.gong,announce:model.announce})); }
    catch (_) { /* Timer remains fully functional without storage. */ }
  }

  function notify(text) { dom.announcer.textContent = text; }
  function formatted(ms) {
    const deciseconds = Math.max(0, Math.floor(ms / 100));
    const hours = Math.floor(deciseconds / 36000);
    const minutes = Math.floor(deciseconds / 600) % 60;
    const seconds = Math.floor(deciseconds / 10) % 60;
    const tenth = deciseconds % 10;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2,'0')}.${tenth}`
      : `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${tenth}`;
  }
  function exerciseLabel(id) { return CHOICE_MAP[id] || id; }
  function optionHTML(selected) {
    return CHOICES.map(choice => `<option value="${choice.id}"${choice.id === selected ? ' selected' : ''}>${choice.label}</option>`).join('');
  }
  function totalExercises() { return model.rounds.reduce((sum, round) => sum + round.length, 0); }

  function renderRoundTabs() {
    dom.roundTabs.replaceChildren();
    model.rounds.forEach((_, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'round-tab';
      button.textContent = `Round ${index+1}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(index === model.selectedRound));
      button.addEventListener('click', () => { model.selectedRound = index; renderSetup(); });
      dom.roundTabs.append(button);
    });
  }
  function renderExerciseRows() {
    const round = model.rounds[model.selectedRound];
    dom.roundHeading.textContent = `ROUND ${model.selectedRound + 1}`;
    dom.exerciseCount.textContent = `${round.length} EXERCISE${round.length > 1 ? 'S' : ''}`;
    dom.exerciseRows.replaceChildren();
    round.forEach((exercise, index) => {
      const wrapper = document.createElement('div'); wrapper.className = 'exercise-row';
      const n = document.createElement('span'); n.className = 'exercise-index'; n.textContent = String(index+1).padStart(2, '0');
      const selectWrap = document.createElement('div'); selectWrap.className = 'select-wrap exercise-select-wrap';
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Round ${model.selectedRound + 1}, exercise ${index + 1}`);
      select.innerHTML = optionHTML(exercise);
      select.addEventListener('change', () => { round[index] = select.value; saveSettings(); });
      selectWrap.append(select);
      const moveContainer = document.createElement('div'); moveContainer.className = 'move-btns';
      const up = document.createElement('button'); up.type = 'button'; up.className = 'move-btn'; up.textContent = '↑';
      up.title = 'Move exercise up'; up.setAttribute('aria-label', `Move exercise ${index+1} up`); up.disabled = index === 0;
      up.addEventListener('click', () => { [round[index-1], round[index]] = [round[index], round[index-1]]; saveSettings(); renderExerciseRows(); });
      const down = document.createElement('button'); down.type = 'button'; down.className = 'move-btn'; down.textContent = '↓';
      down.title = 'Move exercise down'; down.setAttribute('aria-label', `Move exercise ${index+1} down`); down.disabled = index === round.length-1;
      down.addEventListener('click', () => { [round[index+1], round[index]] = [round[index], round[index+1]]; saveSettings(); renderExerciseRows(); });
      moveContainer.append(up, down);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-btn';
      remove.textContent = '×'; remove.title = 'Remove exercise';
      remove.setAttribute('aria-label', `Remove exercise ${index+1}`); remove.disabled = round.length === 1;
      remove.addEventListener('click', () => { round.splice(index,1); saveSettings(); renderSetup(); });
      wrapper.append(n, selectWrap, moveContainer, remove); dom.exerciseRows.append(wrapper);
    });
    dom.addExerciseBtn.disabled = round.length >= 10;
    dom.addExerciseBtn.textContent = round.length >= 10 ? 'Maximum 10 exercises per round' : '＋ Add exercise';
  }
  function renderSetup() {
    dom.roundCount.value = String(model.rounds.length);
    dom.gongToggle.checked = model.gong;
    dom.announceToggle.checked = model.announce;
    renderRoundTabs(); renderExerciseRows();
    const n = totalExercises();
    dom.routineSummary.textContent = `${model.rounds.length} ROUND${model.rounds.length === 1 ? '' : 'S'} · ${n} EXERCISE${n === 1 ? '' : 'S'}`;
  }

  function onChangeRoundCount() {
    const wanted = Math.max(1, Math.min(8, Number(dom.roundCount.value) || 1));
    // New rounds start independently with one exercise; nothing is cloned.
    while (model.rounds.length < wanted) model.rounds.push(['wall-sit']);
    model.rounds.length = wanted;
    model.selectedRound = Math.min(model.selectedRound, wanted-1);
    saveSettings(); renderSetup();
  }
  function showScreen(screen) {
    dom.setupScreen.hidden = screen !== 'setup';
    dom.workoutScreen.hidden = screen !== 'workout';
    dom.completeScreen.hidden = screen !== 'complete';
    window.scrollTo({top:0,behavior:'instant'});
  }
  function makeAgenda() {
    return model.rounds.flatMap((round, roundIndex) => round.map((id, exerciseIndex) => ({id, roundIndex, exerciseIndex})));
  }

  function unlockAudio() {
    if (!model.audioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { model.audioContext = new AC(); } catch (_) {} }
    }
    if (model.audioContext && model.audioContext.state === 'suspended') {
      model.audioContext.resume().catch(() => {});
    }
  }
  function gong() {
    if (!model.gong || !model.audioContext) return;
    try {
      const ctx = model.audioContext;
      const t = ctx.currentTime + .015;
      const partials = [{f:220,amp:.18,decay:2.4},{f:332,amp:.12,decay:2.0},{f:447,amp:.07,decay:1.7},{f:564,amp:.035,decay:1.5},{f:733,amp:.025,decay:1.1}];
      partials.forEach(({f,amp,decay}) => {
        const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(f, t);
        gain.gain.setValueAtTime(.0001,t);
        gain.gain.exponentialRampToValueAtTime(amp,t+.018);
        gain.gain.exponentialRampToValueAtTime(.0001,t+decay);
        oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(t); oscillator.stop(t+decay+.04);
      });
    } catch (_) { /* Audio support is optional. */ }
  }
  function say(message) {
    if (!model.announce || !('speechSynthesis' in window)) return;
    try {
      // Ignore START/STOP recognition while this app is speaking. Long round
      // transitions can exceed the previous two-second suppression window.
      const estimatedSpeechMs = Math.max(2800, message.length * 100);
      model.voiceQuietUntil = Date.now() + estimatedSpeechMs;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'en-US'; utterance.rate = .94; utterance.pitch = 1;
      utterance.onstart = () => { model.voiceQuietUntil = Date.now() + estimatedSpeechMs; };
      utterance.onend = () => { model.voiceQuietUntil = Date.now() + 600; };
      utterance.onerror = () => { model.voiceQuietUntil = Date.now() + 600; };
      window.speechSynthesis.speak(utterance);
    } catch (_) { /* The workout should never depend on spoken output. */ }
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || typeof navigator.wakeLock.request !== 'function') {
      dom.wakeStatus.textContent = 'Keep-awake not supported here; keep the phone active.';
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
        if (model.phase === 'running' || model.phase === 'review' || (model.phase === 'complete' && Date.now() < model.wakeDeadline)) {
          dom.wakeStatus.textContent = 'Screen wake lock paused; keep app foregrounded.';
        }
      });
    } catch (_) {
      dom.wakeStatus.textContent = 'Unable to keep the screen awake on this browser.';
    }
  }
  async function releaseWakeLock() {
    const sentinel = model.wakeLock; model.wakeLock = null;
    if (sentinel) { try { await sentinel.release(); } catch (_) {} }
    dom.wakeStatus.textContent = 'Keep-awake finished';
    if (model.phase === 'complete') dom.postWorkoutNote.textContent = 'The one-minute keep-awake period has ended. Your results remain available.';
  }
  function cancelWakeHold() {
    if (model.wakeTimer) { clearTimeout(model.wakeTimer); model.wakeTimer = null; }
    model.wakeDeadline = 0;
    void releaseWakeLock();
  }
  function scheduleFinalWakeHold() {
    model.wakeDeadline = Date.now() + 60_000;
    if (model.wakeTimer) clearTimeout(model.wakeTimer);
    dom.postWorkoutNote.textContent = 'Keeping the screen awake for 1 minute after your final exercise.';
    model.wakeTimer = setTimeout(() => { model.wakeTimer = null; void releaseWakeLock(); }, 60_000);
  }

  function startExercise() {
    if (model.phase === 'complete' || model.phase === 'running') return;
    unlockAudio();
    if (model.phase === 'setup') {
      model.agenda = makeAgenda();
      model.currentIndex = 0;
      model.results = [];
      model.lastResult = null;
      cancelWakeHold();
    }
    if (model.currentIndex >= model.agenda.length) return;
    model.startedAt = performance.now();
    model.phase = 'running';
    const item = model.agenda[model.currentIndex];
    dom.roundProgress.textContent = `${item.roundIndex+1} / ${model.rounds.length}`;
    dom.exerciseProgress.textContent = `${item.exerciseIndex+1} / ${model.rounds[item.roundIndex].length}`;
    dom.floatingName.textContent = exerciseLabel(item.id);
    dom.liveIndicator.innerHTML = '<span class="red-dot"></span> IN PROGRESS';
    dom.activeStage.hidden = false; dom.reviewStage.hidden = true;
    dom.stopButton.hidden = false; dom.nextButton.hidden = true;
    dom.workoutHint.textContent = 'Say “stop” or tap STOP when you’re ready.';
    showScreen('workout');
    void acquireWakeLock();
    gong();
    say(exerciseLabel(item.id));
    notify(`Exercise ${exerciseLabel(item.id)} running. Time hidden.`);
  }
  function stopExercise() {
    if (model.phase !== 'running') return;
    const elapsed = Math.max(0, performance.now() - model.startedAt);
    const item = model.agenda[model.currentIndex];
    model.lastResult = {...item, elapsed};
    model.results.push(model.lastResult);
    const isLastInRound = item.exerciseIndex === model.rounds[item.roundIndex].length - 1;
    model.currentIndex += 1;
    const next = model.agenda[model.currentIndex];
    if (next) {
      // A single spoken phrase avoids cancelling a round-end message when announcing
      // the next exercise. The transition is spoken as soon as STOP is received.
      const nextName = exerciseLabel(next.id);
      let announcement = `Next up, ${nextName}.`;
      if (isLastInRound) {
        announcement = `Round ${item.roundIndex + 1} finished, coming up round ${next.roundIndex + 1}. Next up, ${nextName}.`;
      }
      model.phase = 'review';
      dom.liveIndicator.textContent = '● READY FOR NEXT';
      dom.reviewName.textContent = exerciseLabel(item.id);
      dom.resultTime.textContent = formatted(elapsed);
      dom.nextCue.textContent = isLastInRound
        ? `ROUND ${item.roundIndex + 1} FINISHED · ROUND ${next.roundIndex + 1} NEXT · ${nextName.toUpperCase()}`
        : `NEXT UP · ${nextName.toUpperCase()}`;
      dom.activeStage.hidden = true; dom.reviewStage.hidden = false;
      dom.stopButton.hidden = true; dom.nextButton.hidden = false;
      dom.workoutHint.textContent = 'Say “start” or tap to begin the next exercise.';
      showScreen('workout');
      say(announcement);
      notify(`${exerciseLabel(item.id)} recorded: ${formatted(elapsed)}. ${announcement}`);
    } else {
      // The final round has no next exercise. Announce completion instead.
      model.phase = 'complete';
      scheduleFinalWakeHold();
      renderFinish();
      showScreen('complete');
      say(`Round ${item.roundIndex + 1} finished. Final round complete. Workout finished.`);
      notify(`Final round ${item.roundIndex + 1} finished. Workout complete. ${model.results.length} exercises recorded.`);
    }
  }
  function renderFinish() {
    dom.completedRounds.textContent = String(model.rounds.length);
    dom.completedExercises.textContent = String(model.results.length);
    const total = model.results.reduce((sum, item) => sum + item.elapsed, 0);
    dom.totalElapsed.textContent = formatted(total);
    dom.finishDescription.textContent = `${model.rounds.length} round${model.rounds.length===1?'':'s'} finished · ${model.results.length} exercises recorded. The times are yours to keep.`;
    dom.resultsList.replaceChildren();
    let lastRoundIndex = -1;
    model.results.forEach(item => {
      if (item.roundIndex !== lastRoundIndex) {
        const title = document.createElement('h3'); title.className='round-group-title'; title.textContent=`ROUND ${item.roundIndex+1}`;
        dom.resultsList.append(title); lastRoundIndex=item.roundIndex;
      }
      const row = document.createElement('div'); row.className='history-row';
      const label = document.createElement('span');
      const idx = document.createElement('span'); idx.className='history-index'; idx.textContent=String(item.exerciseIndex+1).padStart(2,'0');
      label.append(idx, document.createTextNode(exerciseLabel(item.id)));
      const value = document.createElement('strong'); value.textContent=formatted(item.elapsed);
      row.append(label,value); dom.resultsList.append(row);
    });
  }
  function backToSetup() {
    model.phase='setup'; model.agenda=[]; model.currentIndex=0; model.startedAt=0;
    cancelWakeHold();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    renderSetup(); showScreen('setup');
  }

  function setVoiceStatus(message) { model.voiceStatusText = message; dom.voiceStatus.textContent = message; }
  function updateVoiceButton() {
    if (model.voiceEnabled) {
      dom.voiceButton.textContent = 'Disable voice commands';
      dom.voiceButton.setAttribute('aria-pressed','true');
    } else {
      dom.voiceButton.textContent = 'Enable offline voice commands';
      dom.voiceButton.setAttribute('aria-pressed','false');
    }
  }
  function voiceRecognized(transcript) {
    if (!model.voiceEnabled || Date.now() < model.voiceQuietUntil) return;
    const normalized = transcript.toLowerCase().trim().replace(/[.!?,]/g,' ').replace(/\s+/g,' ');
    if (['start','start timer','start exercise'].includes(normalized)) {
      if (model.phase === 'setup' || model.phase === 'review') startExercise();
    } else if (['stop','stop timer','stop exercise'].includes(normalized)) {
      if (model.phase === 'running') stopExercise();
    }
  }
  function stopVoiceRecognition() {
    if (model.voiceRestartTimer) {clearTimeout(model.voiceRestartTimer);model.voiceRestartTimer=null;}
    const recognizer = model.voiceRecognition;
    model.voiceRecognition = null;
    if (recognizer) {recognizer.onend=null;recognizer.onerror=null;try {recognizer.abort();} catch (_) {}}
  }
  function disableVoice() {
    model.voiceEnabled=false;
    stopVoiceRecognition();
    updateVoiceButton();
    setVoiceStatus('Voice commands off. On-screen START / STOP controls remain available offline.');
  }
  function initRecognizer() {
    if (!SpeechRec || !model.voiceEnabled || model.voiceRecognition || model.voiceChecking) return;
    const recognizer = new SpeechRec();
    recognizer.lang=VOICE_LANG;
    recognizer.continuous=true;
    recognizer.interimResults=false;
    recognizer.maxAlternatives=1;
    recognizer.processLocally=true;
    recognizer.onstart=()=>{setVoiceStatus('Listening offline. Say exactly “start” or “stop”. Keep the app open.');};
    recognizer.onresult=(event)=>{
      for (let i=event.resultIndex; i<event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        voiceRecognized(event.results[i][0].transcript || '');
      }
    };
    recognizer.onerror=event=>{
      const reason=event.error||'unknown error';
      if (['not-allowed','service-not-allowed','language-not-supported','network','audio-capture'].includes(reason)) {
        model.voiceEnabled=false;
        stopVoiceRecognition(); updateVoiceButton();
        setVoiceStatus(`Offline voice unavailable (${reason}). Use the on-screen START / STOP controls.`);
      } else if (reason!=='no-speech' && reason!=='aborted') {
        setVoiceStatus(`Voice listening interrupted (${reason}); retrying if possible.`);
      }
    };
    recognizer.onend=()=>{
      if (model.voiceRecognition===recognizer) model.voiceRecognition=null;
      if (model.voiceEnabled && !model.voiceChecking) {
        model.voiceRestartTimer=setTimeout(()=>{model.voiceRestartTimer=null;initRecognizer();},350);
      }
    };
    model.voiceRecognition=recognizer;
    try {recognizer.start();} catch (e) {
      model.voiceRecognition=null;
      model.voiceEnabled=false;updateVoiceButton();
      setVoiceStatus('Could not begin offline microphone listening. Use the buttons to control the timer.');
    }
  }
  async function enableVoice() {
    if (model.voiceChecking) return;
    if (model.voiceEnabled) {disableVoice();return;}
    // Deliberately do not fall back to cloud-based browser recognition.
    if (!window.isSecureContext || !SpeechRec || typeof SpeechRec.available !== 'function') {
      setVoiceStatus('This browser cannot verify on-device speech recognition. Voice control is disabled to preserve offline use; START / STOP buttons work offline.');
      updateVoiceButton();return;
    }
    model.voiceChecking=true;
    dom.voiceButton.disabled=true;
    setVoiceStatus('Checking locally installed English speech model…');
    try {
      let state = await SpeechRec.available({langs:[VOICE_LANG],processLocally:true});
      if (state==='downloadable') {
        setVoiceStatus('Installing the optional offline English speech model (one-time internet connection needed)…');
        if (typeof SpeechRec.install !== 'function' || !(await SpeechRec.install({langs:[VOICE_LANG]}))) throw new Error('language pack installation failed');
        state=await SpeechRec.available({langs:[VOICE_LANG],processLocally:true});
      }
      if (state==='downloading') throw new Error('speech model is downloading; try again later');
      if (state!=='available') throw new Error('on-device voice support unavailable');
      model.voiceEnabled=true;
      updateVoiceButton();
      setVoiceStatus('Offline voice model ready. Asking for microphone access…');
    } catch (err) {
      setVoiceStatus(`Offline voice not available (${err.message || 'unsupported'}). Use START / STOP buttons.`);
    } finally {
      model.voiceChecking=false;
      dom.voiceButton.disabled=false;
    }
    if (model.voiceEnabled) initRecognizer();
  }

  function init() {
    loadSettings();
    for(let i=1;i<=8;i++){
      const option=document.createElement('option'); option.value=String(i); option.textContent=`${i} round${i===1?'':'s'}`;
      dom.roundCount.append(option);
    }
    dom.roundCount.addEventListener('change',onChangeRoundCount);
    dom.addExerciseBtn.addEventListener('click',()=>{
      const round=model.rounds[model.selectedRound]; if(round.length>=10)return;
      round.push('wall-sit');saveSettings();renderSetup();
      const selects=dom.exerciseRows.querySelectorAll('select');
      if(selects.length) selects[selects.length-1].focus();
    });
    dom.gongToggle.addEventListener('change',()=>{model.gong=dom.gongToggle.checked;saveSettings();});
    dom.announceToggle.addEventListener('change',()=>{model.announce=dom.announceToggle.checked;saveSettings();});
    dom.beginButton.addEventListener('click',startExercise);
    dom.stopButton.addEventListener('click',stopExercise);
    dom.nextButton.addEventListener('click',startExercise);
    dom.exitButton.addEventListener('click',()=>{
      if (model.phase==='running' && !window.confirm('Exit this workout? The current exercise time will not be saved.')) return;
      backToSetup();
    });
    dom.newWorkoutButton.addEventListener('click',backToSetup);
    dom.voiceButton.addEventListener('click',()=>{void enableVoice();});
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'){
        if(model.phase==='complete' && model.wakeDeadline && Date.now()>=model.wakeDeadline){void releaseWakeLock();}
        else if(model.phase==='running'||model.phase==='review'||(model.phase==='complete' && Date.now()<model.wakeDeadline))void acquireWakeLock();
      }
    });
    // Prevent shortcut keys from triggering forms while the workout is active.
    document.addEventListener('keydown',event=>{
      if(event.code!=='Space' || event.repeat || event.target.closest('button,select,input,textarea'))return;
      if(model.phase==='running'){event.preventDefault();stopExercise();}
      else if(model.phase==='review'){event.preventDefault();startExercise();}
    });
    renderSetup(); updateVoiceButton(); showScreen('setup');
    if ('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
      window.addEventListener('load',()=>{navigator.serviceWorker.register('./service-worker.js').catch(()=>{});});
    }
  }
  init();
})();
