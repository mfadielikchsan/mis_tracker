// Tanpa bundler: library Supabase dimuat langsung dari CDN sebagai ES module.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const url = SUPABASE_URL?.trim();
const publishableKey = SUPABASE_PUBLISHABLE_KEY?.trim();

export const configReady = Boolean(
  url && publishableKey && !url.includes('YOUR_PROJECT_REF') && !publishableKey.includes('YOUR_SUPABASE')
);

// Nilai di config.js ikut terkirim ke browser. Jangan pernah mengisinya dengan secret key.
export const supabase = configReady
  ? createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

/* ------------------------------------------------------------------ */
/* UI helpers: Font Awesome icons, SweetAlert2, Select2 (loaded by CDN) */
/* ------------------------------------------------------------------ */

// Maps the icon names stored in master_statuses.icon to Font Awesome classes.
export const ICON_CLASS = {
  monitor: 'fa-desktop',
  briefcase: 'fa-briefcase',
  wallet: 'fa-wallet',
  'shopping-cart': 'fa-cart-shopping',
  users: 'fa-users',
  calendar: 'fa-calendar-days',
  coffee: 'fa-mug-hot',
  'map-pin': 'fa-location-dot',
  factory: 'fa-industry',
  package: 'fa-box',
  'clipboard-check': 'fa-clipboard-check',
  wrench: 'fa-wrench'
};

export function makeIcon(name) {
  const icon = document.createElement('i');
  icon.className = `fa-solid ${ICON_CLASS[name] || 'fa-location-dot'}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

export function faIcon(classes, style = 'fa-solid') {
  const icon = document.createElement('i');
  icon.className = `${style} ${classes}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

const swalBase = {
  buttonsStyling: false,
  reverseButtons: true,
  customClass: {
    popup: 'dl-swal',
    confirmButton: 'btn btn-primary',
    cancelButton: 'btn btn-light'
  }
};

export function toast(message, isError = false) {
  const Swal = window.Swal;
  if (!Swal) { console[isError ? 'error' : 'log'](message); return; }
  Swal.fire({
    toast: true,
    position: 'top',
    icon: isError ? 'error' : 'success',
    title: message,
    showConfirmButton: false,
    timer: 3200,
    timerProgressBar: true,
    customClass: { popup: 'dl-toast' }
  });
}

// Resolves to true when the user confirms.
export async function confirmDialog({
  title, text = '', confirmText = 'Ya, lanjut', cancelText = 'Batal', icon = 'question', danger = false
}) {
  const Swal = window.Swal;
  if (!Swal) return window.confirm(text || title);
  const result = await Swal.fire({
    ...swalBase,
    title,
    text,
    icon,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    customClass: { ...swalBase.customClass, confirmButton: danger ? 'btn btn-danger' : 'btn btn-primary' }
  });
  return result.isConfirmed;
}

// Dialog input teks (catatan status / pesan singkat). Resolves ke string (bisa kosong)
// bila dikonfirmasi, atau null bila dibatalkan.
export async function promptText({
  title, text = '', value = '', placeholder = '', confirmText = 'Simpan',
  cancelText = 'Batal', maxLength = 200, multiline = true, required = false
}) {
  const Swal = window.Swal;
  if (!Swal) {
    const typed = window.prompt(title, value);
    if (typed === null) return null;
    if (required && !typed.trim()) return null;
    return typed.trim().slice(0, maxLength);
  }
  const result = await Swal.fire({
    ...swalBase,
    title,
    text,
    input: multiline ? 'textarea' : 'text',
    inputValue: value,
    inputPlaceholder: placeholder,
    inputAttributes: { maxlength: String(maxLength), 'aria-label': title, ...(multiline ? { rows: '3' } : {}) },
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    inputValidator: required
      ? (typed) => (String(typed || '').trim() ? undefined : 'Catatan wajib diisi.')
      : undefined,
    customClass: { ...swalBase.customClass, input: 'dl-swal-input' }
  });
  return result.isConfirmed ? String(result.value || '').trim() : null;
}

function callErrorMessage(error) {
  const msg = String(error?.message || '');
  if (msg.includes('CALL_COOLDOWN')) return 'Tunggu beberapa detik sebelum memanggil orang yang sama lagi.';
  if (msg.includes('TARGET_SITE_MISMATCH')) return 'Anda hanya bisa memanggil member di site yang sama.';
  if (msg.includes('TARGET_NOT_FOUND') || msg.includes('INVALID_TARGET')) return 'User tidak ditemukan atau sudah tidak aktif.';
  if (msg.includes('MESSAGE_TOO_LONG')) return 'Pesan terlalu panjang (maksimal 100 karakter).';
  if (msg.includes('ACCOUNT_INACTIVE_OR_MISSING')) return 'Akun tidak aktif. Silakan hubungi admin.';
  return 'Gagal mengirim panggilan. Periksa koneksi, kemudian coba lagi.';
}

// Panggil member lain. target = { id, full_name }. Mengembalikan true bila terkirim.
export async function callMember(target) {
  const first = String(target.full_name || 'member').trim().split(/\s+/)[0];
  const message = await promptText({
    title: `Panggil ${first}?`,
    text: `${first} akan menerima notifikasi "Anda dipanggil oleh ..." dari Anda.`,
    placeholder: 'Pesan singkat (opsional)',
    confirmText: 'Panggil',
    maxLength: 100,
    multiline: false
  });
  if (message === null) return false;
  const { error } = await supabase.rpc('call_user', { p_target: target.id, p_message: message || null });
  if (error) {
    console.error('Call failed:', error);
    toast(callErrorMessage(error), true);
    return false;
  }
  toast(`Panggilan terkirim ke ${first}.`);
  return true;
}

export function enhanceSelect(element, options = {}) {
  const $j = window.jQuery;
  if (!element || !$j || !$j.fn?.select2) return;
  $j(element).select2({
    width: '100%',
    minimumResultsForSearch: 8,
    dropdownCssClass: 'dl-dropdown',
    language: {
      noResults: () => 'Tidak ada hasil',
      searching: () => 'Mencari...'
    },
    ...options
  });
}

export function refreshSelect(element) {
  // Namespaced event: only refreshes Select2 UI, does not fire app "change" handlers.
  window.jQuery?.(element).trigger('change.select2');
}

export function destroySelect(element) {
  const $j = window.jQuery;
  if ($j?.fn?.select2 && $j(element).data('select2')) $j(element).select2('destroy');
}

// Select2 triggers jQuery events only, so bind with jQuery when available.
export function onSelectChange(element, handler) {
  if (window.jQuery) window.jQuery(element).on('change', handler);
  else element.addEventListener('change', handler);
}

/* ------------------------------------------------------------------ */

export async function getActiveProfile() {
  if (!supabase) {
    const err = new Error('Konfigurasi Supabase belum diisi. Lengkapi file js/config.js.');
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  // getUser checks the current user with Supabase Auth, unlike trusting only local storage.
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data?.user) {
    const err = new Error('Silakan login terlebih dahulu.');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, nik, full_name, site, role, is_active')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) {
    const err = new Error('Gagal membaca profil dari Supabase. Periksa koneksi dan RLS.');
    err.code = 'PROFILE_QUERY_FAILED';
    throw err;
  }

  if (!profile || !profile.is_active) {
    const err = new Error('Profil belum tersedia atau akun tidak aktif. Hubungi admin MIS.');
    err.code = 'PROFILE_NOT_AVAILABLE';
    throw err;
  }

  return { user: data.user, profile };
}

// Navigation is intentionally shared here: the frontend has only one JS file per page.
export function renderNavigation(profile, selected) {
  const nav = document.getElementById('bottomNav');
  if (!nav) return;
  const links = [
    { page: 'status', href: './status.html', label: 'Status', icon: 'fa-location-crosshairs' },
    { page: 'monitoring', href: './monitoring.html', label: 'Monitoring', icon: 'fa-tower-broadcast' },
    ...(profile.role === 'admin' ? [{ page: 'admin', href: './admin.html', label: 'Admin', icon: 'fa-user-shield' }] : [])
  ];
  nav.replaceChildren();
  for (const entry of links) {
    const anchor = document.createElement('a');
    anchor.href = entry.href;
    anchor.className = 'bottom-link' + (entry.page === selected ? ' selected' : '');
    anchor.dataset.page = entry.page;
    if (entry.page === selected) anchor.setAttribute('aria-current', 'page');
    const icon = faIcon(entry.icon);
    icon.classList.add('nav-icon');
    const label = document.createElement('span');
    label.textContent = entry.label;
    anchor.append(icon, label);
    nav.appendChild(anchor);
  }
  // Realtime panggilan + push (Capacitor). Dimuat dinamis agar tidak ada import melingkar.
  import('./alerts.js')
    .then((mod) => mod.startAlerts(profile, selected))
    .catch((error) => console.warn('Alerts tidak aktif:', error));
}

export async function requireProfile({ adminOnly = false } = {}) {
  try {
    const auth = await getActiveProfile();
    if (adminOnly && auth.profile.role !== 'admin') {
      window.location.replace('./status.html');
      return null;
    }
    return auth.profile;
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED' || error.code === 'PROFILE_NOT_AVAILABLE') {
      window.location.replace('./index.html');
      return null;
    }
    throw error;
  }
}

export function wireLogout({ onError } = {}) {
  const button = document.getElementById('logoutButton');
  if (!button) return;
  button.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Keluar dari aplikasi?',
      text: 'Anda perlu login kembali untuk memperbarui status.',
      confirmText: 'Ya, logout',
      cancelText: 'Batal',
      icon: 'question'
    });
    if (!confirmed) return;
    button.disabled = true;
    try {
      // Lepas token push perangkat ini sebelum sesi berakhir (best-effort).
      try { await (await import('./push.js')).removeDeviceToken(); } catch { /* abaikan */ }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.replace('./index.html');
    } catch (error) {
      button.disabled = false;
      if (onError) onError('Logout gagal. Coba kembali.');
      toast('Logout gagal. Periksa koneksi lalu coba lagi.', true);
    }
  });
}

export function formatWib(timestamp, { withDate = false } = {}) {
  if (!timestamp) return 'Belum diperbarui';
  return new Intl.DateTimeFormat('id-ID', {
    ...(withDate ? { day: '2-digit', month: 'short', year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: 'Asia/Jakarta', timeZoneName: 'short'
  }).format(new Date(timestamp));
}
