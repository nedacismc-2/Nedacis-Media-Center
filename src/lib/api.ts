import type { WSEvent } from '../types';

const TOKEN_KEY = 'mmc_smpn2_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) headers.set('X-Timezone', tz);
  } catch {
    // ignore if Intl unavailable
  }
  headers.set('X-Timezone-Offset', String(new Date().getTimezoneOffset()));

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Terjadi kesalahan pada server.');
  }
  return data as T;
}

export function connectRealtimeSocket(
  token: string | null,
  onEvent: (event: WSEvent) => void,
  onStatusChange?: (connected: boolean) => void
): () => void {
  let ws: WebSocket | null = null;
  let closedByCaller = false;
  let reconnectTimer: number | null = null;

  const connect = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws${query}`);

    ws.onopen = () => {
      onStatusChange?.(true);
    };

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as WSEvent;
        onEvent(parsed);
      } catch {
        // ignore invalid json
      }
    };

    ws.onclose = () => {
      onStatusChange?.(false);
      if (!closedByCaller) {
        reconnectTimer = window.setTimeout(connect, 2500);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();

  return () => {
    closedByCaller = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    ws?.close();
  };
}
