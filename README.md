# Golf Swing Analyzer

A installable, offline-capable PWA for breaking down your golf swing on video. Upload a slow-motion clip (or record one in the browser), then draw lines and angles over it while stepping through frame by frame.

## Features

- **Upload or record**: pick a video from your camera roll, or record directly in the browser.
- **Frame-by-frame stepping**: step forward/back by a single frame (using a configurable source frame rate), scrub with a precise timeline, and play back at 0.1x–1x speed.
- **Drawing tools**: freehand, straight line, arrow, circle marker, and a two-line **angle** tool that computes and labels the angle in degrees (e.g. for spine angle or swing plane).
- **Per-frame annotations**: drawings are tied to the frame they were made on, so stepping through the swing shows the right markup at each position. A toggleable crosshair guide helps with posture alignment.
- **Snapshot export**: save the current frame plus your annotations as a full-resolution PNG.
- **Local library**: swings are saved on-device (IndexedDB) with a thumbnail, so you can revisit and keep annotating later. Nothing is uploaded anywhere.
- **Installable & offline**: add it to your home screen; the app shell is cached by a service worker so it opens without a network connection.

## About slo-mo capture

Browsers can't trigger a phone's hardware slow-motion capture — that's a feature of the native camera app, not something a web page can control. So:

1. Record your swing using your phone's native **Slo-Mo** camera mode.
2. Open this app and use **Upload Video** to import that clip.

The in-app **Record Video** button is a convenience for recording at normal speed directly in the browser (e.g. on a laptop); use the in-app 0.1x–1x playback speed control to review it slowly.

## Running locally

This is a static, dependency-free app — no build step.

```bash
npx http-server -p 8080
# then open http://localhost:8080
```

Or serve the folder with any static file server. For the service worker and camera/microphone access to work, serve over `http://localhost` or `https://`.

## Project structure

```
index.html          Views: library, record, analyzer
manifest.json        PWA manifest
sw.js                 Service worker (app-shell caching)
css/styles.css        Styling
js/db.js               IndexedDB storage for swing sessions
js/canvas-tools.js      Annotation drawing engine
js/app.js               View routing, video playback, wiring
icons/                  App icons
```
