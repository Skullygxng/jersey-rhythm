import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { songs, isPlayableDifficulty } from "../data/songLibrary.js";
import { resolveChart } from "../lib/autoChart.js";
import { getApiBase, getSocketUrl } from "../lib/gameConfig.js";
import { connectSocket, getSocket, isRealtimeConfigured } from "../lib/socket.js";
import { Shell } from "./shell.jsx";

const DIFFICULTY_ORDER = ["easy", "normal", "hard"];
const LABELS = { easy: "Easy", normal: "Normal", hard: "Hard" };

function statusLabel(status) {
  switch (status) {
    case "countdown":
      return "STARTING";
    case "live":
      return "LIVE";
    case "finished":
      return "FINISHED";
    default:
      return "OPEN";
  }
}

function ServerNotice() {
  const api = getApiBase();
  const socketUrl = getSocketUrl();
  return (
    <div className="card battle-notice">
      <p className="kicker">NO BATTLE SERVER</p>
      <h3>Realtime is not configured</h3>
      <p>
        Battles, spectating and spectator chat need a small Node host running
        <code> server/serve.js </code> — GitHub Pages cannot run sockets. Point this build at it
        with <code>JR_API_BASE</code> / <code>JR_SOCKET_URL</code> at build time (written into
        <code>config.js</code>), or set a board URL in
        Settings.
      </p>
      <p className="battle-note-meta">
        API: {api || "none"} · Socket: {socketUrl || "none"}
      </p>
      <div className="board-actions">
        <Link className="btn btn-ghost" to="/settings">
          OPEN SETTINGS
        </Link>
      </div>
    </div>
  );
}

function ChatPanel({ messages, canChat, disabledReason, onSend, playerName }) {
  const [text, setDraft] = useState("");

  const submit = (event) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || !canChat) return;
    onSend(value);
    setText("");
  };

  return (
    <div className="battle-chat">
      <div className="battle-chat-head">
        <strong>ROOM CHAT</strong>
        <span>{canChat ? "OPEN" : "MUTED"}</span>
      </div>
      <div className="battle-chat-log">
        {chatList()}
      </div>
      <form className="battle-chat-form" onSubmit={submit}>
        <input
          className="input"
          value={text}
          maxLength={140}
          placeholder={canChat ? "Say something to the room" : disabledReason}
          disabled={!canChat}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={!canChat || !text.trim()}>
          SEND
        </button>
      </form>
      <p className="battle-chat-note">
        Players are muted by the server while a battle is loading, counting down or live.
        {playerName ? " Chatting as " + playerName : ""}
      </p>
    </div>
  );

  function chatList() {
    if (!messages.length) return <p className="battle-chat-empty">No messages yet.</p>;
    return messages.map((message) => (
      <p key={message.id} className={"battle-chat-line role-" + message.role}>
        <strong>{message.name}</strong>
        <span>{message.text}</span>
      </p>
    ));
  }
}

function PlayerRow({ player, isSelf, showProgress }) {
  return (
    <div className={"battle-player" + (isSelf ? " is-me" : "")}>
      <div className="battle-player-head">
        <strong>{player.name}</strong>
        <span className={"battle-player-state state-" + (player.finished ? "done" : "live")}>
          {player.finished ? player.grade || "DONE" : player.ready ? "READY" : "SETTING UP"}
        </span>
      </div>
      <div className="battle-player-score">
        <span>{(Number(player.score) || 0).toLocaleString()}</span>
        <em>{Number(player.accuracy) || 0}%</em>
        <em>{Number(player.combo) || 0}x</em>
      </div>
      {showProgress ? (
        <div className="battle-progress">
          <span style={{ width: Math.min(100, Math.max(0, Number(player.progress) || 0)) + "%" }} />
        </div>
      ) : null}
    </div>
  );
}

export function BattleHubPage({ profileSettings }) {
  const navigate = useNavigate();
  const socket = useMemo(() => getSocket(), []);
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [playerName, setPlayerName] = useState(profileSettings.username || "Player One");
  const [songId, setSongId] = useState(songs[0]?.id || "");
  const [difficultyId, setDifficultyId] = useState("normal");

  const configured = isRealtimeConfigured();
  const song = songs.find((item) => item.id === songId) || null;
  // Uploads only exist on the uploading device, so they cannot be battled.
  const battleSongs = songs.filter((item) => !item.uploaded);
  const difficulties = DIFFICULTY_ORDER.filter((id) =>
    isPlayableDifficulty(song?.difficulties?.[id])
  );

  useEffect(() => {
    setPlayerName(profileSettings.username || "Player One");
  }, [profileSettings.username]);

  useEffect(() => {
    if (!socket) return undefined;
    connectSocket();

    const onRooms = (list) => setRooms(Array.isArray(list) ? list : []);
    const onJoined = (payload) => {
      if (payload && payload.roomId) navigate("/battle/" + payload.roomId);
    };
    const onError = (payload) => setError((payload && payload.message) || "Battle error");

    socket.on("battle:rooms", onRooms);
    socket.on("battle:joined", onJoined);
    socket.on("battle:error", onError);
    socket.emit("battle:list");

    const timer = setInterval(() => socket.emit("battle:list"), 6000);
    return () => {
      clearInterval(timer);
      socket.off("battle:rooms", onRooms);
      socket.off("battle:joined", onJoined);
      socket.off("battle:error", onError);
    };
  }, [socket, navigate]);

  const create = () => {
    setError("");
    if (!socket) return;
    if (!song) {
      setError("No track selected.");
      return;
    }
    const chosen = difficulties.indexOf(difficultyId) !== -1 ? difficultyId : difficulties[0];
    if (!chosen) {
      setError("That track has no playable chart yet.");
      return;
    }
    socket.emit("battle:create", {
      playerName,
      visibility,
      songId: song.id,
      difficultyId: chosen
    });
  };

  const join = (event) => {
    event.preventDefault();
    setError("");
    if (!socket) return;
    if (!joinCode.trim()) {
      setError("Enter a room code.");
      return;
    }
    socket.emit("battle:join", { code: joinCode.trim(), playerName });
  };

  return (
    <Shell>
      <section className="page-head">
        <p className="kicker">BATTLE / CYPHER</p>
        <h1>1V1 BATTLES</h1>
        <p className="page-sub">
          Head-to-head runs on the same chart. Anyone can watch, and the watchers get the
          chatbox while the players are locked in.
        </p>
      </section>

      {!configured ? <ServerNotice /> : null}

      <section className="section">
        <div className="battle-grid">
          <div className="card">
            <p className="kicker">HOST</p>
            <h3>Start a battle</h3>

            <label className="battle-field">
              <span>Your name</span>
              <input
                className="input"
                value={playerName}
                maxLength={18}
                onChange={(event) => setPlayerName(event.target.value)}
              />
            </label>

            <label className="battle-field">
              <span>Track</span>
              <select
                className="input select"
                value={songId}
                onChange={(event) => {
                  setSongId(event.target.value);
                  const next = songs.find((item) => item.id === event.target.value);
                  const available = DIFFICULTY_ORDER.filter((id) =>
                    isPlayableDifficulty(next?.difficulties?.[id])
                  );
                  if (available.length && available.indexOf(difficultyId) === -1) {
                    setDifficultyId(available[0]);
                  }
                }}
              >
                {battleSongs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="gp-diff-row">
              {difficulties.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={"gp-diff" + (id === difficultyId ? " is-active" : "")}
                  onClick={() => setDifficultyId(id)}
                >
                  {LABELS[id]}
                </button>
              ))}
            </div>

            <div className="segmented battle-visibility">
              <button
                type="button"
                className={visibility === "public" ? "is-active" : ""}
                onClick={() => setVisibility("public")}
              >
                PUBLIC
              </button>
              <button
                type="button"
                className={visibility === "private" ? "is-active" : ""}
                onClick={() => setVisibility("private")}
              >
                PRIVATE
              </button>
            </div>

            <button
              className="btn btn-primary battle-submit"
              type="button"
              onClick={create}
              disabled={!socket}
            >
              CREATE ROOM
            </button>
          </div>

          <div className="card">
            <p className="kicker">GUEST</p>
            <h3>Join with a code</h3>
            <form className="battle-field" onSubmit={join}>
              <span>Room code</span>
              <div className="battle-code-row">
                <input
                  className="input"
                  value={joinCode}
                  maxLength={8}
                  placeholder="A1B2"
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                />
                <button className="btn btn-primary" type="submit" disabled={!socket}>
                  JOIN
                </button>
              </div>
            </form>
            <p className="battle-note">
              A room seats two players. Once it starts, extra arrivals become spectators.
            </p>
          </div>
        </div>
      </section>

      {error ? <p className="upload-error">{error}</p> : null}

      <section className="section">
        <div className="section-head">
          <h2>PUBLIC ROOMS</h2>
        </div>

        {rooms.length ? (
          <div className="battle-rooms">
            {rooms.map((room) => {
              const songInfo = songs.find((item) => item.id === room.songId);
              return (
                <div key={room.roomId} className="battle-room-card">
                  <div className="battle-room-main">
                    <strong>
                      {songInfo ? songInfo.title : "Track"} ·{" "}
                      {LABELS[room.difficultyId] || room.difficultyId}
                    </strong>
                    <span>
                      {room.players.map((player) => player.name).join(" vs ") || "Waiting"} · code{" "}
                      {room.code}
                    </span>
                  </div>
                  <span className={"battle-state state-" + room.status}>
                    {statusLabel(room.status)}
                  </span>
                  <span className="battle-room-watch">{room.spectatorCount} watching</span>
                  <div className="battle-room-actions">
                    <Link className="btn btn-ghost" to={"/battle/" + room.roomId + "?watch=1"}>
                      WATCH
                    </Link>
                    {room.status === "lobby" ? (
                      <Link className="btn btn-primary" to={"/battle/" + room.roomId}>
                        JOIN
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <p>No public rooms right now. Host one and it shows up here.</p>
          </div>
        )}
      </section>
    </Shell>
  );
}

export function BattleRoomPage({ profileSettings }) {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const watch = searchParams.get("watch") === "1";
  const socket = useMemo(() => getSocket(), []);

  const [room, setRoom] = useState(null);
  const [chat, setChat] = useState([]);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(null);
  const [copied, setCopied] = useState(false);

  const playerName = profileSettings.username || "Player One";
  const self = room && socket ? room.players.find((player) => player.id === socket.id) : null;
  const isHost = Boolean(room && socket && room.hostId === socket.id);
  const isPlayer = Boolean(self);
  const configured = isRealtimeConfigured();

  useEffect(() => {
    if (!socket) return undefined;
    connectSocket();

    const onState = (state) => {
      if (!state || state.roomId !== roomId) return;
      // Trust nothing from the wire: a malformed room must not blank the page.
      setRoom({
        ...state,
        players: Array.isArray(state.players) ? state.players : [],
        spectatorCount: Number(state.spectatorCount) || 0
      });
      if (state.status === "finished") {
        setFinished((prev) => prev || { winnerId: state.winnerId });
      }
    };
    const onChat = (list) => setChat(Array.isArray(list) ? list : []);
    const onError = (payload) => setError((payload && payload.message) || "Battle error");
    const onFinished = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      setFinished(payload);
    };
    const onStart = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      if (watch) return;
      const localStart = Date.now() + (Number(payload.startsInMs) || 0);
      const params = new URLSearchParams();
      params.set("battle", roomId);
      params.set("start", String(localStart));
      navigate(
        "/gameplay/" +
          encodeURIComponent(payload.songId) +
          "/" +
          encodeURIComponent(payload.difficultyId) +
          "?" +
          params.toString()
      );
    };

    socket.on("battle:state", onState);
    socket.on("battle:chat", onChat);
    socket.on("battle:error", onError);
    socket.on("battle:finished", onFinished);
    socket.on("battle:start", onStart);

    if (watch) socket.emit("battle:spectate", { roomId, playerName });
    else socket.emit("battle:join", { roomId, playerName });

    return () => {
      socket.off("battle:state", onState);
      socket.off("battle:chat", onChat);
      socket.off("battle:error", onError);
      socket.off("battle:finished", onFinished);
      socket.off("battle:start", onStart);
    };
  }, [socket, roomId, watch, navigate, playerName]);

  // Warm the chart so the battle can start instantly on both sides.
  useEffect(() => {
    if (watch || !socket || !room || room.status !== "lobby") return undefined;
    const song = songs.find((item) => item.id === room.songId);
    if (!song) return undefined;
    let cancelled = false;

    resolveChart(song, room.difficultyId, { mode: "auto" })
      .then(() => {
        if (!cancelled) socket.emit("battle:loaded", { roomId });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [watch, socket, room && room.songId, room && room.difficultyId, room && room.status, roomId]);

  const ready = () => {
    if (!socket || !self) return;
    socket.emit("battle:ready", { roomId, ready: !self.ready });
  };

  const start = () => {
    if (!socket) return;
    socket.emit("battle:start", { roomId });
  };

  const rematch = () => {
    if (!socket) return;
    setFinished(null);
    socket.emit("battle:rematch", { roomId });
  };

  const leave = () => {
    if (socket) socket.emit("battle:leave", { roomId });
    navigate("/battle");
  };

  const setSettings = (nextSongId, nextDifficulty) => {
    if (!socket) return;
    socket.emit("battle:settings", {
      roomId,
      songId: nextSongId,
      difficultyId: nextDifficulty
    });
  };

  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard is optional */
    }
  };

  const canChat = Boolean(
    !isPlayer || (room && (room.status === "lobby" || room.status === "finished" || (self && self.finished)))
  );
  const chatReason = isPlayer
    ? room && room.status === "countdown"
      ? "Chat opens after the battle"
      : "Players are muted during a battle"
    : "Join to chat";

  if (!configured) {
    return (
      <Shell>
        <ServerNotice />
      </Shell>
    );
  }

  if (!room) {
    return (
      <Shell>
        <section className="page-head">
          <p className="kicker">BATTLE</p>
          <h1>CONNECTING…</h1>
          <button className="btn btn-ghost" type="button" onClick={leave}>
            BACK
          </button>
        </section>
        {error ? <p className="upload-error">{error}</p> : null}
      </Shell>
    );
  }

  const song = songs.find((item) => item.id === room.songId) || null;
  const battleSongs = songs.filter((item) => !item.uploaded);
  const availableDifficulties = DIFFICULTY_ORDER.filter((id) =>
    isPlayableDifficulty(song?.difficulties?.[id])
  );

  return (
    <Shell>
      <section className="battle-head">
        <div>
          <p className="kicker">{watch ? "WATCHING" : "BATTLE"} · CODE {room.code}</p>
          <h1>{song ? song.title : "Battle"}</h1>
          <p className="page-sub">
            {LABELS[room.difficultyId] || room.difficultyId} · {statusLabel(room.status)} ·{" "}
            {room.spectatorCount} watching
          </p>
        </div>
        <div className="battle-head-actions">
          <button className="btn btn-ghost" type="button" onClick={copyCode}>
            {copied ? "COPIED" : "COPY CODE"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={leave}>
            {watch ? "LEAVE" : "LEAVE ROOM"}
          </button>
        </div>
      </section>

      {error ? <p className="upload-error">{error}</p> : null}

      <div className="battle-layout">
        <div className="battle-main">
          <div className="battle-players">
            {room.players.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                isSelf={Boolean(socket && player.id === socket.id)}
                showProgress={room.status === "live" || room.status === "finished"}
              />
            ))}
            {room.players.length < 2 ? (
              <div className="battle-player battle-player-empty">
                <strong>Waiting for a challenger</strong>
                <span>Share code {room.code}</span>
              </div>
            ) : null}
          </div>

          {finished ? (
            <div className="card battle-result">
              <p className="kicker">RESULT</p>
              <h3>
                {finished.winnerId
                  ? (room.players.find((player) => player.id === finished.winnerId) || {}).name ||
                    "Winner"
                  : "Draw"}
              </h3>
              <p>
                {room.players
                  .map(
                    (player) =>
                      player.name +
                      ": " +
                      (Number(player.score) || 0).toLocaleString() +
                      " (" +
                      (Number(player.accuracy) || 0) +
                      "%)"
                  )
                  .join("  ·  ")}
              </p>
            </div>
          ) : null}

          {!watch ? (
            <div className="battle-controls">
              {isHost && room.status === "lobby" ? (
                <div className="battle-host">
                  <label className="battle-field">
                    <span>Track</span>
                    <select
                      className="input select"
                      value={room.songId}
                      onChange={(event) => {
                        const next = songs.find((item) => item.id === event.target.value);
                        const nextDifficulties = DIFFICULTY_ORDER.filter((id) =>
                          isPlayableDifficulty(next?.difficulties?.[id])
                        );
                        const keep = nextDifficulties.indexOf(room.difficultyId) !== -1;
                        setSettings(
                          event.target.value,
                          keep ? room.difficultyId : nextDifficulties[0] || "normal"
                        );
                      }}
                    >
                      {battleSongs.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="gp-diff-row">
                    {availableDifficulties.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={"gp-diff" + (id === room.difficultyId ? " is-active" : "")}
                        onClick={() => setSettings(room.songId, id)}
                      >
                        {LABELS[id]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="battle-actions">
                {isPlayer ? (
                  <button className="btn btn-primary" type="button" onClick={ready}>
                    {self && self.ready ? "CANCEL READY" : "READY"}
                  </button>
                ) : null}
                {isHost && room.status === "lobby" ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={start}
                    disabled={room.players.length < 2}
                  >
                    START
                  </button>
                ) : null}
                {room.status === "finished" && isHost ? (
                  <button className="btn btn-primary" type="button" onClick={rematch}>
                    REMATCH
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="card battle-watch-note">
              <p>
                You are spectating. The players cannot read the room chat while they play, so
                talk freely — when the battle ends they can read it back.
              </p>
            </div>
          )}
        </div>

        <aside className="battle-side">
          <ChatPanel
            messages={chat}
            canChat={canChat}
            disabledReason={chatReason}
            playerName={playerName}
            onSend={(text) => {
              if (socket) socket.emit("battle:chat", { roomId, text });
            }}
          />
        </aside>
      </div>
    </Shell>
  );
}
