import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Development mirrors scheduled server inference. HTTP reads only return the
 * public cache; they cannot trigger training, weather retrieval or Gemini. */
export function localForecastRefreshPlugin(): Plugin {
  let stop: (() => void) | undefined;
  return {
    name: 'local-scheduled-flood-outlook',
    apply: (_, environment) => environment.command === 'serve' && environment.mode !== 'test' && !process.env.VITEST,
    configureServer(server) {
      stop = startLocalForecastRefresh({
        functionsDirectory: join(server.config.root, 'functions'),
        onUpdated: () => server.ws.send({ type: 'custom', event: 'floodi:outlook-updated', data: {} }),
        onWarning: message => server.config.logger.warn(`[FloodCast] ${message}`),
      });
      server.httpServer?.once('close', () => stop?.());
    },
    closeBundle() { stop?.(); },
  };
}

export interface LocalRefreshOptions {
  functionsDirectory: string;
  onUpdated: () => void;
  onWarning: (message: string) => void;
  refreshEveryMs?: number;
}

export function startLocalForecastRefresh({ functionsDirectory, onUpdated, onWarning, refreshEveryMs = 10 * 60_000 }: LocalRefreshOptions): () => void {
  let stopped = false;
  let running = false;
  let built = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let child: ChildProcess | undefined;
  let terminateChild: (() => void) | undefined;
  const evaluationDirectory = join(functionsDirectory, 'evaluation');
  const archiveName = /^regional-gauge-history-\d{4}-\d\d-\d\d-90d\.json$/;

  const command = (script: string, args: string[]) => new Promise<void>((complete, reject) => {
    if (stopped) { complete(); return; }
    const current = spawn(process.execPath, [script, ...args], { cwd: functionsDirectory, stdio: ['ignore', 'ignore', 'pipe'] });
    child = current;
    let error = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const terminate = () => {
      current.kill('SIGTERM');
      if (!killTimer) killTimer = setTimeout(() => current.kill('SIGKILL'), 5000);
    };
    terminateChild = terminate;
    const watchdog = setTimeout(() => {
      timedOut = true;
      terminate();
    }, 5 * 60_000);
    const cleanup = () => {
      clearTimeout(watchdog);
      clearTimeout(killTimer);
      if (child === current) child = undefined;
      if (terminateChild === terminate) terminateChild = undefined;
    };
    current.stderr?.on('data', data => { error = (error + String(data)).slice(-2000); });
    current.once('error', cause => { cleanup(); reject(cause); });
    current.once('close', code => {
      cleanup();
      if (stopped) complete();
      else if (timedOut) reject(new Error('Local forecast refresh timed out; cached values keep their original expiry.'));
      else if (code === 0) complete();
      else reject(new Error(error.trim() || `Local inference process exited with code ${code}`));
    });
  });

  const historyArchive = async (): Promise<string> => {
    const configured = process.env.FLOODI_FORECAST_HISTORY?.trim();
    if (configured) return resolve(functionsDirectory, configured);
    // Continue the explicitly supplied local archive rather than silently
    // replacing its evaluated model when another analysis file appears.
    try {
      const state = JSON.parse(await readFile(join(evaluationDirectory, 'preview-state.json'), 'utf8'));
      if (state.version === 1 && typeof state.historyPath === 'string') {
        const savedPath = resolve(state.historyPath);
        if (dirname(savedPath) === resolve(evaluationDirectory) && archiveName.test(basename(savedPath)) && existsSync(savedPath)) return savedPath;
      }
    } catch { /* Bootstrap from an existing analysis archive below. */ }
    const archives = (await readdir(evaluationDirectory)).filter(name => archiveName.test(name)).sort();
    try {
      const inputs = JSON.parse(await readFile(join(evaluationDirectory, 'preview-inputs.json'), 'utf8'));
      const end = inputs.historical?.metadata?.end;
      const previous = typeof end === 'string' ? `regional-gauge-history-${end.slice(0, 10)}-90d.json` : '';
      if (archives.includes(previous)) return join(evaluationDirectory, previous);
    } catch { /* A missing capture is not a manufactured history. */ }
    if (!archives.length) throw new Error('Local forecast needs a collected gauge-history archive. Configure FLOODI_FORECAST_HISTORY or collect the regional history first.');
    return join(evaluationDirectory, archives.at(-1)!);
  };

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const archive = await historyArchive();
      if (!built) {
        const compiler = join(functionsDirectory, 'node_modules/typescript/bin/tsc');
        if (!existsSync(compiler)) throw new Error('Install Functions dependencies before running the local forecast.');
        await command(compiler, ['--project', join(functionsDirectory, 'tsconfig.json')]);
        built = true;
      }
      if (!stopped) await command(join(functionsDirectory, 'lib/scripts/preview_residual.js'), [archive, '--reuse-model']);
      if (!stopped) onUpdated();
      failures = 0;
    } catch (error) {
      failures++;
      if (!stopped) onWarning(error instanceof Error ? error.message : 'Local forecast refresh failed; cached values keep their original expiry.');
    } finally {
      running = false;
      if (!stopped) {
        // Brief recovery retries, with backoff during a sustained source outage.
        const delay = failures ? Math.min(5 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 4)) : refreshEveryMs;
        timer = setTimeout(() => void run(), delay);
      }
    }
  };
  timer = setTimeout(() => void run(), 0);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    terminateChild?.();
  };
}
