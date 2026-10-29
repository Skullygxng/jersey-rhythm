import { io } from "socket.io-client";

import { getSocketUrl } from "./gameConfig.js";

let socket = null;
let socketUrl = "";

// The zero-build host loads this module as a bridge over window.io; when the
// socket.io bundle is not on the page the import resolves to undefined, so
// every caller has to treat "no library" the same as "no server".
function ioFactory() {
  return typeof io === "function" ? io : null;
}

/** Returns a socket only when a realtime server is configured. */
export function getSocket() {
  const url = getSocketUrl();
  const create = ioFactory();
  if (!url || !create) return null;

  if (!socket || socketUrl !== url) {
    if (socket) {
      try {
        socket.disconnect();
      } catch {
        /* already gone */
      }
    }
    socketUrl = url;
    socket = create(url, {
      autoConnect: false,
      transports: ["websocket", "polling"]
    });
  }

  return socket;
}

export function connectSocket() {
  const instance = getSocket();
  if (!instance) return null;
  if (!instance.connected) instance.connect();
  return instance;
}

export function disconnectSocket() {
  if (socket && socket.connected) socket.disconnect();
}

export function resetSocket() {
  disconnectSocket();
  socket = null;
  socketUrl = "";
}

export function isRealtimeConfigured() {
  return Boolean(getSocketUrl()) && Boolean(ioFactory());
}
