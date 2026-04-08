import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(APP_ROOT, 'public', 'data', 'vault-graph.json');
const DEFAULT_SUPABASE_BUCKET = 'cerebro-private';
const DEFAULT_SUPABASE_PATH = 'snapshots/latest/vault-graph.json';

async function main() {
  const runtimeConfig = getSupabaseRuntimeConfig();
  if (runtimeConfig.clientRuntime || runtimeConfig.serverRuntime) {
    console.log(
      `Supabase runtime mode detected (client=${runtimeConfig.clientRuntime}, server=${runtimeConfig.serverRuntime}); skipping build-time snapshot preparation.`,
    );
    return;
  }

  await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });

  const ingestSucceeded = await tryRunIngest();
  if (ingestSucceeded) {
    return;
  }

  if (await fileExists(SNAPSHOT_PATH)) {
    console.log(`Using existing snapshot at ${SNAPSHOT_PATH}`);
    return;
  }

  const snapshotUrl = process.env.CEREBRO_SNAPSHOT_URL?.trim();
  if (snapshotUrl) {
    console.log(`Downloading snapshot from ${snapshotUrl}`);
    const response = await fetch(snapshotUrl);
    if (!response.ok) {
      throw new Error(`Snapshot download failed with HTTP ${response.status}`);
    }

    const payload = await response.text();
    await fs.writeFile(SNAPSHOT_PATH, payload, 'utf8');
    console.log(`Saved snapshot to ${SNAPSHOT_PATH}`);
    return;
  }

  throw new Error(
    [
      'No vault data source is available for this build.',
      'For local builds, provide CEREBRO_VAULT_PATH or cerebro.config.json.',
      'For Vercel, either commit public/data/vault-graph.json or set CEREBRO_SNAPSHOT_URL.',
    ].join(' '),
  );
}

function getSupabaseRuntimeConfig() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim();
  const serverSupabaseUrl = process.env.SUPABASE_URL?.trim();
  const serverSupabaseSecret =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const snapshotBucket = process.env.SUPABASE_SNAPSHOT_BUCKET?.trim() || DEFAULT_SUPABASE_BUCKET;
  const snapshotPath = process.env.SUPABASE_SNAPSHOT_PATH?.trim() || DEFAULT_SUPABASE_PATH;

  return {
    clientRuntime: Boolean(supabaseUrl && supabasePublishableKey),
    serverRuntime: Boolean(serverSupabaseUrl && serverSupabaseSecret && snapshotBucket && snapshotPath),
  };
}

async function tryRunIngest() {
  try {
    await runNodeScript(path.join(APP_ROOT, 'scripts', 'build-vault-graph.mjs'));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Ingest step unavailable: ${message}`);
    return false;
  }
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: APP_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        if (stdout) {
          process.stdout.write(stdout);
        }

        if (stderr) {
          process.stderr.write(stderr);
        }

        resolve(undefined);
        return;
      }

      const rawMessage = stderr.trim() || stdout.trim() || `Script exited with code ${code ?? 'unknown'}`;
      const message = rawMessage.split('\n')[0];
      reject(new Error(message));
    });
  });
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
