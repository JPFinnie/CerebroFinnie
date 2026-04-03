import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(APP_ROOT, 'public', 'data', 'vault-graph.json');
const DEFAULT_BUCKET = 'cerebro-private';
const DEFAULT_REMOTE_PATH = 'snapshots/latest/vault-graph.json';

async function main() {
  const supabaseUrl = readRequiredEnv('SUPABASE_URL');
  const supabaseSecretKey = readRequiredEnv('SUPABASE_SECRET_KEY');
  const snapshotBucket = process.env.SUPABASE_SNAPSHOT_BUCKET?.trim() || DEFAULT_BUCKET;
  const remotePath = process.env.SUPABASE_SNAPSHOT_PATH?.trim() || DEFAULT_REMOTE_PATH;

  await runNodeScript(path.join(APP_ROOT, 'scripts', 'build-vault-graph.mjs'));

  const snapshotText = await fs.readFile(SNAPSHOT_PATH, 'utf8');
  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  await ensureBucket(supabase, snapshotBucket);

  const snapshotBlob = new Blob([snapshotText], { type: 'application/json' });
  const { error: uploadError } = await supabase.storage.from(snapshotBucket).upload(remotePath, snapshotBlob, {
    cacheControl: '60',
    contentType: 'application/json',
    upsert: true,
  });

  if (uploadError) {
    throw uploadError;
  }

  console.log(`Uploaded snapshot to supabase://${snapshotBucket}/${remotePath}`);
}

async function ensureBucket(supabase, bucketName) {
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
  if (bucketsError) {
    throw bucketsError;
  }

  if (buckets?.some((bucket) => bucket.name === bucketName)) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(bucketName, { public: false });
  if (createError && createError.message !== 'The resource already exists') {
    throw createError;
  }
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: APP_ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`Script exited with code ${code ?? 'unknown'}`));
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
