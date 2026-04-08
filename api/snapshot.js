import { createClient } from '@supabase/supabase-js';

const DEFAULT_ALLOWED_EMAIL = 'james_finnie@icloud.com';
const DEFAULT_BUCKET = 'cerebro-private';
const DEFAULT_PATH = 'snapshots/latest/vault-graph.json';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const snapshotBucket = process.env.SUPABASE_SNAPSHOT_BUCKET?.trim() || DEFAULT_BUCKET;
  const snapshotPath = process.env.SUPABASE_SNAPSHOT_PATH?.trim() || DEFAULT_PATH;
  const allowedEmail = (process.env.CEREBRO_ALLOWED_EMAIL?.trim() || DEFAULT_ALLOWED_EMAIL).toLowerCase();

  if (!supabaseUrl || !supabaseSecretKey) {
    response.status(500).json({ error: 'Supabase server configuration is incomplete.' });
    return;
  }

  const accessToken = extractBearerToken(request.headers.authorization);
  if (!accessToken) {
    response.status(401).json({ error: 'Missing bearer token.' });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userResult.user) {
    response.status(401).json({ error: 'Supabase session could not be verified.' });
    return;
  }

  const sessionEmail = userResult.user.email?.toLowerCase() ?? '';
  if (allowedEmail && sessionEmail !== allowedEmail) {
    response.status(403).json({ error: 'This account is not authorized to read the Cerebro snapshot.' });
    return;
  }

  const { data: snapshot, error: snapshotError } = await supabase.storage.from(snapshotBucket).download(snapshotPath);
  if (snapshotError || !snapshot) {
    response.status(404).json({ error: 'Snapshot not found in Supabase Storage.' });
    return;
  }

  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.status(200).send(await snapshot.text());
}

function extractBearerToken(headerValue) {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token.trim() || null;
}
