# Jersey Rhythm: Jersey Club Edition

A mobile-first, four-lane tap-and-hold rhythm game built around Jersey club
music. Playable directly in the app (zero-build) or served with Node + Vite.

## Run

```
npm install
npm start          # builds the client, copies media, serves game + board on port 5000
npm run dev        # same as npm start
npm run dev:watch  # Vite dev server with hot reload on port 5000
```

The in-app version needs no server: `index.html` at the project root loads the
game from source using the bundled modules in `vendor/`.

## How it plays

- **Input** — keys 1 2 3 4 (or D F J K) on a keyboard. On touch, tap anywhere in
  a lane. Lanes support multi-touch and sliding between lanes.
- **Timing** — perfect ±45ms, great ±85ms, good ±130ms, miss at 160ms. Judgement
  uses the timestamp of the tap itself, not the last frame.
- **Holds** — grab the head, then keep the lane down while the ribbon burns to
  the receptor. Releasing pauses the count for 220ms; press again to re-grab.
  The tail is judged by coverage: ≥90% perfect, ≥60% great, ≥30% good.
- **Score** — 100 / 75 / 50 base points with a combo multiplier from ×1 to ×4.
  Accuracy is weighted separately (100 / 90 / 72) and drives the grade.
- **Ready lead** — the music starts the moment the count-in ends, scheduled on
  the AudioContext clock, far enough into the track that the first gem still
  has its whole fall ahead of it. No silent run-in after the countdown.
- **Vibe** — misses and snapped holds drain it. At zero the run fails.

Grades: S+ ≥98% with no misses, S ≥95, A ≥88, B ≥78, C ≥68, D below.

## Charts

Charts are generated from the audio in the browser: onset detection, tempo
estimate, a drift-tracking beat grid, then notes on 16th-note grid points where
the music actually has an onset. A bar's density follows the song's energy
(breaks stay empty, drops get runs), each 4-bar phrase keeps one lane pattern and
repeats it mirrored, and the kick holds an anchor lane. Holds only appear on
sustained sounds. Analysis is cached per song; **WATCH** on the start screen
autoplays a chart so you can judge it without playing. Shipped chart files remain
selectable in Settings → Chart source.

The mapper research, the audit of the old beatmaps and the exact rules are in
`CHARTS.md`; the red-team pass is `REDTEAM.md`.

## Leaderboards

This release is **single-player**: every run is saved on the device that
played it. Each song and difficulty shows your best grade and score, and the
Profile screen collects your recent runs and hit counts.

**Shared boards are a coming-soon screen.** A global board needs somewhere to
store scores, and GitHub Pages serves static files only — so the board code in
`server/serve.js` stays parked until the game earns a backend.

## Battles (1v1, spectating, chat)

**Coming soon.** The screen is a placeholder in this build: 1v1 rooms,
spectating, room chat and the synced start clock all need a live server, so
they are switched off rather than half-working. The implementation is still in
`client/src/app/BattlePages.jsx` and `server/serve.js` and can be turned back on
by pointing the app at that server.

## Hosting

**This repository stays private.** The public game is a separate, public
repository that receives nothing but the built files — `client/dist`, which is
the HTML, the bundled JS/CSS, fonts and media. No server code, no docs, no git
history and no source module tree is ever pushed there.

The workflow `.github/workflows/publish.yml` builds on every push to `main` and
force-pushes that build to the public repo's `main` branch, which GitHub Pages
serves directly (no build step on the public side).

One-time setup:

1. Create an **empty public repository** for the site, e.g. `jersey-rhythm`.
2. In that repository: **Settings → Pages → Source: Deploy from a branch →
   `main` / (root)**.
3. Back here: **Settings → Secrets and variables → Actions**
   - secret `PUBLIC_REPO_TOKEN` — a fine-grained token with **Contents: Read and
     write** on the public repository only;
   - variable `PAGES_PUBLIC_REPO` — `owner/repo` of the public site.

The build uses `/<public-repo>/` as its base path automatically (or `/` if the
public repo is `<user>.github.io`). The game is then served at
`https://<user>.github.io/<public-repo>/`.

The container below is optional, for when battles and the shared board come
back. It runs as its own Compose project, network, volume and container user,
published on loopback only, so it is isolated from another site on the same box:

```bash
docker compose -p jersey-rhythm up -d --build
```

Media can stay off that server: build with
`JR_MEDIA_BASE=https://<user>.github.io/<media-repo>` (or set `JR_SLIM_MEDIA` for
an audio-only image). Docker steps, the nginx block, isolation details, backups
and the media-repo recipe are in `DEPLOY.md`.

## Stack

- **Frontend**: React 18 + React Router (hash routing), plain CSS custom
  properties, a canvas play field.
- **Backend**: Node, Express (shared board), Socket.IO (battles, spectating, chat).
- **Storage**: `localStorage` for scores, profile, settings and chart caches.

## Adding songs

Tracks ship with the build. Players cannot add their own audio yet — that is a
planned later feature, and `client/src/lib/uploadedSongs.js` is parked for it.

To add a track: drop `Artist - Title.mp3` into `media/imports/` (optionally an
`.mp4` video, an image cover and a `.beatmap.json`), then run:

```
node scripts/importSongs.js   # regenerates client/src/data/importedSongs.js
```

An mp4 by itself is enough: the game plays its audio track and charts from it,
so a music video with no separate mp3 works.

The Vite build copies `media/` into the bundle's `/media` path. Tracks no longer
need a video or a chart file to be playable — audio plus auto-charting is enough.

The shortlist of jersey club tracks to add next (classics plus current hits,
with YouTube links) is in `SONGS.md`, along with the licensing options for a
public build.

## Project layout

```
index.html               in-app entry point
entry.jsx                React bootstrap
runtime.js               zero-build JSX module loader
client/src/app/          App shell, screens and gameplay
client/src/app/gameplay/ field engine + canvas renderer
client/src/lib/          chart generation + shared board client
client/src/data/         song library
server/                  board API + realtime battle server
scripts/                 media import helpers
```

House rules for anyone (human or agent) changing this repo live in
`.claude/skills/ai-slop/SKILL.md` — the anti-slop gate: what counts as a finished
change, the banned writing and visual patterns, and the verification protocol.

See `AUDIT.md` for the deep review, `CHARTS.md` for charting, `REDTEAM.md` for
the red-team pass, `RESEARCH.md` for the rhythm-game and Jersey club research
that drove the dance crew, `PLAN.md` for the build board, and `DESIGN.md` for the
visual/gameplay decisions.
