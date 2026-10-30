// MIS Member Tracker — trusted admin backend (Supabase Edge Function / Deno JS).
// Deployment: supabase functions deploy manage-user --no-verify-jwt
// The gateway JWT check is disabled, but EVERY protected request verifies
// bearer token using Supabase Auth getUser(token) and checks active admin role.
import { createClient } from 'npm:@supabase/supabase-js@2';

// Origin bawaan: dev lokal + WebView Capacitor (Android: https://localhost, iOS: capacitor://localhost).
// Origin GitHub Pages (https://USERNAME.github.io) ditambahkan lewat secret APP_ALLOWED_ORIGINS.
const DEFAULT_ORIGINS = [
  'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173',
  'http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost:3000',
  'http://localhost', 'https://localhost', 'capacitor://localhost', 'ionic://localhost'
];
const allowedOrigins = new Set([
  ...DEFAULT_ORIGINS,
  ...(Deno.env.get('APP_ALLOWED_ORIGINS') || '').split(',').map(o => o.trim()).filter(Boolean)
]);
const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const adminDb = url && serviceKey ? createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
}) : null;

function cors(origin) {
  return {
    ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    'Access-Control-Max-Age': '3600'
  };
}
function reply(status, value, origin) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), 'Cache-Control': 'no-store' }
  });
}
function fail(status, code, message, origin) {
  return reply(status, { success: false, error: { code, message } }, origin);
}
function failValidation(message) {
  const err = new Error(message);
  err.status = 422;
  err.code = 'VALIDATION_ERROR';
  throw err;
}
const validUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const emailIsValid = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function validateUserPayload(body, create) {
  const nik = String(body.nik ?? '').trim().toUpperCase();
  const full_name = String(body.full_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const site = body.site;
  const role = body.role;
  const is_active = body.is_active;
  if (!/^[A-Z0-9_-]{1,32}$/.test(nik)) failValidation('NIK wajib diisi, maksimal 32 karakter (huruf, angka, _ atau -).');
  if (full_name.length < 2 || full_name.length > 120) failValidation('Nama harus berisi 2–120 karakter.');
  if (!emailIsValid(email) || email.length > 254) failValidation('Format email tidak valid.');
  if (!['JKT', 'CKP'].includes(site)) failValidation('Site harus JKT atau CKP.');
  if (!['admin', 'user'].includes(role)) failValidation('Role harus admin atau user.');
  if (typeof is_active !== 'boolean') failValidation('Status aktif tidak valid.');
  if (create) validatePassword(body.password);
  return { nik, full_name, email, site, role, is_active };
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    failValidation('Password minimal 8 dan maksimal 72 karakter.');
  }
}
function databaseError(error) {
  const msg = String(error?.message || 'Database error');
  if (error?.code === '23505') {
    const e = new Error('NIK, email, atau nama status sudah terdaftar.');
    e.status = 409; e.code = 'DUPLICATE_DATA'; return e;
  }
  if (/LAST_ACTIVE_ADMIN_PROTECTED/.test(msg)) {
    const e = new Error('Tidak boleh menonaktifkan atau menurunkan role admin aktif terakhir.');
    e.status = 409; e.code = 'LAST_ADMIN'; return e;
  }
  const e = new Error('Gagal menyimpan data pengguna.');
  e.status = 500; e.code = 'DATABASE_ERROR'; return e;
}
async function authorizedAdmin(req) {
  const bearer = req.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(bearer);
  if (!match) {
    const e = new Error('Token login tidak ditemukan.');
    e.status = 401; e.code = 'UNAUTHORIZED'; throw e;
  }
  const { data, error } = await adminDb.auth.getUser(match[1]);
  if (error || !data?.user) {
    const e = new Error('Token login tidak valid atau telah kedaluwarsa.');
    e.status = 401; e.code = 'UNAUTHORIZED'; throw e;
  }
  const { data: profile, error: dbError } = await adminDb.from('profiles')
    .select('id, role, is_active').eq('id', data.user.id).maybeSingle();
  if (dbError) throw databaseError(dbError);
  if (!profile?.is_active || profile.role !== 'admin') {
    const e = new Error('Hanya admin aktif yang dapat melakukan operasi ini.');
    e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }
  return profile;
}
async function createUser(body) {
  const values = validateUserPayload(body, true);
  // Admin-provisioned staff accounts are confirmed by the authorized admin.
  const { data, error } = await adminDb.auth.admin.createUser({
    email: values.email,
    password: body.password,
    email_confirm: true
  });
  if (error || !data?.user) {
    const e = new Error(error?.message?.includes('already') ? 'Email sudah terdaftar di Supabase Auth.' : 'Tidak bisa membuat akun Auth.');
    e.status = error?.message?.includes('already') ? 409 : 500;
    e.code = 'AUTH_CREATE_FAILED'; throw e;
  }
  const uid = data.user.id;
  const { error: profileError } = await adminDb.from('profiles').insert({ id: uid, ...values });
  if (profileError) {
    // Compensating rollback: do not leave an orphaned login for an invalid profile.
    const { error: cleanupError } = await adminDb.auth.admin.deleteUser(uid);
    if (cleanupError) console.error('Failed to roll back new Auth user:', cleanupError.message);
    throw databaseError(profileError);
  }
  return { id: uid, ...values };
}
async function getTargetUser(id) {
  if (!validUuid(id)) failValidation('User ID tidak valid.');
  const [authResult, profileResult] = await Promise.all([
    adminDb.auth.admin.getUserById(id),
    adminDb.from('profiles').select('id,nik,full_name,email,site,role,is_active').eq('id', id).maybeSingle()
  ]);
  if (authResult.error || !authResult.data?.user || profileResult.error || !profileResult.data) {
    const e = new Error('User tidak ditemukan di Auth/profile.');
    e.status = 404; e.code = 'USER_NOT_FOUND'; throw e;
  }
  return { auth: authResult.data.user, profile: profileResult.data };
}
async function updateUser(body) {
  const { auth: oldAuth, profile: oldProfile } = await getTargetUser(body.id);
  const values = validateUserPayload(body, false);
  const emailChanged = (oldAuth.email || '').toLowerCase() !== values.email;
  if (emailChanged) {
    const { error } = await adminDb.auth.admin.updateUserById(body.id, { email: values.email, email_confirm: true });
    if (error) {
      const e = new Error('Email tidak dapat diubah pada Supabase Auth. Periksa duplikasi alamat email.');
      e.status = 409; e.code = 'AUTH_EMAIL_UPDATE_FAILED'; throw e;
    }
  }
  // DB trigger handles clearing incompatible current status on site change,
  // and protects the final active admin. All DB column changes are atomic.
  const { error: profileError } = await adminDb.from('profiles')
    .update(values).eq('id', body.id);
  if (profileError) {
    if (emailChanged) {
      const { error: rollbackError } = await adminDb.auth.admin.updateUserById(body.id, {
        email: oldAuth.email, email_confirm: true
      });
      if (rollbackError) console.error('Email rollback failed, manual reconciliation needed:', body.id);
    }
    throw databaseError(profileError);
  }
  return { id: body.id, ...values, previous_site: oldProfile.site };
}
async function changePassword(body) {
  await getTargetUser(body.id);
  validatePassword(body.password);
  const { error } = await adminDb.auth.admin.updateUserById(body.id, { password: body.password });
  if (error) {
    const e = new Error('Gagal memperbarui password.');
    e.status = 500; e.code = 'PASSWORD_UPDATE_FAILED'; throw e;
  }
  return { id: body.id };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  // Requests without Origin (e.g. backend/curl) are permitted but still need JWT.
  if (origin && !allowedOrigins.has(origin)) return fail(403, 'ORIGIN_FORBIDDEN', 'Origin tidak diizinkan.', null);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Gunakan POST.', origin);
  if (!adminDb) return fail(500, 'SERVER_NOT_CONFIGURED', 'Konfigurasi server belum lengkap.', origin);
  try {
    await authorizedAdmin(req);
    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > 32768) return fail(413, 'REQUEST_TOO_LARGE', 'Request terlalu besar.', origin);
    let body;
    try { body = await req.json(); } catch { failValidation('Body harus JSON valid.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) failValidation('Body request tidak valid.');
    let result;
    switch (body.action) {
      case 'create': result = await createUser(body); break;
      case 'update': result = await updateUser(body); break;
      case 'change-password': result = await changePassword(body); break;
      default: failValidation('Action harus create, update, atau change-password.');
    }
    return reply(200, { success: true, data: result }, origin);
  } catch (error) {
    if (!error?.status) console.error('manage-user unexpected backend failure:', error?.message);
    return fail(error?.status || 500, error?.code || 'INTERNAL_ERROR',
      error?.status ? error.message : 'Terjadi kesalahan pada server. Silakan hubungi administrator.', origin);
  }
});
