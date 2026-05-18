type PerfMetadata = Record<string, unknown>;

export type PerfEvent = {
  type: 'mark' | 'measure' | 'error';
  name: string;
  timestamp: string;
  sinceStartMs: number;
  durationMs?: number;
  metadata?: PerfMetadata;
};

type PerfApi = {
  enable: () => void;
  disable: () => void;
  clear: () => void;
  dump: () => PerfEvent[];
  table: () => void;
  isEnabled: () => boolean;
};

type PerfWindow = Window & {
  floodiPerf?: PerfApi;
  __floodiPerfInstalled?: boolean;
};

const STORAGE_KEY = 'floodi.perfLogging';
const SESSION_EVENTS_KEY = 'floodi.perfEvents';
const MAX_EVENTS = 300;
const bootNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
const events: PerfEvent[] = [];

const isBrowser = () => typeof window !== 'undefined';

const getWindow = (): PerfWindow | null => isBrowser() ? (window as PerfWindow) : null;

const safeSessionWrite = () => {
  try {
    sessionStorage.setItem(SESSION_EVENTS_KEY, JSON.stringify(events));
  } catch {
    // Ignore storage failures; console logging is still useful.
  }
};

const hasQueryFlag = () => {
  if (!isBrowser()) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return ['perf', 'debugPerf', 'floodiPerf'].some((key) => {
      const value = params.get(key);
      return value === '' || value === '1' || value === 'true';
    });
  } catch {
    return false;
  }
};

export const isPerfLoggingEnabled = () => {
  if (import.meta.env.VITE_PERF_LOGGING === '1') return true;
  if (!isBrowser()) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1' || hasQueryFlag();
  } catch {
    return hasQueryFlag();
  }
};

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

const pushEvent = (event: PerfEvent) => {
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  safeSessionWrite();
};

const logToConsole = (event: PerfEvent) => {
  if (!isPerfLoggingEnabled()) return;
  const duration = event.durationMs === undefined ? '' : ` ${event.durationMs.toFixed(1)}ms`;
  const sinceStart = `+${event.sinceStartMs.toFixed(1)}ms`;
  const payload = event.metadata ? [event.metadata] : [];
  const logger = event.type === 'error' ? console.warn : console.info;
  logger(`[perf] ${event.type} ${event.name}${duration} ${sinceStart}`, ...payload);
};

const emit = (
  type: PerfEvent['type'],
  name: string,
  metadata?: PerfMetadata,
  durationMs?: number
) => {
  const event: PerfEvent = {
    type,
    name,
    timestamp: new Date().toISOString(),
    sinceStartMs: now() - bootNow,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(metadata ? { metadata } : {}),
  };
  pushEvent(event);
  logToConsole(event);
  return event;
};

const errorMetadata = (metadata: PerfMetadata | undefined, error: unknown): PerfMetadata => ({
  ...metadata,
  error: error instanceof Error ? error.message : String(error),
});

export const markPerf = (name: string, metadata?: PerfMetadata) => {
  if (!isPerfLoggingEnabled()) return;
  emit('mark', name, metadata);
};

export const measurePerf = async <T>(
  name: string,
  task: () => Promise<T>,
  metadata?: PerfMetadata
): Promise<T> => {
  if (!isPerfLoggingEnabled()) return task();
  const startedAt = now();
  try {
    const result = await task();
    emit('measure', name, metadata, now() - startedAt);
    return result;
  } catch (error) {
    emit('error', name, errorMetadata(metadata, error), now() - startedAt);
    throw error;
  }
};

export const measurePerfSync = <T>(name: string, task: () => T, metadata?: PerfMetadata): T => {
  if (!isPerfLoggingEnabled()) return task();
  const startedAt = now();
  try {
    const result = task();
    emit('measure', name, metadata, now() - startedAt);
    return result;
  } catch (error) {
    emit('error', name, errorMetadata(metadata, error), now() - startedAt);
    throw error;
  }
};

export const installPerfLogger = () => {
  const win = getWindow();
  if (!win || win.__floodiPerfInstalled) return;
  win.__floodiPerfInstalled = true;
  win.floodiPerf = {
    enable: () => {
      localStorage.setItem(STORAGE_KEY, '1');
      console.info('[perf] enabled. Reload the app to capture full startup.');
    },
    disable: () => {
      localStorage.removeItem(STORAGE_KEY);
      console.info('[perf] disabled.');
    },
    clear: () => {
      events.length = 0;
      try {
        sessionStorage.removeItem(SESSION_EVENTS_KEY);
      } catch {
        // Ignore storage failures.
      }
    },
    dump: () => [...events],
    table: () => console.table(events),
    isEnabled: isPerfLoggingEnabled,
  };

  if (isPerfLoggingEnabled()) {
    markPerf('perfLogger.installed', {
      userAgent: navigator.userAgent,
      connection: (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection,
    });
  }
};
