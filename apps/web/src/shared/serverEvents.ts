type ServerEventListener = (event: MessageEvent<string>) => void;

const listeners = new Map<string, Set<ServerEventListener>>();
let source: EventSource | null = null;

function ensureSource() {
  if (source || listeners.size === 0) return;
  source = new EventSource("/api/events", { withCredentials: true });
  for (const [type, typeListeners] of listeners) {
    const handler = dispatch(type, typeListeners);
    dispatchers.set(type, handler);
    source.addEventListener(type, handler);
  }
}

function dispatch(_type: string, typeListeners: Set<ServerEventListener>) {
  return (event: Event) => {
    for (const listener of typeListeners) listener(event as MessageEvent<string>);
  };
}

const dispatchers = new Map<string, EventListener>();

export function resetServerEventConnection() {
  source?.close();
  source = null;
  dispatchers.clear();
}

export function subscribeServerEvent(type: string, listener: ServerEventListener) {
  let typeListeners = listeners.get(type);
  if (!typeListeners) {
    typeListeners = new Set();
    listeners.set(type, typeListeners);
    if (source) {
      const handler = dispatch(type, typeListeners);
      dispatchers.set(type, handler);
      source.addEventListener(type, handler);
    }
  }
  typeListeners.add(listener);
  ensureSource();

  return () => {
    const current = listeners.get(type);
    current?.delete(listener);
    if (current?.size === 0) {
      listeners.delete(type);
      const handler = dispatchers.get(type);
      if (source && handler) source.removeEventListener(type, handler);
      dispatchers.delete(type);
    }
    if (listeners.size === 0) {
      source?.close();
      source = null;
      dispatchers.clear();
    }
  };
}
