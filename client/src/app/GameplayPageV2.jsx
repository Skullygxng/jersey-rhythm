import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { songs, isPlayableDifficulty } from "../data/songLibrary.js";
import { haptic } from "../../../src/haptics.js";
import { resolveChart, decodeTrackBuffer } from "../lib/autoChart.js";
import { connectSocket, getSocket } from "../lib/socket.js";
import { isAudioOnly } from "../lib/gameConfig.js";
import { GameEngine } from "./gameplay/engine.js";
import { FieldRenderer } from "./gameplay/renderer.js";
import { COUNT_IN_MS, readyLeadFor, startFor, travelFor } from "./gameplay/timing.js";
const DIFFICULTY_ORDER = ["easy", "normal", "hard"];

const COMBO_CHANTS = {
  10: "TURN IT UP!",
  25: "MAKE IT JUMP!",
  50: "GET SILLY!",
  75: "SWING DAT!",
  100: "PATTY CAKE!",
  150: "RIDE THAT WAVE!",
  200: "SOMEBODY SCREAM!",
  250: "LET ME CLEAR MY THROAT!",
  300: "BRICK CITY!"
};

const PROGRESS_CHANTS = [
  { at: 0.5, text: "BRICK CITY!" },
  { at: 0.78, text: "YO JERSEY!" }
];

const KEY_LANES = {
  "1": 0,
  "2": 1,
  "3": 2,
  "4": 3,
  d: 0,
  f: 1,
  j: 2,
  k: 3
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatScore(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

function laneFromKey(key) {
  const lane = KEY_LANES[String(key).toLowerCase()];
  return lane == null ? -1 : lane;
}

export default function GameplayPageV2({
  settings,
  onSaveResult,
  chartOffsets,
  scores,
  playerName
}) {
  const { songId, difficultyId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const battleId = searchParams.get("battle") || "";
  const startParam = Number(searchParams.get("start")) || 0;

  const song = songs.find((item) => item.id === songId);
  const difficulty =
    song?.difficulties?.[difficultyId || "normal"] || song?.difficulties?.normal;
  const chartMode = settings.chartMode === "authored" ? "authored" : "auto";

  const [chartState, setChartState] = useState({
    status: "loading",
    stage: "Reading audio",
    chart: [],
    bpm: Number(difficulty?.bpm) || 140,
    source: chartMode,
    noteCount: 0,
    holdCount: 0,
    startAt: 0
  });

  const [phase, setPhase] = useState("ready");
  const [countdown, setCountdown] = useState("3");
  const [summary, setSummary] = useState(null);
  const [runBest, setRunBest] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [battleState, setBattleState] = useState(null);
  const [battleStartAt, setBattleStartAt] = useState(startParam);
  const [battleNotice, setBattleNotice] = useState("");

  const phaseRef = useRef("ready");
  phaseRef.current = phase;

  const engineRef = useRef(null);
  const rendererRef = useRef(null);
  const canvasRef = useRef(null);
  const fieldRef = useRef(null);
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  // The decoded track and its live source: the AudioContext clock is the
  // master clock for a run (see GAMEFEEL.md).
  const musicBufferRef = useRef(null);
  const musicSourceRef = useRef(null);
  const musicClockRef = useRef(null);
  const audioCtxRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pointerUpRef = useRef(null);
  const lastFrameRef = useRef(0);
  const countdownStartRef = useRef(0);
  const countdownLabelRef = useRef("3");
  const fallbackStartRef = useRef(0);
  const pausedAtRef = useRef(0);
  const lastMilestoneRef = useRef(0);
  const progressChantsRef = useRef({});
  const savedRef = useRef(false);
  const onSaveRef = useRef(onSaveResult);
  const settingsRef = useRef(settings);
  const playerNameRef = useRef(playerName);
  const baseMetaRef = useRef({});
  const loopApi = useRef({});

  const chart = chartState.chart || [];
  const videoUrl = isAudioOnly() ? "" : song?.videoUrl || "";
  const chartBpm = Number(chartState.bpm) || 140;
  const beatMs = 60000 / chartBpm;
  const travelMs = travelFor(difficultyId, settings.noteSpeed);

  const chartKey = (songId || "") + "::" + (difficultyId || "normal");
  const calibration = Number(settings.calibrationOffset) || 0;
  const offsetMs = (Number(chartOffsets[chartKey]) || 0) + calibration;

  const firstNoteAt = useMemo(() => {
    let first = Infinity;
    for (const note of chart) {
      const at = (Number(note.time) || 0) + offsetMs;
      if (at < first) first = at;
    }
    return Number.isFinite(first) ? first : 0;
  }, [chart, offsetMs]);

  // Every run starts early enough that the first note is still on its way when
  // the count-in ends — and the music starts at that same spot in the track, so
  // there is never silence between GO and the first note.
  const readyLeadMs = readyLeadFor(difficultyId, travelMs);
  const startAt = startFor(firstNoteAt, readyLeadMs);
  // The music video is the backdrop while a track has one; the cover stands in
  // when it doesn't.
  const showVideo = Boolean(videoUrl);

  const holdCount = useMemo(
    () => chart.filter((note) => note.type === "hold").length,
    [chart]
  );

  const difficultyOptions = useMemo(
    () =>
      DIFFICULTY_ORDER.map((id) => ({ id, ...(song?.difficulties?.[id] || {}) })).filter(
        (item) => isPlayableDifficulty(item)
      ),
    [song]
  );

  const chartEnd = useMemo(() => {
    let end = 0;
    for (const note of chart) {
      const noteEnd =
        (Number(note.time) || 0) + (note.type === "hold" ? Number(note.duration) || 0 : 0);
      if (noteEnd > end) end = noteEnd;
    }
    return Math.max(0, end + offsetMs) + 1200;
  }, [chart, offsetMs]);

  const bestScore = useMemo(
    () =>
      (scores || [])
        .filter(
          (entry) =>
            entry.songId === songId && entry.difficultyId === (difficultyId || "normal")
        )
        .reduce((best, entry) => Math.max(best, Number(entry.score) || 0), 0),
    [scores, songId, difficultyId]
  );

  onSaveRef.current = onSaveResult;
  settingsRef.current = settings;
  playerNameRef.current = playerName;
  baseMetaRef.current = {
    songId: song?.id || songId,
    songTitle: song?.title || "Unknown",
    difficultyId: difficultyId || "normal",
    difficultyLabel: difficulty?.label || "Normal"
  };

  const configRef = useRef({ travelMs, beatMs, chartEnd, startAt });
  configRef.current = { travelMs, beatMs, chartEnd, startAt };

  const autoplayRef = useRef(false);
  const autoHeldRef = useRef([false, false, false, false]);
  const playbackStartRef = useRef(0);
  const clockRef = useRef({ lastRaw: -1, value: 0, at: 0 });
  const battleIdRef = useRef("");
  const battleStartRef = useRef(startParam);
  const battleSocketRef = useRef(null);
  const battleResultRef = useRef(false);
  const battleProgressRef = useRef(0);
  const startRunRef = useRef(null);

  battleIdRef.current = battleId;
  battleStartRef.current = battleStartAt || startParam;

  // Resolve the chart for this song + difficulty. Auto mode analyses the audio
  // and builds notes on a locked beat grid; authored mode uses the shipped one.
  useEffect(() => {
    let cancelled = false;

    phaseRef.current = "ready";
    setPhase("ready");
    setSummary(null);
    engineRef.current = null;

    try {
      if (audioRef.current) audioRef.current.pause();
      if (videoRef.current) videoRef.current.pause();
    } catch {
      /* media is optional */
    }

    if (!song || !difficulty) return undefined;

    setChartState({
      status: "loading",
      stage: chartMode === "authored" ? "Loading chart" : "Reading audio",
      chart: [],
      bpm: Number(difficulty.bpm) || 140,
      source: chartMode,
      noteCount: 0,
      holdCount: 0,
      startAt: 0
    });

    resolveChart(song, difficultyId || "normal", {
      mode: chartMode,
      onStage: (stage) => {
        if (!cancelled) setChartState((prev) => ({ ...prev, stage }));
      }
    })
      .then((resolved) => {
        if (cancelled) return;
        setChartState({
          status: "ready",
          stage: "",
          chart: resolved.chart,
          bpm: resolved.bpm,
          source: resolved.source,
          noteCount: resolved.noteCount,
          holdCount: resolved.holdCount,
          startAt: resolved.startAt || 0,
          error: resolved.error || null
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const fallback = difficulty.chart || [];
        setChartState({
          status: "error",
          stage: "",
          chart: fallback,
          bpm: Number(difficulty.bpm) || 140,
          source: "authored",
          noteCount: fallback.length,
          holdCount: fallback.filter((note) => note.type === "hold").length,
          startAt: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [song, difficulty, difficultyId, chartMode]);

  function hapticSafe(name) {
    if (settingsRef.current.haptics === false) return;
    try {
      haptic(name);
    } catch {
      /* haptics are best effort */
    }
  }

  function ensureAudioContext() {
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    } catch {
      /* audio is optional */
    }
  }

  function playSfx(kind) {
    if (settingsRef.current.hitSounds === false) return;
    try {
      ensureAudioContext();
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const now = ctx.currentTime;

      if (kind === "miss") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
        return;
      }

      if (kind === "perfect") {
        // The Jersey club bed squeak, rebuilt as a band-passed chirp.
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1300, now);
        osc.frequency.exponentialRampToValueAtTime(2500, now + 0.03);
        osc.frequency.exponentialRampToValueAtTime(900, now + 0.09);
        filter.type = "bandpass";
        filter.frequency.value = 1750;
        filter.Q.value = 5;
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(filter).connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
        return;
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(kind === "great" ? 700 : 560, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {
      /* audio is optional */
    }
  }

  function songClock() {
    const audio = audioRef.current;
    const clock = clockRef.current;
    const glide = () => clock.value + (performance.now() - clock.at);

    // Master clock: the decoded track playing through the AudioContext. It is
    // scheduled on the same timeline as the notes, so music and field can never
    // drift apart the way the <audio> element (chunked, late) made them.
    const music = musicClockRef.current;
    const musicCtx = audioCtxRef.current;
    if (music && musicCtx && musicCtx.state === "running") {
      return (
        music.anchorSongMs -
        (music.anchorCtxTime - musicCtx.currentTime) * 1000 -
        music.outputLatencyMs
      );
    }

    if (audio && !audio.paused && Number.isFinite(audio.currentTime)) {
      const raw = audio.currentTime * 1000;
      if (raw < playbackStartRef.current - 250) {
        // The element has not finished seeking to the trimmed start yet.
        return glide();
      }
      // An element jump far from the expected position (e.g. the stale
      // end-of-song position right after RUN IT BACK, or a seek that has not
      // landed yet) must not be trusted: glide on the smooth clock until the
      // element settles back in.
      const expected = clock.value > 0 ? clock.value + (performance.now() - clock.at) : raw;
      if (Math.abs(raw - expected) > 400) {
        return glide();
      }
      if (raw !== clock.lastRaw) {
        clock.lastRaw = raw;
        clock.value = raw;
        clock.at = performance.now();
        return Math.min(raw + 250, clock.value + (performance.now() - clock.at));
      }
      // Audio time updates in steps; extrapolate between updates so the field
      // glides instead of stuttering. Capped so a stalled element can only
      // drag the clock a quarter second ahead at most.
      return Math.min(raw + 250, clock.value + (performance.now() - clock.at));
    }

    return glide();
  }

  function consumeEvents(events) {
    const engine = engineRef.current;
    const renderer = rendererRef.current;
    if (!engine || !renderer || !events.length) return;

    for (const event of events) {
      switch (event.kind) {
        case "hit":
          renderer.spawnHit(event.lane, event.result, event.error, event.points);
          playSfx(event.result);
          hapticSafe(event.result === "perfect" ? "perfect-hit" : "tap-hit");
          break;
        case "hold-start":
          renderer.spawnHoldStart(event.lane, event.result);
          playSfx(event.result);
          hapticSafe("tap-hit");
          break;
        case "hold-resume":
          renderer.spawnHoldResume(event.lane);
          hapticSafe("tap-hit");
          break;
        case "hold-end":
          renderer.spawnHit(event.lane, event.result, 0, event.points);
          playSfx(event.result);
          hapticSafe("hold-pass");
          break;
        case "hold-drop":
          renderer.spawnDrop(event.lane);
          break;
        case "hold-break":
          renderer.spawnBreak(event.lane);
          playSfx("miss");
          hapticSafe("miss-hit");
          break;
        case "miss":
          renderer.spawnMiss(event.lane);
          playSfx("miss");
          hapticSafe("miss-hit");
          break;
        default:
          break;
      }
    }

    if (engine.combo === 0) {
      lastMilestoneRef.current = 0;
    } else {
      const milestone = Math.floor(engine.combo / 10) * 10;
      if (milestone >= 10 && milestone > lastMilestoneRef.current) {
        lastMilestoneRef.current = milestone;
        const text = COMBO_CHANTS[milestone];
        if (text) {
          renderer.chant(text);
          hapticSafe("combo-milestone");
          renderer.kick(clamp(0.35 + milestone / 260, 0.3, 0.9));
        }
      }
    }

      if (chartEnd > 0) {
      const progress = clamp(
        (engine.now - startAt) / Math.max(1, chartEnd - startAt),
        0,
        1
      );
      for (const chant of PROGRESS_CHANTS) {
        if (progress >= chant.at && !progressChantsRef.current[chant.at]) {
          progressChantsRef.current[chant.at] = true;
          renderer.chant(chant.text);
        }
      }
    }
  }

  function startMedia(at) {
    try {
      const video = videoRef.current;
      if (video) {
        const seconds = Math.max(0, at) / 1000;
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = seconds % video.duration;
        }
        video.play().catch(() => {});
      }
      // In buffer mode the AudioContext owns the music: playing the element
      // too would double the track.
      if (musicClockRef.current) return;
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = Math.max(0, at) / 1000;
        audio.play().catch(() => {});
      }
    } catch {
      /* media is optional */
    }
  }

  // The count-in ends here and the music starts with it: the track is scheduled
  // on the AudioContext clock at the chart's start position, so the first note
  // already has its full travel — nothing waits in silence after the countdown.
  function beginPlay() {
    const origin = playbackStartRef.current;
    fallbackStartRef.current = performance.now() - origin;
    clockRef.current = { lastRaw: -1, value: origin, at: performance.now() };
    phaseRef.current = "playing";
    setPhase("playing");
    hapticSafe("countdown-go");

    ensureAudioContext();
    const musicCtx = audioCtxRef.current;
    const musicBuffer = musicBufferRef.current;
    if (musicCtx && musicBuffer && musicBuffer.songId === song?.id && musicCtx.state === "running") {
      if (musicSourceRef.current) {
        try {
          musicSourceRef.current.stop();
        } catch {
          /* already stopped */
        }
      }
      const source = musicCtx.createBufferSource();
      source.buffer = musicBuffer.buffer;
      source.connect(musicCtx.destination);
      source.start(musicCtx.currentTime, Math.max(0, origin) / 1000);
      musicSourceRef.current = source;
      musicClockRef.current = {
        anchorCtxTime: musicCtx.currentTime,
        anchorSongMs: origin,
        outputLatencyMs:
          (musicCtx.outputLatency || musicCtx.baseLatency || 0) * 1000
      };
    }

    startMedia(origin);
  }

  function finishRun(reason) {
    if (phaseRef.current === "finished") return;
    const engine = engineRef.current;
    if (!engine) return;

    const nextSummary = engine.summary();
    phaseRef.current = "finished";
    setPhase("finished");
    setSummary({ ...nextSummary, failed: reason === "failed" });

    const renderer = rendererRef.current;
    if (renderer && reason !== "failed") renderer.confetti();

    try {
      if (musicSourceRef.current) musicSourceRef.current.stop();
      if (audioRef.current) audioRef.current.pause();
      if (videoRef.current) videoRef.current.pause();
    } catch {
      /* media is optional */
    }

    if (autoplayRef.current) return;

    if (battleIdRef.current && battleSocketRef.current && !battleResultRef.current) {
      battleResultRef.current = true;
      battleSocketRef.current.emit("battle:result", {
        roomId: battleIdRef.current,
        score: nextSummary.score,
        accuracy: nextSummary.accuracy,
        grade: nextSummary.grade,
        maxCombo: nextSummary.maxCombo,
        misses: nextSummary.stats.miss
      });
    }

    if (savedRef.current) return;
    // A failed run keeps its numbers on the results screen but never reaches a
    // board: a partial run would otherwise outrank a full, honest one.
    if (reason === "failed") {
      savedRef.current = true;
      return;
    }
    savedRef.current = true;

    const meta = baseMetaRef.current;
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      songId: meta.songId,
      songTitle: meta.songTitle,
      difficultyId: meta.difficultyId,
      difficultyLabel: meta.difficultyLabel,
      score: nextSummary.score,
      accuracy: nextSummary.accuracy,
      grade: nextSummary.grade,
      maxCombo: nextSummary.maxCombo,
      misses: nextSummary.stats.miss,
      stats: nextSummary.stats,
      fullCombo: nextSummary.fullCombo,
      chartSource: chartState.source,
      playedAt: new Date().toISOString()
    };

    if (onSaveRef.current) onSaveRef.current(entry);
  }

  function pauseSong() {
    if (phaseRef.current !== "playing") return;
    pausedAtRef.current = songClock();
    if (musicClockRef.current) {
      try {
        musicSourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      musicSourceRef.current = null;
      musicClockRef.current = null;
    }
    try {
      if (audioRef.current) audioRef.current.pause();
      if (videoRef.current) videoRef.current.pause();
    } catch {
      /* media is optional */
    }
    phaseRef.current = "paused";
    setPhase("paused");
  }

  function resumeSong() {
    if (phaseRef.current !== "paused") return;
    const at = pausedAtRef.current;
    fallbackStartRef.current = performance.now() - at;
    clockRef.current = { lastRaw: -1, value: at, at: performance.now() };

    // Resume the decoded track on the AudioContext clock when it is available.
    ensureAudioContext();
    const musicCtx = audioCtxRef.current;
    const musicBuffer = musicBufferRef.current;
    if (musicCtx && musicBuffer && musicBuffer.songId === song?.id && musicCtx.state === "running") {
      const source = musicCtx.createBufferSource();
      source.buffer = musicBuffer.buffer;
      source.connect(musicCtx.destination);
      source.start(musicCtx.currentTime, Math.max(0, at) / 1000);
      musicSourceRef.current = source;
      musicClockRef.current = {
        anchorCtxTime: musicCtx.currentTime,
        anchorSongMs: at,
        outputLatencyMs:
          (musicCtx.outputLatency || musicCtx.baseLatency || 0) * 1000
      };
      phaseRef.current = "playing";
      setPhase("playing");
      return;
    }

    // Paused during the silent lead-in: keep the music waiting for what is
    // left of it instead of dropping it in early.
    if (at < mediaAt) {
      phaseRef.current = "playing";
      setPhase("playing");
      scheduleMedia(mediaAt, mediaAt - at);
      return;
    }

    startMedia(at);

    phaseRef.current = "playing";
    setPhase("playing");
  }

  function exitRun() {
    try {
      if (musicSourceRef.current) musicSourceRef.current.stop();
      if (audioRef.current) audioRef.current.pause();
      if (videoRef.current) videoRef.current.pause();
    } catch {
      /* media is optional */
    }
    if (battleIdRef.current && battleSocketRef.current) {
      battleSocketRef.current.emit("battle:leave", { roomId: battleIdRef.current });
    }
    navigate("/play");
  }

  function unlockAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      const wasMuted = audio.muted;
      audio.muted = true;
      audio.currentTime = startAt / 1000;
      const played = audio.play();
      const restore = () => {
        audio.pause();
        audio.muted = wasMuted;
        audio.currentTime = startAt / 1000;
      };
      if (played && typeof played.then === "function") {
        played.then(restore).catch(() => {
          audio.muted = wasMuted;
        });
      } else {
        restore();
      }
    } catch {
      /* unlocking is best effort */
    }
  }

  function startRun(options) {
    if (!chart.length) return;
    ensureAudioContext();
    unlockAudio();

    const autoplay = Boolean(options && options.autoplay);
    autoplayRef.current = autoplay;
    setAutoPlaying(autoplay);
    playbackStartRef.current = startAt;
    // Reset the run clocks: after a finished run the audio element still sits
    // at the song's end, and a stale clock here instant-fails the whole run.
    fallbackStartRef.current = performance.now() - startAt;
    clockRef.current = { lastRaw: -1, value: startAt, at: performance.now() };
    // Stop the previous run's buffer source and get the decoded track ready:
    // a fresh buffer start is sample-accurate, so music, notes and countdown
    // share one timeline instead of the element catching up late.
    if (musicSourceRef.current) {
      try {
        musicSourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      musicSourceRef.current = null;
    }
    musicClockRef.current = null;
    musicBufferRef.current = null;
    if (song) {
      decodeTrackBuffer(song)
        .then((buffer) => {
          musicBufferRef.current = { songId: song.id, buffer };
        })
        .catch(() => {
          musicBufferRef.current = null;
        });
    }
    autoHeldRef.current = [false, false, false, false];

    const engine = new GameEngine({ chart, offsetMs });
    engineRef.current = engine;
    savedRef.current = false;
    lastMilestoneRef.current = 0;
    progressChantsRef.current = {};
    pointersRef.current.clear();

    const renderer = rendererRef.current;
    if (renderer) {
      renderer.particles.length = 0;
      renderer.floaters.length = 0;
      renderer.confettiPieces.length = 0;
      renderer.shake = 0;
      renderer.lastCombo = 0;
      renderer.laneMiss = [0, 0, 0, 0];
    }

    try {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = startAt / 1000;
      }
      const video = videoRef.current;
      if (video) {
        video.pause();
        const seconds = startAt / 1000;
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = seconds % video.duration;
        }
      }
    } catch {
      /* media is optional */
    }

    setSummary(null);
    setRunBest(bestScore);
    setCountdown("3");
    countdownLabelRef.current = "3";
    countdownStartRef.current = performance.now();
    phaseRef.current = "countdown";
    setPhase("countdown");
  }

  function autoplayStep(engine, now) {
    const held = autoHeldRef.current;

    for (let lane = 0; lane < 4; lane += 1) {
      if (held[lane]) {
        const stillHolding = engine.notes.some(
          (note) =>
            note.lane === lane &&
            note.hold &&
            !note.resolved &&
            now < note.start + note.duration + 40
        );
        if (!stillHolding) {
          engine.release(lane, now);
          held[lane] = false;
        }
        continue;
      }

      const target = engine.notes.find(
        (note) =>
          note.lane === lane &&
          !note.resolved &&
          !note.hold &&
          note.start - now <= 10 &&
          note.start - now >= -60
      );
      if (!target) continue;

      engine.press(lane, target.start);
      if (target.type === "hold") {
        held[lane] = true;
      } else {
        engine.release(lane, target.start + 8);
      }
    }
  }

  function emitBattleProgress(engine, now) {
    const roomId = battleIdRef.current;
    const socket = battleSocketRef.current;
    if (!roomId || !socket || !engine) return;

    const wall = Date.now();
    if (wall - battleProgressRef.current < 900) return;
    battleProgressRef.current = wall;

    const span = Math.max(1, chartEnd - startAt);
    socket.emit("battle:progress", {
      roomId,
      score: engine.score,
      accuracy: engine.accuracy,
      combo: engine.combo,
      progress: Math.round(((now - startAt) / span) * 100)
    });
  }

  loopApi.current = {
    beginPlay,
    finishRun,
    songClock,
    consumeEvents,
    autoplayStep,
    emitBattleProgress
  };
  startRunRef.current = startRun;

  // ── Battle wiring ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!battleId) return undefined;
    const socket = connectSocket();
    if (!socket) {
      setBattleNotice("No battle server configured.");
      return undefined;
    }
    battleSocketRef.current = socket;

    const onState = (state) => {
      if (state && state.roomId === battleId) setBattleState(state);
    };
    const onStart = (payload) => {
      if (!payload || payload.roomId !== battleId) return;
      const startsIn = Number(payload.startsInMs) || 0;
      setBattleStartAt(Date.now() + startsIn);
    };
    const onError = (payload) => {
      setBattleNotice((payload && payload.message) || "Battle error");
    };

    socket.on("battle:state", onState);
    socket.on("battle:start", onStart);
    socket.on("battle:error", onError);
    socket.emit("battle:rejoin", { roomId: battleId });

    return () => {
      socket.off("battle:state", onState);
      socket.off("battle:start", onStart);
      socket.off("battle:error", onError);
    };
  }, [battleId]);

  // Tell the room that this client has the chart ready.
  useEffect(() => {
    if (!battleId || chartState.status !== "ready" || !chart.length) return undefined;
    const socket = getSocket();
    if (socket) socket.emit("battle:loaded", { roomId: battleId });
    return undefined;
  }, [battleId, chartState.status, chart.length]);

  // Start on the server's wall clock: the count-in is timed so both players
  // press play at the same moment.
  useEffect(() => {
    if (!battleId) return undefined;
    const wallStart = battleStartAt || startParam;
    if (!wallStart) return undefined;
    const delay = Math.max(0, wallStart - COUNT_IN_MS - Date.now());
    const timer = setTimeout(() => {
      if (startRunRef.current) startRunRef.current();
    }, delay + 30);
    return () => clearTimeout(timer);
  }, [battleId, battleStartAt, startParam, chart.length, chartState.status]);

  // Renderer + animation loop. Registered once; reads live values from refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const renderer = new FieldRenderer(canvas);
    rendererRef.current = renderer;

    let raf = 0;
    let disposed = false;
    const handleResize = () => renderer.resize();
    window.addEventListener("resize", handleResize);

    const frame = () => {
      if (disposed) return;
      const time = performance.now();
      const dt = Math.min(64, Math.max(8, time - (lastFrameRef.current || time - 16)));
      lastFrameRef.current = time;

      const engine = engineRef.current;
      const phaseNow = phaseRef.current;
      const config = configRef.current;
      const api = loopApi.current;

      if (phaseNow === "countdown") {
        const left = COUNT_IN_MS - (time - countdownStartRef.current);
        if (left <= 0) {
          api.beginPlay();
        } else {
          const label = String(Math.max(1, Math.ceil(left / 1000)));
          if (label !== countdownLabelRef.current) {
            countdownLabelRef.current = label;
            setCountdown(label);
            playSfx("countdown");
            hapticSafe("countdown");
          }
        }
      } else if (phaseNow === "playing" && engine) {
        const songNow = api.songClock();
        if (autoplayRef.current) api.autoplayStep(engine, songNow);
        engine.update(songNow);
        api.consumeEvents(engine.drainEvents());
        api.emitBattleProgress(engine, songNow);
        if (engine.failed) {
          api.finishRun("failed");
        } else if (songNow >= config.chartEnd) {
          api.finishRun("complete");
        }
      }

      const drawNow =
        phaseNow === "countdown" || phaseNow === "ready"
          ? -99999
          : engine
            ? engine.now
            : 0;

      renderer.draw({
        engine,
        now: drawNow,
        dt,
        travelMs: config.travelMs,
        beatMs: config.beatMs,
        chartEnd: config.chartEnd,
        startAt: config.startAt,
        phase: phaseNow,
        backdropVideo: videoRef.current,
        videoOpacity: (() => {
          const value = settingsRef.current.videoOpacity;
          return value == null ? 0.35 : clamp(Number(value), 0, 1);
        })()
      });

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      rendererRef.current = null;
    };
  }, []);

  // Keyboard input.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (phaseRef.current === "playing") pauseSong();
        else if (phaseRef.current === "paused") resumeSong();
        return;
      }
      if (phaseRef.current !== "playing") return;
      if (event.repeat) return;
      const lane = laneFromKey(event.key);
      if (lane < 0) return;
      event.preventDefault();
      const engine = engineRef.current;
      if (!engine) return;
      engine.press(lane, songClock());
      consumeEvents(engine.drainEvents());
    };

    const onKeyUp = (event) => {
      const lane = laneFromKey(event.key);
      if (lane < 0) return;
      const engine = engineRef.current;
      if (!engine) return;
      engine.release(lane, songClock());
      consumeEvents(engine.drainEvents());
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Safety net: a finger lifted outside the field must still release its lane.
  useEffect(() => {
    const onUp = (event) => {
      if (pointerUpRef.current) pointerUpRef.current(event);
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // Pause when the app goes to the background instead of running blind.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && phaseRef.current === "playing") pauseSong();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Keep the backdrop moving on the ready screen.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {});
  }, [chartState.status]);

  // Stop media and audio when leaving the route.
  useEffect(() => {
    return () => {
      try {
        if (audioRef.current) audioRef.current.pause();
        if (videoRef.current) videoRef.current.pause();
      } catch {
        /* media is optional */
      }
      try {
        if (audioCtxRef.current) audioCtxRef.current.close();
      } catch {
        /* audio is optional */
      }
    };
  }, []);

  function laneFromPoint(clientX) {
    const renderer = rendererRef.current;
    if (renderer) return renderer.laneAt(clientX);
    const field = fieldRef.current;
    if (!field) return 0;
    const rect = field.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    return clamp(Math.floor(ratio * 4), 0, 3);
  }

  function handlePointerDown(event) {
    if (phaseRef.current !== "playing") return;
    event.preventDefault();
    const lane = laneFromPoint(event.clientX);
    pointersRef.current.set(event.pointerId, lane);
    try {
      if (fieldRef.current) fieldRef.current.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best effort */
    }
    const engine = engineRef.current;
    if (!engine) return;
    engine.press(lane, songClock());
    consumeEvents(engine.drainEvents());
  }

  function handlePointerMove(event) {
    if (phaseRef.current !== "playing") return;
    if (!pointersRef.current.has(event.pointerId)) return;
    const lane = laneFromPoint(event.clientX);
    const previous = pointersRef.current.get(event.pointerId);
    if (lane === previous) return;

    pointersRef.current.set(event.pointerId, lane);
    const engine = engineRef.current;
    if (!engine) return;
    const at = songClock();
    engine.release(previous, at);
    engine.press(lane, at);
    consumeEvents(engine.drainEvents());
  }

  function handlePointerUp(event) {
    const lane = pointersRef.current.get(event.pointerId);
    if (lane === undefined) return;
    pointersRef.current.delete(event.pointerId);
    const engine = engineRef.current;
    if (!engine) return;
    engine.release(lane, songClock());
    consumeEvents(engine.drainEvents());
  }

  pointerUpRef.current = handlePointerUp;

  if (!song || !difficulty) {
    return (
      <div className="gp-screen">
        <div className="gp-overlay">
          <div className="gp-panel">
            <p className="gp-kicker">MISSING TRACK</p>
            <h2>That chart is not here</h2>
            <div className="gp-panel-actions">
              <button className="btn btn-primary" onClick={() => navigate("/play")}>
                SONG SELECT
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const videoOpacity =
    settings.videoOpacity == null ? 0.35 : clamp(Number(settings.videoOpacity), 0, 1);
  const isNewRecord = Boolean(summary && !summary.failed && summary.score > runBest);
  const timingErrors = summary ? summary.hitErrors.slice(-90) : [];
  const loading = chartState.status === "loading";
  const sourceLabel =
    chartState.source === "auto"
      ? "MAPPED FROM AUDIO"
      : chartState.source === "authored-fallback"
        ? "SHIPPED CHART"
        : "SHIPPED CHART";

  return (
    <div className={"gp-screen gp-phase-" + phase}>
      <div className="gp-video" style={{ opacity: videoOpacity }}>
        {showVideo ? (
          <video
            ref={videoRef}
            className="gp-video-el"
            src={videoUrl}
            muted
            loop
            playsInline
            preload="auto"
          />
        ) : song?.coverUrl ? (
          // During play the cover is the backdrop: decoding a 1080p video behind
          // the canvas is what made runs stutter on a phone.
          <img className="gp-video-el gp-cover-el" src={song.coverUrl} alt="" />
        ) : null}
        <div className="gp-video-scrim" />
      </div>

      {(phase === "playing" || phase === "paused") && (
        <div className="gp-top">
          <button className="gp-chip" type="button" onClick={exitRun}>
            EXIT
          </button>
          <div className="gp-song">
            <strong>{song.title}</strong>
            <span>
              {autoPlaying
                ? "WATCH MODE"
                : difficulty.label + " · " + Math.round(Number(difficulty?.bpm) || chartBpm) + " BPM"}
            </span>
          </div>
          <button
            className="gp-chip"
            type="button"
            onClick={phase === "paused" ? resumeSong : pauseSong}
          >
            {phase === "paused" ? "RESUME" : "PAUSE"}
          </button>
        </div>
      )}

      {battleId && battleState && (phase === "playing" || phase === "paused") ? (
        <div className="gp-battle-strip">
          {battleState.players.map((player) => (
            <div key={player.id} className="gp-battle-player">
              <strong>{player.name}</strong>
              <span>
                {(Number(player.score) || 0).toLocaleString()} · {player.accuracy}%
              </span>
            </div>
          ))}
          {battleState.spectatorCount > 0 ? (
            <span className="gp-battle-watch">{battleState.spectatorCount} watching</span>
          ) : null}
        </div>
      ) : null}

      <div
        className="gp-field"
        ref={fieldRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas ref={canvasRef} className="gp-canvas" />

        {phase === "countdown" && (
          <div className="gp-countdown">
            <span key={countdown}>{countdown}</span>
          </div>
        )}
      </div>

      {song.audioUrl ? (
        <audio ref={audioRef} src={song.audioUrl} preload="auto" />
      ) : null}

      {phase === "ready" && battleId ? (
        <div className="gp-overlay">
          <div className="gp-panel">
            <p className="gp-kicker">1V1 BATTLE</p>
            <h2>
              {chartState.status === "loading" ? "BUILDING CHART" : "WAITING FOR THE DROP"}
            </h2>
            <p>
              {chartState.status === "loading"
                ? "Both players are loading the same chart from the same audio."
                : "The battle starts on the server clock. Keep this screen open."}
            </p>
            {battleNotice ? <p className="gp-warning">{battleNotice}</p> : null}
            <div className="gp-panel-actions">
              <button className="btn btn-ghost" type="button" onClick={exitRun}>
                LEAVE BATTLE
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "ready" && !battleId && (
        <div className="gp-overlay gp-ready">
          <div
            className="gp-poster"
            style={song.coverUrl ? { backgroundImage: "url(\"" + song.coverUrl + "\")" } : undefined}
          >
            <div className="gp-poster-scrim" />
            <div className="gp-poster-body">
              <p className="gp-kicker">
                BRICK CITY · {difficulty.label} · {sourceLabel}
              </p>
              <h1 className="gp-poster-title">{song.title}</h1>
              <p className="gp-poster-artist">{song.artist}</p>

              {loading ? (
                <div className="gp-build">
                  <p className="gp-build-stage">{chartState.stage}</p>
                  <div className="gp-build-bar">
                    <span />
                  </div>
                  <p className="gp-hint">
                    Listening to the track and locking a beat grid. The first run on a song
                    takes a few seconds; it is cached after that.
                  </p>
                </div>
              ) : (
                <>
                  <div className="gp-prepared">
                    <span>{Math.round(Number(difficulty?.bpm) || chartBpm)} BPM</span>
                    <span>{chartState.noteCount} NOTES</span>
                    <span>{holdCount} HOLDS</span>
                    <span>{bestScore > 0 ? "BEST " + formatScore(bestScore) : "NO SCORE"}</span>
                  </div>

                  {chartState.error ? (
                    <p className="gp-warning">
                      Audio analysis failed ({chartState.error}). Playing the shipped chart
                      instead.
                    </p>
                  ) : null}

                  <div className="gp-start-row">
                    <button
                      className="btn btn-primary gp-start"
                      type="button"
                      onClick={() => startRun()}
                      disabled={!chart.length}
                    >
                      TURN IT UP
                    </button>
                    <button
                      className="btn btn-ghost gp-watch"
                      type="button"
                      onClick={() => startRun({ autoplay: true })}
                      disabled={!chart.length}
                    >
                      WATCH
                    </button>
                  </div>

                  <p className="gp-hint">
                    Tap gems on the line. Hold ribbons down until they burn out — let go and you
                    can still grab it again before it snaps.
                  </p>
                </>
              )}

              <div className="gp-diff-row">
                {difficultyOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={
                      "gp-diff" + (option.id === (difficultyId || "normal") ? " is-active" : "")
                    }
                    onClick={() => navigate("/gameplay/" + song.id + "/" + option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <p className="gp-keys">KEYS 1 2 3 4 OR D F J K</p>
            </div>
          </div>
        </div>
      )}

      {phase === "paused" && (
        <div className="gp-overlay">
          <div className="gp-panel">
            <p className="gp-kicker">PAUSED</p>
            <h2>Take a breath</h2>
            <div className="gp-panel-actions">
              <button className="btn btn-primary" type="button" onClick={resumeSong}>
                RESUME
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => startRun({ autoplay: autoPlaying })}>
                RESTART
              </button>
              <button className="btn btn-ghost" type="button" onClick={exitRun}>
                QUIT
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "finished" && summary && (
        <div className="gp-overlay gp-results">
          <div className="gp-panel gp-result">
            <p className="gp-kicker">
              {summary.failed ? "RUN FAILED" : summary.fullCombo ? "FULL COMBO" : "RUN COMPLETE"}
            </p>
            <h2>{song.title}</h2>

            <div className="gp-grade" data-grade={summary.grade}>
              {summary.grade}
            </div>

            <div className="gp-result-score">{formatScore(summary.score)}</div>
            <div className="gp-result-meta">
              <span>{summary.accuracy}% accuracy</span>
              <span>{summary.maxCombo}x combo</span>
              <span>{summary.breaks} drops</span>
            </div>

            {summary.failed ? (
              <div className="gp-rank muted">NOT SAVED — RUN FAILED</div>
            ) : autoPlaying ? (
              <div className="gp-rank muted">WATCH MODE — NOT SAVED</div>
            ) : (
              <div className="gp-rank muted">SAVED ON THIS DEVICE</div>
            )}

            <div className="gp-result-stats">
              <div>
                <span>PERFECT</span>
                <strong>{summary.stats.perfect}</strong>
              </div>
              <div>
                <span>GREAT</span>
                <strong>{summary.stats.great}</strong>
              </div>
              <div>
                <span>GOOD</span>
                <strong>{summary.stats.good}</strong>
              </div>
              <div>
                <span>MISS</span>
                <strong>{summary.stats.miss}</strong>
              </div>
            </div>

            <div className="gp-timing">
              <div className="gp-timing-track">
                <span className="gp-timing-mid" />
                {timingErrors.map((entry, index) => (
                  <span
                    key={String(entry.id) + "-" + index}
                    className={"gp-timing-dot dot-" + entry.result}
                    style={{
                      left: clamp(50 + (entry.error / 180) * 50, 2, 98) + "%",
                      top: 6 + ((index * 37) % 82) + "%"
                    }}
                  />
                ))}
              </div>
              <div className="gp-timing-legend">
                <span>EARLY</span>
                <span>
                  {summary.meanError === 0
                    ? "DEAD ON"
                    : Math.abs(summary.meanError) +
                      "MS " +
                      (summary.meanError < 0 ? "EARLY" : "LATE")}
                </span>
                <span>LATE</span>
              </div>
            </div>

            {isNewRecord ? <div className="gp-new-record">PERSONAL BEST</div> : null}

            <div className="gp-panel-actions">
              <button className="btn btn-primary" type="button" onClick={() => startRun({ autoplay: autoPlaying })}>
                RUN IT BACK
              </button>
              <button className="btn btn-ghost" type="button" onClick={exitRun}>
                SONG SELECT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
