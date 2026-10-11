import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localForecastRefreshPlugin, startLocalForecastRefresh } from '../../../dev/localForecastRefresh';

const runtime = vi.hoisted(() => ({
  spawn: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  existsSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: runtime.spawn, default: { spawn: runtime.spawn } }));
vi.mock('node:fs/promises', () => ({ readFile: runtime.readFile, readdir: runtime.readdir, default: { readFile: runtime.readFile, readdir: runtime.readdir } }));
vi.mock('node:fs', () => ({ existsSync: runtime.existsSync, default: { existsSync: runtime.existsSync } }));

const MINUTE = 60_000;
const functionsDirectory = '/workspace/functions';
const evaluationDirectory = join(functionsDirectory, 'evaluation');
const latestArchive = join(evaluationDirectory, 'regional-gauge-history-2026-10-10-90d.json');
const olderArchive = join(evaluationDirectory, 'regional-gauge-history-2026-10-01-90d.json');
const compiler = join(functionsDirectory, 'node_modules/typescript/bin/tsc');
const inference = join(functionsDirectory, 'lib/scripts/preview_residual.js');

class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
  kill = vi.fn((signal: string) => ['SIGTERM', 'SIGKILL'].includes(signal));
  closed = false;

  close(code: number | null = 0) {
    this.closed = true;
    this.emit('close', code);
  }
}

let children: FakeChild[];
let stops: (() => void)[];

function start() {
  const onUpdated = vi.fn();
  const onWarning = vi.fn();
  const stop = startLocalForecastRefresh({ functionsDirectory, onUpdated, onWarning });
  stops.push(stop);
  return { stop, onUpdated, onWarning };
}

async function complete(child: FakeChild, code: number | null = 0) {
  child.close(code);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubEnv('FLOODI_FORECAST_HISTORY', '');
  vi.stubEnv('VITEST', '');
  children = [];
  stops = [];
  runtime.spawn.mockImplementation(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  runtime.existsSync.mockReturnValue(true);
  runtime.readFile.mockRejectedValue(new Error('Missing fixture file'));
  runtime.readdir.mockResolvedValue([
    'regional-gauge-history-2026-10-10-90d.json',
    'unrelated.json',
    'regional-gauge-history-2026-10-01-90d.json',
  ]);
});

afterEach(async () => {
  stops.forEach(stop => stop());
  children.filter(child => !child.closed).forEach(child => child.close(null));
  await vi.advanceTimersByTimeAsync(0);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('local numerical forecast scheduling', () => {
  it('updates once at boot, compiles once, and reuses the model every ten minutes', async () => {
    const { onUpdated, onWarning } = start();
    expect(runtime.spawn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.spawn).toHaveBeenNthCalledWith(1, process.execPath, [compiler, '--project', join(functionsDirectory, 'tsconfig.json')], {
      cwd: functionsDirectory,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    expect(onUpdated).not.toHaveBeenCalled();
    await complete(children[0]);
    expect(runtime.spawn).toHaveBeenNthCalledWith(2, process.execPath, [inference, latestArchive, '--reuse-model'], expect.objectContaining({ cwd: functionsDirectory }));
    await complete(children[1]);
    expect(onUpdated).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * MINUTE - 1);
    expect(runtime.spawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.spawn).toHaveBeenNthCalledWith(3, process.execPath, [inference, latestArchive, '--reuse-model'], expect.any(Object));
    await complete(children[2]);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(runtime.spawn).toHaveBeenNthCalledWith(4, process.execPath, [inference, latestArchive, '--reuse-model'], expect.any(Object));
    expect(onUpdated).toHaveBeenCalledTimes(2);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('starts the next interval after completion without overlapping running commands', async () => {
    const { onUpdated } = start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(runtime.spawn).toHaveBeenCalledTimes(1);
    await complete(children[0]);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(runtime.spawn).toHaveBeenCalledTimes(2);
    expect(onUpdated).not.toHaveBeenCalled();
    await complete(children[1]);
    await vi.advanceTimersByTimeAsync(10 * MINUTE - 1);
    expect(runtime.spawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.spawn).toHaveBeenCalledTimes(3);
  });

  it('retries a failed compiler before running inference or reporting an update', async () => {
    const { onUpdated, onWarning } = start();
    await vi.advanceTimersByTimeAsync(0);
    children[0].stderr.emit('data', 'Compiler failure');
    await complete(children[0], 1);
    expect(onWarning).toHaveBeenCalledWith('Compiler failure');
    expect(onUpdated).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.spawn.mock.calls[1][1][0]).toBe(compiler);
    await complete(children[1]);
    expect(runtime.spawn.mock.calls[2][1]).toEqual([inference, latestArchive, '--reuse-model']);
    await complete(children[2]);
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it('backs off failed inference, caps retries, and returns to ten minutes after recovery', async () => {
    const { onUpdated, onWarning } = start();
    await vi.advanceTimersByTimeAsync(0);
    await complete(children[0]);
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      const count = children.length;
      await complete(children.at(-1)!, 1);
      expect(onUpdated).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(children).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(children).toHaveLength(count + 1);
      expect(runtime.spawn.mock.calls.at(-1)![1][0]).toBe(inference);
    }
    expect(onWarning).toHaveBeenCalledTimes(6);
    await complete(children.at(-1)!);
    expect(onUpdated).toHaveBeenCalledTimes(1);
    const count = children.length;
    await vi.advanceTimersByTimeAsync(10 * MINUTE - 1);
    expect(children).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1);
    expect(children).toHaveLength(count + 1);
  });

  it('times out a hung command, escalates its termination, and retries after it closes', async () => {
    const { onUpdated, onWarning } = start();
    await vi.advanceTimersByTimeAsync(0);
    await complete(children[0]);
    const child = children[1];
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(runtime.spawn).toHaveBeenCalledTimes(2);
    await complete(child, null);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    expect(onUpdated).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.spawn.mock.calls[2][1][0]).toBe(inference);
  });

  it('cancels pending work when stopped before boot', async () => {
    const { stop, onUpdated, onWarning } = start();
    stop();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(runtime.readFile).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('terminates running inference on shutdown and schedules no retry or update', async () => {
    const { stop, onUpdated, onWarning } = start();
    await vi.advanceTimersByTimeAsync(0);
    await complete(children[0]);
    const child = children[1];
    stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    await complete(child, null);
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(runtime.spawn).toHaveBeenCalledTimes(2);
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('clears the forced-kill timer when shutdown completes promptly', async () => {
    const { stop } = start();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await complete(children[0], null);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(children[0].kill.mock.calls).toEqual([['SIGTERM']]);
    expect(runtime.spawn).toHaveBeenCalledTimes(1);
  });
});

describe('local forecast archive discovery', () => {
  it('preserves a valid saved history archive instead of selecting a newer unrelated archive', async () => {
    runtime.readFile.mockResolvedValue(JSON.stringify({ version: 1, historyPath: olderArchive }));
    start();
    await vi.advanceTimersByTimeAsync(0);
    await complete(children[0]);
    expect(runtime.spawn.mock.calls[1][1]).toEqual([inference, olderArchive, '--reuse-model']);
    expect(runtime.readdir).not.toHaveBeenCalled();
  });

  it.each([
    '/outside/regional-gauge-history-2026-10-10-90d.json',
    join(evaluationDirectory, 'nested/regional-gauge-history-2026-10-10-90d.json'),
    join(evaluationDirectory, 'service-account.json'),
  ])('rejects an automatically discovered unsafe history path: %s', async historyPath => {
    runtime.readFile.mockResolvedValue(JSON.stringify({ version: 1, historyPath }));
    start();
    await vi.advanceTimersByTimeAsync(0);
    await complete(children[0]);
    expect(runtime.spawn.mock.calls[1][1]).toEqual([inference, latestArchive, '--reuse-model']);
    expect(runtime.existsSync).not.toHaveBeenCalledWith(historyPath);
  });

  it('uses the prior issued-input history date when a valid state is missing', async () => {
    runtime.readFile.mockImplementation(async path => {
      if (String(path).endsWith('preview-inputs.json')) return JSON.stringify({ historical: { metadata: { end: '2026-10-01T12:00:00Z' } } });
      throw new Error('Missing state');
    });
    start();
    await vi.advanceTimersByTimeAsync(0);
    await complete(children[0]);
    expect(runtime.spawn.mock.calls[1][1]).toEqual([inference, olderArchive, '--reuse-model']);
  });

  it('allows an explicitly selected external archive without automatic discovery', async () => {
    vi.stubEnv('FLOODI_FORECAST_HISTORY', ' /selected/private-history.json ');
    start();
    await vi.advanceTimersByTimeAsync(0);
    await complete(children[0]);
    expect(runtime.spawn.mock.calls[1][1]).toEqual([inference, '/selected/private-history.json', '--reuse-model']);
    expect(runtime.readFile).not.toHaveBeenCalled();
    expect(runtime.readdir).not.toHaveBeenCalled();
  });

  it('warns and retries when no collected archive exists without spawning any process', async () => {
    runtime.readdir.mockResolvedValue(['unrelated.json']);
    const { onWarning, onUpdated } = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('collected gauge-history archive'));
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onWarning).toHaveBeenCalledTimes(2);
    expect(runtime.spawn).not.toHaveBeenCalled();
  });
});

describe('development-only forecast plugin', () => {
  it.each([
    ['serve', 'development', '', true],
    ['serve', 'test', '', false],
    ['serve', 'development', 'true', false],
    ['build', 'production', '', false],
    ['build', 'development', '', false],
  ] as const)('applies to %s in %s with VITEST=%s: %s', (command, mode, vitest, expected) => {
    vi.stubEnv('VITEST', vitest);
    const apply = localForecastRefreshPlugin().apply;
    if (typeof apply !== 'function') throw new Error('Expected an environment-aware plugin');
    expect(apply({}, { command, mode })).toBe(expected);
    expect(runtime.spawn).not.toHaveBeenCalled();
  });
});
