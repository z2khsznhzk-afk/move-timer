MOVE TIMER — VERSION 4 / VOICE-CONTROL FIX (28 NOVEMBER 2026)
==============================================================

WHAT'S INCLUDED
- Freeform START/STOP stopwatch; running time is hidden until STOP.
- 1–8 rounds, up to 10 ordered exercises per round; copy Round 1 into all rounds.
- 5-second delay before the next exercise/round is announced.
- Final exercise triggers an immediate voice completion message.
- Gong, spoken names, moving colored exercise name, personal-best time.
- History of the 10 most recent completed workouts, opened by button.
- Screen wake-lock request while training + 1 minute after final exercise.
- All workout controls and locally saved records work offline.
- Voice recognition in either Compatible mode OR Offline-only mode (device support required).

IMPORTANT VOICE-CONTROL FIXES
The previous app required SpeechRecognition.available() for all voice recognition.
This blocks Safari and other browsers that can recognize speech but don't support
that new optional API. Version 4 lets you choose:

COMPATIBLE MODE (recommended for iPhone/Safari and most phones):
- Enable it from Sound & voice > Hands-free START/STOP and allow microphone access.
- The browser is allowed to use its normal recognition engine, which may send
  audio to an online speech service. Internet may be required.
- This mode is OPTIONAL and only starts after you tap Enable.
- It does not compromise offline use of the stopwatch/touch controls.

OFFLINE ONLY MODE:
- Uses ONLY a verified on-device recognition engine.
- Requires a browser implementing SpeechRecognition.available() and
  SpeechRecognition.processLocally, with a local English model installed.
- If unsupported, the app explains why rather than silently failing.
- If a local model is downloadable, one initial download may be necessary.

Voice recognition and text-to-speech are different features. Spoken exercise
announcements can work without voice recognition; local TTS voices may be required
offline. Neither voice-control mode is guaranteed on every iPhone/Android version.

HOW TO TEST SPEECH COMMANDS ON YOUR PHONE
1. Open your MOVE GitHub Pages website in Safari (iPhone) or Chrome (Android)
   while online. Do this in the browser first if the Home Screen version fails.
2. Under Sound & voice, select COMPATIBLE and tap Enable voice commands.
3. Accept the phone's microphone and speech recognition permission prompts.
4. Check for "Listening". Say clearly: "START". The first exercise should begin.
5. After the exercise name is spoken, wait for "Listening" again and say "STOP".
6. The elapsed time must appear. After five seconds, hear "Next up...".
7. Watch the mic label near the workout buttons; tap it to turn voice on/off.
8. The voice box shows the last phrase recognized for troubleshooting.

IF YOU STILL GET NO VOICE RESPONSE
- Check whether the app displays "Listening". If not, follow its error message.
- iPhone: check Settings > Privacy & Security > Microphone and Speech Recognition,
  plus the Safari website-specific microphone permission where available.
- Android: Chrome > Settings > Site settings > Microphone and Android app permissions.
- Leave the app in the foreground with the display awake. Other apps may grab the mic.
- If using Compatible mode, try with internet access; the browser may use a server.
- Try the browser's regular tab instead of the installed Home Screen web app.
- Use the touch START / STOP controls if your device's browser won't recognize speech.
- After GitHub deployment, reload while online so the v4 service worker updates.
- Not all iOS Safari combinations reliably restart recognition after speech output;
  the app retries automatically but underlying operating-system limits remain.

INSTALL / UPDATE ON GITHUB PAGES
1. Unzip MOVE_Timer_v4_GitHub.zip.
2. In your EXISTING GitHub repository (e.g. move-timer), upload all files from
   inside this ZIP (index.html, app.js, style.css, service-worker.js,
   manifest.webmanifest, both PNG icons, this README).
3. Commit changes on main; Settings > Pages remains main + /(root).
4. Reopen your existing GitHub Pages URL while online, refresh once, then reopen
   the Home Screen app. The service-worker cache is upgraded to version 4.
5. Do NOT delete the old repository or clear site storage, because previous
   routines (including original routines), personal bests and workout history
   are retained in localStorage. They are tied to the same web origin/device.

TESTED
- Browser-simulation tests with a mocked speech recognition service:
  recognized START / STOP, including punctuation; recognizer resumed after
  spoken output; next-exercise cue after 5 s; immediate final-round cue;
  automatic restart on end; microphone-denied feedback; compatibility when
  available() is absent; safe handling of unsupported offline-only speech.
- UI tested in a mobile-sized Chromium environment.
- Live microphone recognition on YOUR device is not testable from here;
  please use the steps above. Service-worker offline caching is implemented.

TECHNICAL: privacy/storage
Workout routines, personal bests, history are stored locally on the phone.
The Compatible voice option may require third-party browser speech processing;
if this is unacceptable, choose Offline-only mode or the touch buttons.
