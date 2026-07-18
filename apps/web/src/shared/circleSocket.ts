export type CircleSocketEvent = {
  event: string;
  payload?: Record<string, unknown>;
};

export function connectCircleSocket(
  circleId: string,
  onEvent: (event: CircleSocketEvent) => void,
  onConnectionChange?: (connected: boolean) => void
) {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/ws/circles?circleId=${encodeURIComponent(circleId)}`);
    socket.addEventListener("open", () => {
      onConnectionChange?.(true);
      heartbeatTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 25_000);
    });
    socket.addEventListener("message", (message) => {
      try {
        onEvent(JSON.parse(message.data) as CircleSocketEvent);
      } catch {
        // Ignore malformed server frames.
      }
    });
    socket.addEventListener("close", () => {
      onConnectionChange?.(false);
      if (heartbeatTimer != null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (!closed) reconnectTimer = window.setTimeout(connect, 1_500);
    });
    socket.addEventListener("error", () => socket?.close());
  };

  connect();
  return () => {
    closed = true;
    if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    if (heartbeatTimer != null) window.clearInterval(heartbeatTimer);
    socket?.close();
  };
}
