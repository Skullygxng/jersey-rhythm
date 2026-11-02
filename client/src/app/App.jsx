import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Link, useNavigate, useParams } from "react-router-dom";

import { songs, isPlayableDifficulty } from "../data/songLibrary.js";
import GameplayPageV2 from "./GameplayPageV2.jsx";
import { Shell } from "./shell.jsx";
import {
  loadScores,
  saveScoreEntry,
  loadProfileSettings,
  saveProfileSettings
} from "../lib/progressStorage.js";
import { loadChartOffsets } from "../lib/chartOffsetStorage.js";
import {
  BOARD_SETUP_HINT,
  fetchLeaderboard,
  isSelf
} from "../lib/leaderboardApi.js";
import { clearAutoChartCache } from "../lib/autoChart.js";
import {
  clearErrorLog,
  formatErrorLog,
  getErrorLog,
  subscribeErrorLog
} from "../lib/errorLog.js";

const DIFFICULTY_ORDER = ["easy", "normal", "hard"];

const DEFAULT_SETTINGS = {
  noteSpeed: 1.05,
  videoOpacity: 0.35,
  calibrationOffset: 0,
  hitSounds: true,
  haptics: true,
  chartMode: "song"
};

const GRADE_RANK = { "S+": 6, S: 5, A: 4, B: 3, C: 2, D: 1 };

const SCENE_FACTS = [
  {
    title: "140 BPM, five kicks",
    body: "Kicks on 16th steps 1, 5, 9, 12, 15 — the uneven back half is the bounce. Charts are built on that grid."
  },
  {
    title: "Bed squeak",
    body: "The chopped Some Cut squeak is the genre's signature. A perfect hit plays it back."
  },
  {
    title: "Chants",
    body: "Make it jump. Get silly. Swing dat. Call-and-response fires at combo milestones."
  }
];

function ComingSoonPage() {
  return (
    <Shell>
      <section className="page-head">
        <p className="kicker">COMING SOON</p>
        <h1>NOT YET</h1>
        <p className="page-sub">
          This build is single-player while we find out whether people actually
          play it.
        </p>
      </section>

      <div className="card coming-soon">
        <h3>1v1 battles and shared boards</h3>
        <p>
          Battles, spectating, room chat and a global leaderboard all need a
          small backend to run. They are parked, not deleted — the code is still
          here and comes back the moment the game earns it.
        </p>
        <p className="setting-hint">
          For now every run is saved on your device, and each song still shows
          your best grade and score.
        </p>
        <div className="board-actions">
          <Link className="btn btn-primary" to="/play">
            PLAY A TRACK
          </Link>
          <Link className="btn btn-ghost" to="/profile">
            SEE YOUR RUNS
          </Link>
        </div>
      </div>
    </Shell>
  );
}

function getSavedSettings() {
  try {
    const raw = localStorage.getItem("jersey-rhythm-settings");
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function getSongStats(song) {
  const chartSource =
    song?.difficulties?.normal ||
    song?.difficulties?.easy ||
    song?.difficulties?.hard ||
    null;
  return {
    bpm: Number(chartSource?.bpm) || 0,
    noteCount: chartSource?.chart?.length || 0,
    holds: (chartSource?.chart || []).filter((note) => note.type === "hold").length
  };
}

function bpmLabel(bpm) {
  const value = Number(bpm) || 0;
  return value > 0 ? Math.round(value) + " BPM" : "AUTO BPM";
}

function bestFor(scores, songId, difficultyId) {
  let best = null;
  for (const entry of scores || []) {
    if (entry.songId !== songId) continue;
    if (difficultyId && entry.difficultyId !== difficultyId) continue;
    if (!best || (Number(entry.score) || 0) > (Number(best.score) || 0)) best = entry;
  }
  return best;
}

function recentRuns(scores, limit) {
  return [...(scores || [])]
    .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime())
    .slice(0, limit);
}

function profileSummary(scores) {
  const list = scores || [];
  if (!list.length) {
    return {
      plays: 0,
      bestScore: 0,
      bestGrade: "-",
      avgAccuracy: 0,
      fullCombos: 0,
      perfect: 0,
      great: 0,
      good: 0,
      miss: 0
    };
  }

  let bestScore = 0;
  let bestGrade = "D";
  let accuracy = 0;
  let fullCombos = 0;
  let perfect = 0;
  let great = 0;
  let good = 0;
  let miss = 0;

  for (const entry of list) {
    bestScore = Math.max(bestScore, Number(entry.score) || 0);
    if ((GRADE_RANK[entry.grade] || 0) > (GRADE_RANK[bestGrade] || 0)) bestGrade = entry.grade;
    accuracy += Number(entry.accuracy) || 0;
    if ((entry.misses || 0) === 0) fullCombos += 1;
    perfect += entry.stats?.perfect || 0;
    great += entry.stats?.great || 0;
    good += entry.stats?.good || 0;
    miss += entry.stats?.miss || 0;
  }

  return {
    plays: list.length,
    bestScore,
    bestGrade,
    avgAccuracy: Math.round((accuracy / list.length) * 10) / 10,
    fullCombos,
    perfect,
    great,
    good,
    miss
  };
}

function GradeChip({ grade, size }) {
  if (!grade) return null;
  return (
    <span className={"grade-chip size-" + (size || "md") + " grade-" + grade.replace("+", "plus")}>
      {grade}
    </span>
  );
}

function SongCard({ song, scores }) {
  const stats = getSongStats(song);
  const best = bestFor(scores, song.id, null);

  return (
    <Link to={"/song/" + song.id} className="song-card">
      <div className="song-art">
        {song.coverUrl ? (
          <img src={song.coverUrl} alt="" loading="lazy" />
        ) : (
          <span className="song-art-fallback">{song.title.slice(0, 2).toUpperCase()}</span>
        )}
        {best ? <GradeChip grade={best.grade} size="sm" /> : null}
      </div>
      <div className="song-copy">
        <strong>{song.title}</strong>
        <span>{song.artist}</span>
        <em>{bpmLabel(stats.bpm)}</em>
      </div>
    </Link>
  );
}

function HomePage({ scores }) {
  const navigate = useNavigate();
  const summary = useMemo(() => profileSummary(scores), [scores]);
  const featured = songs[0] || null;
  const featuredStats = featured ? getSongStats(featured) : null;

  return (
    <Shell>
      <section className="hero">
        <p className="hero-overline">NEWARK · 140 BPM · FOUR LANES</p>
        <h1 className="hero-title">
          <span>JERSEY</span>
          <span className="hero-title-alt">RHYTHM</span>
        </h1>
        <p className="hero-sub">
          Tap the gems, ride the ribbons, don't drop the bounce.
        </p>
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => navigate(featured ? "/song/" + featured.id : "/play")}
          >
            TURN IT UP
          </button>
          <Link to="/leaderboards" className="btn btn-ghost">
            BOARDS<span className="soon-tag">SOON</span>
          </Link>
          <a href="./preview/cityrunner.html" className="btn btn-ghost">
            CITY RUNNER PREVIEW
          </a>
        </div>
        <div className="hero-stats">
          <div>
            <strong>{songs.length}</strong>
            <span>tracks</span>
          </div>
          <div>
            <strong>{summary.plays}</strong>
            <span>runs</span>
          </div>
          <div>
            <strong>{summary.bestGrade === "-" ? "—" : summary.bestGrade}</strong>
            <span>best grade</span>
          </div>
        </div>
      </section>

      {featured ? (
        <section className="section">
          <div className="section-head">
            <h2>FEATURED</h2>
          </div>
          <div className="feature">
            <div className="feature-art">
              {featured.coverUrl ? <img src={featured.coverUrl} alt="" /> : null}
            </div>
            <div className="feature-copy">
              <p className="kicker">{featured.artist}</p>
              <h3>{featured.title}</h3>
              <p className="feature-meta">
                {bpmLabel(featuredStats.bpm)} · AUTO-MAPPED
              </p>
              <div className="feature-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => navigate("/song/" + featured.id)}
                >
                  PLAY
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>THE LIBRARY</h2>
          <Link to="/play" className="section-link">
            ALL
          </Link>
        </div>
        {songs.length ? (
          <div className="song-rail">
            {songs.map((song) => (
              <div key={song.id} className="song-rail-item">
                <SongCard song={song} scores={scores} />
              </div>
            ))}
          </div>
        ) : (
          <div className="card">
            <p>No tracks installed. Add audio to the media folder.</p>
          </div>
        )}
      </section>

      <section className="section">
        <div className="scene-rail">
          {SCENE_FACTS.map((fact) => (
            <article key={fact.title} className="scene-item">
              <h3>{fact.title}</h3>
              <p>{fact.body}</p>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}

function PlayPage({ scores }) {
  const [query, setQuery] = useState("");

  const term = query.trim().toLowerCase();
  const filtered = term
    ? songs.filter(
        (song) =>
          song.title.toLowerCase().includes(term) ||
          song.artist.toLowerCase().includes(term)
      )
    : songs;

  return (
    <Shell>
      <section className="page-head">
        <p className="kicker">SONG SELECT</p>
        <h1>PICK A TRACK</h1>
        <p className="page-sub">
          Every difficulty is charted from the track's own audio.
        </p>
      </section>

      <div className="library-tools">
        <input
          className="input"
          type="search"
          value={query}
          placeholder="Search artist or track"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {filtered.length ? (
        <div className="song-grid">
          {filtered.map((song) => (
            <SongCard key={song.id} song={song} scores={scores} />
          ))}
        </div>
      ) : (
        <div className="card">
          <p>
            {songs.length
              ? 'Nothing matches "' + query + '".'
              : "No tracks yet."}
          </p>
        </div>
      )}

      <p className="library-note">
        More tracks are on the way. Loading your own audio is planned for a later
        release.
      </p>
    </Shell>
  );
}

function SongDetailPage({ scores }) {
  const { songId } = useParams();
  const navigate = useNavigate();
  const song = songs.find((item) => item.id === songId);

  if (!song) {
    return (
      <Shell>
        <section className="page-head">
          <p className="kicker">NOT FOUND</p>
          <h1>THAT TRACK IS GONE</h1>
          <Link to="/play" className="btn btn-primary">
            BACK TO LIBRARY
          </Link>
        </section>
      </Shell>
    );
  }

  const stats = getSongStats(song);

  return (
    <Shell>
      <section className="detail">
        <div className="detail-art">
          {song.coverUrl ? <img src={song.coverUrl} alt="" /> : null}
        </div>
        <div className="detail-copy">
          <p className="kicker">{song.artist}</p>
          <h1 className="detail-title">{song.title}</h1>
          <div className="badge-row">
            <span className="badge">{bpmLabel(stats.bpm)}</span>
            <span className="badge">AUTO-MAPPED</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>DIFFICULTY</h2>
        </div>
        <div className="diff-list">
          {DIFFICULTY_ORDER.filter((id) => isPlayableDifficulty(song.difficulties?.[id])).map((id) => {
            const difficulty = song.difficulties[id];
            const best = bestFor(scores, song.id, id);

            return (
              <button
                key={id}
                type="button"
                className="diff-card"
                onClick={() => navigate("/gameplay/" + song.id + "/" + id)}
              >
                <span className="diff-card-name">{difficulty.label || id}</span>
                <span className="diff-card-meta">
                  {bpmLabel(Number(difficulty?.bpm) || stats.bpm)} · built from the audio
                </span>
                <span className="diff-card-best">
                  {best ? (
                    <>
                      <GradeChip grade={best.grade} size="sm" />
                      {(Number(best.score) || 0).toLocaleString()}
                    </>
                  ) : (
                    "UNPLAYED"
                  )}
                </span>
                <span className="diff-card-go">PLAY</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="section">
        <details className="card details-card">
          <summary>HOW IT PLAYS</summary>
          <ul className="rule-list">
            <li>
              <strong>Taps</strong> hit on the line: perfect ±45ms, great ±85ms, good ±130ms.
            </li>
            <li>
              <strong>Holds</strong> grab the head and ride the ribbon; the tail is judged by
              coverage (90% perfect / 60% great / 30% good).
            </li>
            <li>
              <strong>Drops</strong> are survivable — 220ms to re-grab before it snaps.
            </li>
            <li>
              <strong>Score</strong> climbs with a ×1–×4 combo multiplier; accuracy is kept
              separately and decides the grade.
            </li>
          </ul>
        </details>
      </section>
    </Shell>
  );
}

function BoardRow({ entry, index, highlight }) {
  return (
    <div className={"board-row" + (highlight ? " is-you" : "")}>
      <span className="board-rank">{entry.rank || index + 1}</span>
      <div className="board-main">
        <strong>{entry.playerName || "Player"}</strong>
        <span>
          {entry.accuracy}% · {entry.maxCombo || 0}x
        </span>
      </div>
      <GradeChip grade={entry.grade} size="sm" />
      <span className="board-score">{(Number(entry.score) || 0).toLocaleString()}</span>
    </div>
  );
}

function LeaderboardsPage({ scores, profileSettings }) {
  const navigate = useNavigate();
  const [scope, setScope] = useState("global");
  const [songId, setSongId] = useState(songs[0]?.id || "");
  const [difficultyId, setDifficultyId] = useState("normal");
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  const song = songs.find((item) => item.id === songId) || songs[0] || null;
  const difficulties = useMemo(
    () =>
      DIFFICULTY_ORDER.filter((id) => isPlayableDifficulty(song?.difficulties?.[id])),
    [song]
  );

  useEffect(() => {
    if (difficulties.length && difficulties.indexOf(difficultyId) === -1) {
      setDifficultyId(difficulties[0]);
    }
  }, [difficulties, difficultyId]);

  useEffect(() => {
    if (scope !== "global") return undefined;
    let cancelled = false;
    setStatus("loading");
    setMessage("");

    fetchLeaderboard({ songId, difficultyId, limit: 50 })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setEntries(result.entries);
          setStatus("ready");
        } else {
          setEntries([]);
          setStatus("offline");
          setMessage(result.error || "No shared board reachable.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEntries([]);
        setStatus("offline");
        setMessage("No shared board reachable.");
      });

    return () => {
      cancelled = true;
    };
  }, [scope, songId, difficultyId]);

  const deviceEntries = useMemo(() => {
    return (scores || [])
      .filter((entry) => entry.songId === songId && entry.difficultyId === difficultyId)
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .map((entry, index) => ({
        ...entry,
        rank: index + 1,
        playerName: profileSettings.username || "You"
      }));
  }, [scores, songId, difficultyId, profileSettings.username]);

  const rows = scope === "global" ? entries : deviceEntries;

  return (
    <Shell>
      <section className="page-head">
        <p className="kicker">THE BOARDS</p>
        <h1>WHO'S ON TOP</h1>
        <p className="page-sub">One best run per player, per chart.</p>
      </section>

      <div className="segmented">
        <button
          type="button"
          className={scope === "global" ? "is-active" : ""}
          onClick={() => setScope("global")}
        >
          SHARED
        </button>
        <button
          type="button"
          className={scope === "device" ? "is-active" : ""}
          onClick={() => setScope("device")}
        >
          THIS DEVICE
        </button>
      </div>

      <div className="board-filters">
        <select
          className="input select"
          value={songId}
          onChange={(event) => setSongId(event.target.value)}
        >
          {songs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <div className="gp-diff-row board-diffs">
          {difficulties.map((id) => (
            <button
              key={id}
              type="button"
              className={"gp-diff" + (id === difficultyId ? " is-active" : "")}
              onClick={() => setDifficultyId(id)}
            >
              {song?.difficulties?.[id]?.label || id}
            </button>
          ))}
        </div>
      </div>

      {scope === "global" && status === "loading" ? (
        <div className="card">
          <p>Reading the shared board…</p>
        </div>
      ) : null}

      {scope === "global" && status === "offline" ? (
        <div className="card">
          <p className="kicker">NO SHARED BOARD YET</p>
          <h3>Play with friends</h3>
          <p>
            {message} {BOARD_SETUP_HINT}
          </p>
          <div className="board-actions">
            <button className="btn btn-primary" type="button" onClick={() => navigate("/settings")}>
              BOARD SETUP
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setScope("device")}>
              SEE THIS DEVICE
            </button>
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="board">
          {rows.map((entry, index) => (
            <BoardRow
              key={entry.id || entry.playerId + "-" + (entry.rank || index)}
              entry={entry}
              index={index}
              highlight={scope === "global" ? isSelf(entry) : false}
            />
          ))}
        </div>
      ) : scope === "device" ? (
        <div className="card">
          <p>No runs on this chart yet.</p>
        </div>
      ) : null}

      {scope === "global" && status === "ready" && rows.length === 0 ? (
        <div className="card">
          <p>This chart has no runs on the shared board yet. Be the first.</p>
        </div>
      ) : null}
    </Shell>
  );
}

function ProfilePage({ scores, profileSettings, saveUsername }) {
  const summary = useMemo(() => profileSummary(scores), [scores]);
  const recent = useMemo(() => recentRuns(scores, 5), [scores]);
  const [name, setName] = useState(profileSettings.username || "Player One");

  useEffect(() => {
    setName(profileSettings.username || "Player One");
  }, [profileSettings.username]);

  return (
    <Shell>
      <section className="profile-head">
        <div className="avatar">{(profileSettings.username || "P").slice(0, 1).toUpperCase()}</div>
        <div>
          <p className="kicker">PLAYER</p>
          <h1>{profileSettings.username || "Player One"}</h1>
          <p className="page-sub">
            {summary.plays} runs · {summary.fullCombos} full combos
          </p>
        </div>
      </section>

      <div className="stat-grid">
        <div className="stat-tile">
          <span>Best score</span>
          <strong>{summary.bestScore.toLocaleString()}</strong>
        </div>
        <div className="stat-tile">
          <span>Best grade</span>
          <strong>{summary.bestGrade}</strong>
        </div>
        <div className="stat-tile">
          <span>Avg accuracy</span>
          <strong>{summary.avgAccuracy}%</strong>
        </div>
        <div className="stat-tile">
          <span>Full combos</span>
          <strong>{summary.fullCombos}</strong>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <span>Perfect</span>
          <strong>{summary.perfect}</strong>
        </div>
        <div className="stat-tile">
          <span>Great</span>
          <strong>{summary.great}</strong>
        </div>
        <div className="stat-tile">
          <span>Good</span>
          <strong>{summary.good}</strong>
        </div>
        <div className="stat-tile">
          <span>Miss</span>
          <strong>{summary.miss}</strong>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>NAME ON THE BOARD</h2>
        </div>
        <div className="card name-card">
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Player name"
            maxLength={24}
          />
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => saveUsername(name.trim() || "Player One")}
          >
            SAVE
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>RECENT</h2>
        </div>
        {recent.length ? (
          <div className="board">
            {recent.map((entry) => (
              <div key={entry.id} className="board-row">
                <div className="board-main">
                  <strong>{entry.songTitle}</strong>
                  <span>
                    {entry.difficultyLabel} · {entry.accuracy}%
                  </span>
                </div>
                <GradeChip grade={entry.grade} size="sm" />
                <span className="board-score">{(Number(entry.score) || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="card">
            <p>Nothing played yet.</p>
          </div>
        )}
      </section>
    </Shell>
  );
}

function SettingRow({ label, value, hint, children }) {
  return (
    <label className="setting">
      <span className="setting-head">
        <strong>{label}</strong>
        {value != null ? <em>{value}</em> : null}
      </span>
      {children}
      {hint ? <p className="setting-hint">{hint}</p> : null}
    </label>
  );
}

function DiagnosticsCard() {
  const [count, setCount] = useState(() => getErrorLog().length);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeErrorLog(setCount), []);

  const lines = getErrorLog();

  const copy = () => {
    const text = formatErrorLog();
    try {
      navigator.clipboard.writeText(text).then(
        () => setCopied(true),
        () => setCopied(false)
      );
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="card">
      <p className="setting-hint">
        {count
          ? count +
            " issue" +
            (count === 1 ? "" : "s") +
            " captured on this device. Copy them into a message and they can be fixed."
          : "No issues captured. If something goes wrong, the reason lands here."}
      </p>
      {count ? (
        <>
          <div className="board-actions">
            <button className="btn btn-ghost" type="button" onClick={copy}>
              {copied ? "COPIED" : "COPY ALL"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                clearErrorLog();
                setCopied(false);
              }}
            >
              CLEAR
            </button>
          </div>
          <pre className="error-log">
            {lines.map((entry) => entry.time + "  [" + entry.source + "]  " + entry.message).join("\n")}
          </pre>
        </>
      ) : null}
    </div>
  );
}

function SettingsPage({ settings, updateSetting, resetSettings }) {
  const [savedNote, setSavedNote] = useState("");

  return (
    <Shell>
      <section className="page-head">
        <p className="kicker">SETUP</p>
        <h1>SETTINGS</h1>
        <p className="page-sub">Saved on this device and applied live.</p>
      </section>

      <div className="settings">
        <SettingRow
          label="Chart source"
          value={
            settings.chartMode === "authored"
              ? "SHIPPED"
              : settings.chartMode === "auto"
                ? "AUTO"
                : "FOLLOW SONG"
          }
          hint="Follow Song plays the chart that came with the track where the mapper shipped one, and auto-builds the rest. Auto analyses every track on a beat grid; Shipped forces the shipped chart. The active source shows on every ready screen."
        >
          <div className="segmented">
            <button
              type="button"
              className={settings.chartMode === "song" || (settings.chartMode !== "authored" && settings.chartMode !== "auto") ? "is-active" : ""}
              onClick={() => updateSetting("chartMode", "song")}
            >
              FOLLOW SONG
            </button>
            <button
              type="button"
              className={settings.chartMode === "auto" ? "is-active" : ""}
              onClick={() => updateSetting("chartMode", "auto")}
            >
              AUTO
            </button>
            <button
              type="button"
              className={settings.chartMode === "authored" ? "is-active" : ""}
              onClick={() => updateSetting("chartMode", "authored")}
            >
              SHIPPED
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label="Note speed"
          value={Number(settings.noteSpeed).toFixed(2) + "x"}
          hint="Higher values bring notes in faster. 1.00 is relaxed, 1.60 is a speed run."
        >
          <input
            className="range"
            type="range"
            min="0.8"
            max="1.8"
            step="0.05"
            value={settings.noteSpeed}
            onChange={(event) => updateSetting("noteSpeed", Number(event.target.value))}
          />
        </SettingRow>

        <SettingRow
          label="Backdrop brightness"
          value={Math.round((Number(settings.videoOpacity) || 0) * 100) + "%"}
          hint="The music video, or the cover art when a track has no video, sits behind the highway. Dim it if notes get harder to read."
        >
          <input
            className="range"
            type="range"
            min="0"
            max="0.8"
            step="0.02"
            value={settings.videoOpacity}
            onChange={(event) => updateSetting("videoOpacity", Number(event.target.value))}
          />
        </SettingRow>

        <SettingRow
          label="Calibration offset"
          value={(Number(settings.calibrationOffset) || 0) + " ms"}
          hint="Hitting early but reading late? Nudge this up. Negative shifts everything earlier."
        >
          <input
            className="range"
            type="range"
            min="-150"
            max="150"
            step="5"
            value={settings.calibrationOffset}
            onChange={(event) => updateSetting("calibrationOffset", Number(event.target.value))}
          />
        </SettingRow>

        <SettingRow label="Hit sounds" hint="Bed squeak on perfects, plus taps and misses.">
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.hitSounds !== false}
              onChange={(event) => updateSetting("hitSounds", event.target.checked)}
            />
            <span>{settings.hitSounds !== false ? "ON" : "OFF"}</span>
          </span>
        </SettingRow>

        <SettingRow label="Haptics" hint="Taps on hits, holds, chants and misses inside the app.">
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.haptics !== false}
              onChange={(event) => updateSetting("haptics", event.target.checked)}
            />
            <span>{settings.haptics !== false ? "ON" : "OFF"}</span>
          </span>
        </SettingRow>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>ONLINE</h2>
        </div>
        <div className="card">
          <p className="setting-hint">
            Battles and shared leaderboards are coming soon — this release is
            single-player, and every score stays on this device.
          </p>
        </div>
      </section>

      <section className="section settings-actions">
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => {
            clearAutoChartCache();
            setSavedNote("Generated charts cleared — they rebuild on the next run");
          }}
        >
          REBUILD AUTO CHARTS
        </button>
        <button className="btn btn-ghost" type="button" onClick={resetSettings}>
          RESET SETTINGS
        </button>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>DIAGNOSTICS</h2>
        </div>
        <DiagnosticsCard />
      </section>
    </Shell>
  );
}

export default function App() {
  const [settings, setSettings] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    return getSavedSettings();
  });

  const [scores, setScores] = useState(() => {
    if (typeof window === "undefined") return [];
    return loadScores();
  });

  const [profileSettings, setProfileSettings] = useState(() => {
    if (typeof window === "undefined") return { username: "Player One" };
    return loadProfileSettings();
  });

  const [chartOffsets] = useState(() => {
    if (typeof window === "undefined") return {};
    return loadChartOffsets();
  });

  useEffect(() => {
    try {
      localStorage.setItem("jersey-rhythm-settings", JSON.stringify(settings));
    } catch {
      /* storage is optional */
    }
  }, [settings]);

  const updateSetting = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const resetSettings = () => setSettings(DEFAULT_SETTINGS);

  const handleSaveResult = (entry) => {
    const next = saveScoreEntry(entry);
    setScores(next);
  };

  const saveUsername = (username) => {
    const next = { ...profileSettings, username };
    setProfileSettings(next);
    saveProfileSettings(next);
  };

  return (
    <Routes>
      <Route path="/" element={<HomePage scores={scores} />} />
      <Route path="/play" element={<PlayPage scores={scores} />} />
      <Route path="/song/:songId" element={<SongDetailPage scores={scores} />} />
      <Route path="/battle" element={<ComingSoonPage />} />
      <Route path="/battle/:roomId" element={<ComingSoonPage />} />
      <Route
        path="/gameplay/:songId/:difficultyId"
        element={
          <GameplayPageV2
            settings={settings}
            onSaveResult={handleSaveResult}
            chartOffsets={chartOffsets}
            scores={scores}
            playerName={profileSettings.username || "Player One"}
          />
        }
      />
      <Route path="/leaderboards" element={<ComingSoonPage />} />
      <Route
        path="/profile"
        element={
          <ProfilePage
            scores={scores}
            profileSettings={profileSettings}
            saveUsername={saveUsername}
          />
        }
      />
      <Route
        path="/settings"
        element={
          <SettingsPage
            settings={settings}
            updateSetting={updateSetting}
            resetSettings={resetSettings}
          />
        }
      />
    </Routes>
  );
}
