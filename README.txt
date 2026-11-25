MOVE TIMER — Offline mobile exercise stopwatch (voice transitions)

WHAT'S NEW
• When you STOP an exercise: “Next up, [exercise name].”
• When you finish a round: “Round [number] finished, coming up round [next number]. Next up, [exercise name].”
• When you finish the last round: “Round [number] finished. Final round complete. Workout finished.”
• Messages are spoken only if Spoken announcements is enabled.

QUICK START
1. Choose 1–8 rounds.
2. Select the exercises and their sequence independently in each round.
3. Tap Start workout or say “start” where offline voice recognition is supported.
4. The timer is hidden while the exercise runs. Tap or say “stop” to show elapsed time and hear what comes next.
5. Tap or say “start” again to begin the next exercise.
6. The screen wake lock is requested during the workout and for 60 seconds after the final exercise, where supported.

INSTALL AS AN OFFLINE HOME-SCREEN APP
1. Upload all files in this folder together to an HTTPS web host (or use localhost while testing).
2. Open index.html online once on the mobile device to populate the offline cache.
3. Add the page to your home screen through the browser's Share/Install menu.
4. Subsequent visits can work without internet when the app and its assets are cached.

ALTERNATIVE (NO WEBSITE REQUIRED)
Open the separate move_timer_voice_transitions_standalone.html file directly on your device.
This standalone version includes the application JavaScript and CSS in one HTML file,
but may not offer home-screen installation, depending on your phone/browser.

DEVICE LIMITATIONS
• Spoken announcements use the browser's speech-synthesis engine. For reliable offline voice playback, an installed on-device English voice is needed; not every phone/browser guarantees offline speech.
• Hands-free start/stop uses only on-device speech recognition and is available in some browser versions; it is not universally supported and may require a language pack to be installed while online.
• Touch START and STOP always work, even without voice recognition.
• Keep-screen-awake depends on the browser's Screen Wake Lock API, an active/visible page, and device power settings. Not guaranteed on all mobile devices.
• Neither timing nor exercise order has preset durations or needs network communication.
