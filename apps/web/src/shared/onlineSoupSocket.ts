export function connectOnlineSoupSocket(
  roomId: string,
  onChanged: (reason: string, payload: Record<string, unknown>) => void,
  onConnectionChange?: (connected: boolean) => void
) {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let pingTimer: number | null = null;
  let reconnectAttempt = 0;
  let lastPongAt = 0;

  const connect = () => {
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/ws/online-soup?roomId=${encodeURIComponent(roomId)}`);
    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
      lastPongAt = Date.now();
      onConnectionChange?.(true);
      pingTimer = window.setInterval(() => {
        if (socket?.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastPongAt > 75_000) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "ping" }));
      }, 30_000);
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.event === "pong") {
          lastPongAt = Date.now();
          return;
        }
        if (message.event === "online_soup_changed" && message.payload?.roomId === roomId) {
          onChanged(String(message.payload.reason ?? "changed"), message.payload);
        }
      } catch { /* Ignore malformed frames. */ }
    });
    socket.addEventListener("close", () => {
      onConnectionChange?.(false);
      if (pingTimer != null) window.clearInterval(pingTimer);
      if (!closed) {
        const baseDelay = Math.min(30_000, 1_000 * (2 ** Math.min(reconnectAttempt, 5)));
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, baseDelay + Math.floor(Math.random() * 500));
      }
    });
    socket.addEventListener("error", () => socket?.close());
  };

  connect();
  return () => {
    closed = true;
    if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    if (pingTimer != null) window.clearInterval(pingTimer);
    socket?.close();
  };
}

export function connectOnlineSoupLobbySocket(
  onChanged: (reason: string) => void,
  onConnectionChange?: (connected: boolean) => void
) {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let pingTimer: number | null = null;
  let reconnectAttempt = 0;
  let lastPongAt = 0;

  const connect = () => {
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/ws/online-soup-lobby`);
    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
      lastPongAt = Date.now();
      onConnectionChange?.(true);
      pingTimer = window.setInterval(() => {
        if (socket?.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastPongAt > 75_000) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "ping" }));
      }, 30_000);
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.event === "pong") {
          lastPongAt = Date.now();
          return;
        }
        if (message.event === "online_soup_lobby_changed") {
          onChanged(String(message.payload?.reason ?? "changed"));
        }
      } catch { /* Ignore malformed frames. */ }
    });
    socket.addEventListener("close", () => {
      onConnectionChange?.(false);
      if (pingTimer != null) window.clearInterval(pingTimer);
      if (!closed) {
        const baseDelay = Math.min(30_000, 1_000 * (2 ** Math.min(reconnectAttempt, 5)));
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, baseDelay + Math.floor(Math.random() * 500));
      }
    });
    socket.addEventListener("error", () => socket?.close());
  };

  connect();
  return () => {
    closed = true;
    if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    if (pingTimer != null) window.clearInterval(pingTimer);
    socket?.close();
  };
}
