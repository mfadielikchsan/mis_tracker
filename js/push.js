// Push notification untuk aplikasi Capacitor (Android/iOS).
// - Di browser biasa: semua fungsi aman dan tidak melakukan apa-apa.
// - Tanpa bundler: plugin diakses lewat Capacitor.registerPlugin('PushNotifications').
//   Pastikan di project Capacitor sudah:  npm i @capacitor/push-notifications && npx cap sync
import { supabase } from './supabase.js';

const TOKEN_KEY = 'mis_push_token';
let started = false;
let plugin = null;

function capacitor() {
  const cap = window.Capacitor;
  return cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() ? cap : null;
}

function getPlugin(cap) {
  if (plugin) return plugin;
  plugin = cap.Plugins?.PushNotifications || cap.registerPlugin('PushNotifications');
  return plugin;
}

function openFromNotification(data = {}) {
  if (data.type === 'call') {
    // Popup panggilan muncul dari pemeriksaan panggilan yang belum di-OK.
    window.dispatchEvent(new Event('alerts:refresh'));
  }
}

async function saveToken(cap, token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    const { error } = await supabase.rpc('register_device_token', {
      p_token: token,
      p_platform: cap.getPlatform() === 'ios' ? 'ios' : 'android'
    });
    if (error) throw error;
  } catch (error) {
    console.warn('Gagal menyimpan token push:', error);
  }
}

export async function initPush(profile) {
  const cap = capacitor();
  if (started || !cap || !supabase || !profile) return;
  started = true;
  try {
    const push = getPlugin(cap);

    // Android 8+: channel dengan prioritas tinggi supaya panggilan berbunyi/muncul heads-up.
    // Id channel harus sama dengan yang dipakai Edge Function send-push ("calls").
    if (cap.getPlatform() === 'android') {
      try {
        await push.createChannel({ id: 'calls', name: 'Panggilan', description: 'Notifikasi panggilan dari member', importance: 5, visibility: 1, vibration: true });
      } catch (error) { console.warn('createChannel gagal:', error); }
    }

    // Listener dipasang SEBELUM register().
    await push.addListener('registration', (token) => saveToken(cap, token.value));
    await push.addListener('registrationError', (error) => console.warn('Registrasi push gagal:', error));
    // Aplikasi sedang terbuka: popup ditangani realtime (alerts.js); ini hanya memastikan tidak ada yang terlewat.
    await push.addListener('pushNotificationReceived', () => window.dispatchEvent(new Event('alerts:refresh')));
    // Notifikasi diketuk (aplikasi di background / tertutup).
    await push.addListener('pushNotificationActionPerformed', (event) => openFromNotification(event?.notification?.data));

    let permission = await push.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await push.requestPermissions();
    }
    if (permission.receive !== 'granted') return;
    await push.register();
  } catch (error) {
    console.warn('Inisialisasi push gagal:', error);
  }
}

// Dipanggil saat logout agar perangkat ini tidak menerima notifikasi akun lama.
export async function removeDeviceToken() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !supabase) return;
    await supabase.from('device_tokens').delete().eq('token', token);
    localStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    console.warn('Gagal menghapus token push:', error);
  }
}
