import { supabase, getActiveProfile, renderNavigation, wireLogout, toast, makeIcon, promptText } from './supabase.js';

const TIMEZONE = 'Asia/Jakarta';
const NOTE_MAX = 200;
const $ = (id) => document.getElementById(id);
let profile;
let activeStatuses = [];
let currentStatusId = null;
let currentStatusActive = false;
let currentRequireNote = false;
let currentNote = '';
let isUpdating = false;

function formatDate(date) {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TIMEZONE
  }).format(date);
}
function dayKey(date) {
  // Format YYYY-MM-DD menurut zona Asia/Jakarta
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIMEZONE
  }).format(date);
}
function formatTimestamp(iso) {
  return iso ? new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZone: TIMEZONE, timeZoneName: 'short'
  }).format(new Date(iso)) : 'Belum pernah diperbarui';
}
function messageForError(error) {
  const msg = String(error?.message || '');
  if (msg.includes('NOTE_REQUIRED')) return 'Status ini wajib disertai catatan.';
  if (msg.includes('STATUS_SITE_MISMATCH')) return 'Status ini tidak sesuai dengan site Anda.';
  if (msg.includes('STATUS_NOT_FOUND_OR_INACTIVE')) return 'Status sudah tidak tersedia. Muat ulang halaman.';
  if (msg.includes('ACCOUNT_INACTIVE_OR_MISSING')) return 'Akun tidak aktif. Silakan hubungi admin.';
  if (msg.includes('NOTE_TOO_LONG')) return `Catatan maksimal ${NOTE_MAX} karakter.`;
  return 'Gagal memperbarui status. Periksa koneksi, kemudian coba lagi.';
}
function showPageError(text) {
  $('pageError').textContent = text;
  $('pageError').hidden = !text;
}
function renderStatusButtons() {
  const grid = $('statusGrid');
  grid.replaceChildren();
  if (activeStatuses.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-box';
    empty.textContent = 'Belum ada pilihan status aktif untuk site ' + profile.site + '.';
    grid.appendChild(empty);
    return;
  }
  for (const status of activeStatuses) {
    const isCurrent = currentStatusId === status.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-option' + (isCurrent ? ' is-current' : '');
    button.disabled = isUpdating || isCurrent;
    button.dataset.statusId = status.id;

    const pictogram = document.createElement('span');
    pictogram.className = 'status-option-emoji';
    pictogram.appendChild(makeIcon(status.icon));

    const name = document.createElement('span');
    name.className = 'status-option-name';
    name.textContent = status.status_name;

    const marker = document.createElement('span');
    marker.className = 'status-option-mark';
    if (isCurrent) {
      marker.append(Object.assign(document.createElement('i'), { className: 'fa-solid fa-circle-check' }), ' Current');
    } else {
      marker.appendChild(Object.assign(document.createElement('i'), { className: 'fa-solid fa-arrow-up-right-from-square' }));
    }

    button.append(pictogram, name);
    if (status.require_note) {
      const req = document.createElement('span');
      req.className = 'status-option-req';
      req.append(Object.assign(document.createElement('i'), { className: 'fa-solid fa-pen' }), ' Wajib catatan');
      button.append(req);
    }
    button.append(marker);
    grid.appendChild(button);
  }
  $('editNoteButton').disabled = isUpdating;
}

async function loadCurrentStatus() {
  const { data, error } = await supabase
    .from('member_current_status')
    .select('status_id, note, updated_at, master_statuses(status_name, icon, is_active, site, require_note)')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (error) throw error;

  // Status direset per hari: jika update terakhir bukan hari ini (zona Asia/Jakarta),
  // anggap belum ada status (mulai dari 0 lagi). Note ikut hilang.
  const hasToday = !!data?.updated_at && dayKey(new Date(data.updated_at)) === dayKey(new Date());
  const current = hasToday ? data : null;

  currentStatusId = current?.status_id || null;
  currentStatusActive = !!current?.master_statuses?.is_active;
  currentRequireNote = !!current?.master_statuses?.require_note;
  currentNote = current?.note || '';
  $('currentStatusName').textContent = current?.master_statuses?.status_name || 'Not Set';
  $('currentIcon').replaceChildren(makeIcon(current?.master_statuses?.icon));
  $('currentStatusNote').textContent = !current ? 'Belum ada status hari ini. Silakan pilih status Anda.'
    : !current.master_statuses?.is_active ? 'Status ini sudah inactive. Pilih status aktif lainnya.'
    : 'Status terakhir yang Anda pilih';
  $('lastUpdated').textContent = current ? formatTimestamp(current.updated_at) : 'Belum diperbarui hari ini';

  // Note tampil di bagian atas card; tombol "Catatan" hanya untuk status aktif hari ini.
  $('currentNoteText').textContent = currentNote;
  $('currentNoteBox').hidden = !currentNote;
  $('editNoteButton').hidden = !(current && currentStatusActive);
  $('editNoteButton').lastChild.textContent = currentNote ? ' Ubah catatan' : ' Tambah catatan';
  renderStatusButtons();
}

async function loadAvailableStatuses() {
  const { data, error } = await supabase
    .from('master_statuses')
    .select('id, status_name, icon, site, is_active, sort_order, require_note')
    .eq('site', profile.site)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('status_name', { ascending: true });
  if (error) throw error;
  activeStatuses = data || [];
  renderStatusButtons();
}

async function refreshPage() {
  if (isUpdating || !profile) return;
  showPageError('');
  try {
    // Load options before current status to render a consistent selected state.
    await loadAvailableStatuses();
    await loadCurrentStatus();
  } catch (error) {
    console.error('Could not refresh member status:', error);
    showPageError('Data gagal dimuat. Periksa koneksi kemudian refresh halaman.');
    $('statusGrid').replaceChildren();
  }
}

// Simpan status (+ note). Mengembalikan true jika sukses.
async function saveStatus(statusId, note, successMessage) {
  isUpdating = true;
  renderStatusButtons();
  try {
    const { error } = await supabase.rpc('set_my_status', { p_status_id: statusId, p_note: note || null });
    if (error) throw error;
    await loadCurrentStatus();
    toast(successMessage);
    return true;
  } catch (error) {
    console.error('Status update failed:', error);
    toast(messageForError(error), true);
    try {
      await loadAvailableStatuses();
      await loadCurrentStatus();
    } catch { /* Keep old state until next refresh. */ }
    return false;
  } finally {
    isUpdating = false;
    renderStatusButtons();
  }
}

// Klik tombol status -> catatan (wajib bila status tersebut require_note) -> simpan.
$('statusGrid').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-status-id]');
  if (!button || button.disabled || isUpdating) return;
  const statusId = button.dataset.statusId;
  if (statusId === currentStatusId) return;
  const status = activeStatuses.find((item) => item.id === statusId);
  if (!status) return;

  isUpdating = true; // kunci tombol selama dialog terbuka
  renderStatusButtons();
  let note;
  try {
    note = await promptText({
      title: `Set status: ${status.status_name}`,
      text: status.require_note
        ? 'Status ini wajib disertai catatan. Catatan hilang otomatis saat Anda pindah ke status lain.'
        : 'Tambahkan catatan jika perlu. Catatan hilang otomatis saat Anda pindah ke status lain.',
      placeholder: '',
      confirmText: 'Set Status',
      maxLength: NOTE_MAX,
      required: !!status.require_note
    });
  } finally {
    isUpdating = false;
    renderStatusButtons();
  }
  if (note === null) return; // dibatalkan
  await saveStatus(statusId, note, 'Status berhasil diperbarui.');
});

// Tambah / ubah catatan pada status yang sedang aktif (tanpa ganti status).
$('editNoteButton').addEventListener('click', async () => {
  if (isUpdating || !currentStatusId || !currentStatusActive) return;
  const note = await promptText({
    title: currentNote ? 'Ubah catatan' : 'Tambah catatan',
    text: currentRequireNote ? 'Status ini wajib disertai catatan.' : 'Kosongkan lalu simpan untuk menghapus catatan.',
    value: currentNote,
    placeholder: 'Catatan status...',
    maxLength: NOTE_MAX,
    required: currentRequireNote
  });
  if (note === null) return;
  await saveStatus(currentStatusId, note, note ? 'Catatan disimpan.' : 'Catatan dihapus.');
});

async function init() {
  try {
    const auth = await getActiveProfile();
    profile = auth.profile;
    renderNavigation(profile, 'status');
    wireLogout({ onError: showPageError });
    $('helloName').textContent = 'Halo, ' + profile.full_name.split(/\s+/)[0] + '!';
    $('myNik').textContent = profile.nik;
    $('myRole').textContent = profile.role.toUpperCase();
    $('siteBadge').textContent = profile.site;
    $('currentDate').textContent = formatDate(new Date());
    $('mainContent').setAttribute('aria-busy', 'false');
    await refreshPage();
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED' || error.code === 'PROFILE_NOT_AVAILABLE') {
      window.location.replace('./index.html');
      return;
    }
    console.error('Status init failed:', error);
    showPageError(error.message || 'Gagal memuat aplikasi.');
    $('mainContent').setAttribute('aria-busy', 'false');
  }
}

window.addEventListener('focus', () => { if (profile) refreshPage(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && profile) refreshPage();
});

init();
