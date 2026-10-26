/** Read-only as-issued forecast audit. No writes, sends, training or Gemini. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { loadVerificationDay } from '../verification/repository';
import { verificationDayStart } from '../verification/scorer';
import { safeError } from '../utils/observability';

const USAGE = 'Usage: npm run verify:forecasts -- --project EXISTING_PROJECT --day YYYY-MM-DD [--out LOCAL_JSON] (read-only; uses ADC)';

export function parseVerificationArgs(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--project', '--day', '--out'].includes(key) || values.has(key) || !value || value.startsWith('--')) throw new Error(USAGE);
    values.set(key, value);
  }
  const projectId = values.get('--project') || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  const day = values.get('--day');
  if (!projectId || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId) || !day) throw new Error(USAGE);
  verificationDayStart(day);
  return { projectId, day, outputPath: values.get('--out') || null };
}

async function main() {
  const args = parseVerificationArgs(process.argv.slice(2));
  const app = initializeApp({ projectId: args.projectId });
  const db = getFirestore(app);
  try {
    const report = await loadVerificationDay(db, args.day);
    const output = JSON.stringify({ projectId: args.projectId, readOnly: true, ...report }, null, 2) + '\n';
    if (args.outputPath) {
      const path = resolve(args.outputPath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, output, { mode: 0o600 });
      console.log(JSON.stringify({ readOnly: true, day: args.day, outputPath: path, readiness: report.readiness, coverage: report.coverage }));
    } else process.stdout.write(output);
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ event: 'forecast_verification_failed', readOnly: true, error: safeError(error) }));
  process.exitCode = 1;
});
