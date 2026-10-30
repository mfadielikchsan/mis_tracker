// Notifikasi panggilan (realtime): popup "Anda dipanggil oleh ..." dengan tombol OK saja.
// Dimulai otomatis dari renderNavigation().
// Saat aplikasi di background/tertutup, notifikasi dikirim lewat push (lihat push.js).
import { supabase } from './supabase.js';

let started = false;
let me = null;
let channel = null;
let callQueue = Promise.resolve();
const seenCalls = new Set();

async function ackCall(id) {
  try {
    const { error } = await supabase.rpc('ack_call', { p_id: id });
    if (error) throw error;
  } catch (error) {
    console.warn('Gagal menandai panggilan:', error);
  }
}

async function showCall(call) {
  navigator.vibrate?.([300, 150, 300, 150, 300]);
  const Swal = window.Swal;
  if (!Swal) {
    window.alert(`Anda dipanggil oleh ${call.caller_name}${call.message ? ': ' + call.message : ''}`);
    await ackCall(call.id);
    return;
  }
  const body = document.createElement('div');
  const line = document.createElement('p');
  line.className = 'call-line';
  line.append('Anda dipanggil oleh ');
  const who = document.createElement('strong');
  who.textContent = call.caller_name;
  line.append(who);
  body.append(line);
  if (call.message) {
    const quote = document.createElement('p');
    quote.className = 'call-message';
    quote.textContent = call.message;
    body.append(quote);
  }
  await Swal.fire({
    buttonsStyling: false,
    allowOutsideClick: false,
    allowEscapeKey: false,
    iconHtml: '<i class="fa-solid fa-bell"></i>',
    title: 'Anda dipanggil!',
    html: body,
    confirmButtonText: 'OK',
    customClass: {
      popup: 'dl-swal dl-call',
      icon: 'dl-call-icon',
      confirmButton: 'btn btn-primary'
    }
  });
  await ackCall(call.id);
}

function enqueueCall(call) {
  if (!call?.id || seenCalls.has(call.id)) return;
  seenCalls.add(call.id);
  callQueue = callQueue.then(() => showCall(call)).catch((error) => console.warn('Popup panggilan gagal:', error));
}

// Panggilan yang belum di-OK (mis. aplikasi baru dibuka dari notifikasi push).
async function checkPendingCalls() {
  if (!supabase || !me) return;
  try {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('user_calls')
      .select('id, caller_id, caller_name, message, created_at')
      .eq('target_id', me.id)
      .is('acknowledged_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    if (error) throw error;
    (data || []).forEach(enqueueCall);
  } catch (error) {
    console.warn('Gagal memeriksa panggilan:', error);
  }
}

function subscribe() {
  channel = supabase.channel(`alerts-${me.id}`)
    // RLS memastikan hanya panggilan untuk user ini yang diterima.
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'user_calls', filter: `target_id=eq.${me.id}` },
      (payload) => enqueueCall(payload.new))
    .subscribe();
}

function resume() {
  if (document.hidden) return;
  checkPendingCalls();
}

export function startAlerts(profile) {
  if (started || !supabase || !profile) return;
  started = true;
  me = profile;
  subscribe();
  checkPendingCalls();

  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  window.addEventListener('alerts:refresh', resume);
  window.addEventListener('pagehide', () => {
    if (channel) void supabase.removeChannel(channel);
  });

  // Push (hanya aktif di aplikasi native Capacitor; di browser tidak melakukan apa-apa).
  import('./push.js')
    .then((mod) => mod.initPush(profile))
    .catch((error) => console.warn('Push tidak aktif:', error));
}
