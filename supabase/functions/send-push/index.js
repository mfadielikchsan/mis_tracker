// MIS Member Tracker — pengirim push notification (Supabase Edge Function / Deno JS).
// Dipicu Database Webhook (INSERT pada public.user_calls) -> kirim push "Anda dipanggil".
// Deploy:  supabase functions deploy send-push --no-verify-jwt
// Secrets: supabase secrets set PUSH_WEBHOOK_SECRET=<acak panjang> FCM_SERVICE_ACCOUNT='<isi JSON service account Firebase>'
// (SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sudah tersedia otomatis di Edge Function.)
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');
let serviceAccount = null;
try { serviceAccount = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || 'null'); } catch { /* dicek di handler */ }

const db = url && serviceKey
  ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const json = (status, value) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a || ''));
  const y = new TextEncoder().encode(String(b || ''));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ------------------- OAuth2 untuk FCM HTTP v1 (tanpa library) ------------------- */
let cachedToken = { value: null, exp: 0 };
const b64url = (input) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
async function importPrivateKey(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.exp - 60 > now) return cachedToken.value;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`
    })
  });
  if (!response.ok) throw new Error(`Autentikasi FCM gagal (${response.status})`);
  const result = await response.json();
  cachedToken = { value: result.access_token, exp: now + Number(result.expires_in || 3600) };
  return cachedToken.value;
}

/* ------------------- Isi notifikasi ------------------- */
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Seseorang';
const clip = (text, max) => (String(text).length > max ? String(text).slice(0, max - 1) + '…' : String(text));

// Mengembalikan { userIds, title, body, data, channelId } atau null bila tidak perlu push.
async function buildJob(table, record) {
  if (table === 'user_calls') {
    const caller = firstName(record.caller_name);
    return {
      userIds: [record.target_id],
      title: 'Anda dipanggil!',
      body: `Anda dipanggil oleh ${caller}${record.message ? ': ' + clip(record.message, 100) : ''}`,
      data: { type: 'call', call_id: record.id, caller_id: record.caller_id },
      channelId: 'calls'
    };
  }
  return null;
}

async function sendToToken(accessToken, token, job) {
  const message = {
    token,
    notification: { title: job.title, body: job.body },
    data: job.data, // FCM mewajibkan semua nilai berupa string
    android: {
      priority: 'HIGH',
      notification: { channel_id: job.channelId, sound: 'default' }
    },
    apns: { payload: { aps: { sound: 'default' } } }
  };
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  if (response.ok) return 'sent';
  const detail = await response.text();
  if (response.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(detail)) return 'invalid';
  console.error('FCM menolak pesan:', response.status, detail.slice(0, 300));
  return 'failed';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Gunakan POST.' });
  if (!webhookSecret || !safeEqual(req.headers.get('x-webhook-secret'), webhookSecret)) {
    return json(401, { error: 'Tidak diizinkan.' });
  }
  if (!db || !serviceAccount?.client_email || !serviceAccount?.private_key || !serviceAccount?.project_id) {
    return json(500, { error: 'Server belum dikonfigurasi (service account / service role).' });
  }

  try {
    const payload = await req.json();
    if (payload?.type !== 'INSERT' || !payload.record) return json(200, { skipped: true });

    const job = await buildJob(payload.table, payload.record);
    if (!job || !job.userIds.length) return json(200, { sent: 0 });

    const { data: tokens, error } = await db.from('device_tokens')
      .select('token').in('user_id', job.userIds);
    if (error) throw error;
    if (!tokens?.length) return json(200, { sent: 0 });

    const accessToken = await getAccessToken();
    const invalid = [];
    let sent = 0;
    for (let i = 0; i < tokens.length; i += 50) {
      const batch = tokens.slice(i, i + 50);
      const results = await Promise.all(batch.map((row) => sendToToken(accessToken, row.token, job)));
      results.forEach((result, index) => {
        if (result === 'sent') sent++;
        if (result === 'invalid') invalid.push(batch[index].token);
      });
    }
    // Bersihkan token yang sudah tidak berlaku (aplikasi di-uninstall dll).
    if (invalid.length) await db.from('device_tokens').delete().in('token', invalid);
    return json(200, { sent, removed: invalid.length });
  } catch (error) {
    console.error('send-push gagal:', error?.message);
    return json(500, { error: 'Gagal mengirim notifikasi.' });
  }
});
