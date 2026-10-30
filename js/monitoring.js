import {
  supabase, requireProfile, renderNavigation, wireLogout, formatWib,
  makeIcon, enhanceSelect, refreshSelect, onSelectChange, callMember
} from './supabase.js';

const $ = id => document.getElementById(id);
let profile = null;
let rows = [];
let channel = null;
let refreshInFlight = false;
let refreshQueued = false;
let debounceTimer;
let isStopped = false;

const TIMEZONE = 'Asia/Jakarta';
function dayKey(date) {
  // YYYY-MM-DD menurut zona Asia/Jakarta
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIMEZONE }).format(date);
}
let loadedDay = '';

function errorMessage(message) {
  $('pageError').textContent = message;
  $('pageError').hidden = !message;
}

function clearList(message) {
  const box = document.createElement('div');
  box.className = 'empty-box';
  box.textContent = message;
  $('memberList').replaceChildren(box);
}
function buildMemberCard(member) {
  const card = document.createElement('article');
  card.className = 'member-card';
  const top = document.createElement('div');
  top.className = 'member-top';
  const avatar = document.createElement('div');
  avatar.className = 'member-avatar';
  avatar.textContent = member.full_name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const info = document.createElement('div');
  info.className = 'member-info';
  const name = document.createElement('h3');
  name.textContent = member.full_name;
  const meta = document.createElement('p');
  meta.className = 'muted';
  meta.textContent = `NIK ${member.nik} · ${member.site}`;
  info.append(name, meta);
  top.append(avatar, info);
  if (profile && member.id !== profile.id && (profile.role === 'admin' || member.site === profile.site)) {
    const callButton = document.createElement('button');
    callButton.type = 'button';
    callButton.className = 'call-button';
    callButton.title = `Panggil ${member.full_name}`;
    callButton.setAttribute('aria-label', `Panggil ${member.full_name}`);
    callButton.append(Object.assign(document.createElement('i'), { className: 'fa-solid fa-bell-concierge' }), ' Panggil');
    callButton.addEventListener('click', async () => {
      callButton.disabled = true;
      try { await callMember(member); } finally { callButton.disabled = false; }
    });
    top.append(callButton);
  }
  let noteBox = null;
  if (member.current_status?.note) {
    noteBox = document.createElement('div');
    noteBox.className = 'member-note';
    noteBox.append(Object.assign(document.createElement('i'), { className: 'fa-solid fa-note-sticky' }));
    const noteText = document.createElement('span');
    noteText.textContent = member.current_status.note;
    noteBox.append(noteText);
  }
  const detail = document.createElement('div');
  detail.className = 'member-status-row';
  const status = document.createElement('span');
  status.className = member.current_status ? 'member-status-pill' : 'member-status-pill unset';
  status.append(
    member.current_status ? makeIcon(member.current_status.icon) : Object.assign(document.createElement('i'), { className: 'fa-regular fa-circle-question' }),
    member.current_status?.status_name || 'Not Set'
  );
  const updated = document.createElement('span');
  updated.className = 'member-updated';
  updated.textContent = formatWib(member.current_status?.updated_at);
  detail.append(status, updated);
  card.append(top);
  if (noteBox) card.append(noteBox);
  card.append(detail);
  return card;
}

function buildFilters() {
  const select = $('statusFilter');
  const selected = select.value;
  const names = [...new Set(rows.map(x => x.current_status?.status_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id'));
  select.replaceChildren(new Option('Semua status', ''));
  for (const name of names) select.add(new Option(name, name));
  if (names.includes(selected)) select.value = selected;
  refreshSelect(select);
}
function render() {
  if (!profile) return;
  const text = $('memberSearch').value.trim().toLocaleLowerCase('id');
  const site = $('siteFilter').value;
  const status = $('statusFilter').value;
  const filtered = rows.filter(m =>
    (!site || m.site === site) &&
    (!status || m.current_status?.status_name === status) &&
    (!text || `${m.full_name} ${m.nik}`.toLocaleLowerCase('id').includes(text))
  );
  if ($('sortFilter').value === 'recent') {
    filtered.sort((a, b) => (Date.parse(b.current_status?.updated_at || 0) || 0) - (Date.parse(a.current_status?.updated_at || 0) || 0)
      || a.full_name.localeCompare(b.full_name, 'id'));
  } else filtered.sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));

  const scoped = rows.filter(m => !site || m.site === site);
  $('memberCount').textContent = String(scoped.length);
  $('setCount').textContent = String(scoped.filter(x => x.current_status).length);
  $('resultCount').textContent = `${filtered.length} member`;
  const list = $('memberList');
  list.replaceChildren();
  if (!filtered.length) { clearList('Tidak ada member yang sesuai dengan filter.'); return; }
  list.append(...filtered.map(buildMemberCard));
}

async function loadMembers() {
  if (refreshInFlight) { refreshQueued = true; return; }
  refreshInFlight = true;
  $('refreshButton').disabled = true;
  $('refreshButton').querySelector('i')?.classList.add('spin');
  try {
    // Kedua query dilindungi RLS (hanya member aktif yang boleh membaca).
    const [{ data: profiles, error: profilesError }, { data: statuses, error: statusesError }] = await Promise.all([
      supabase.from('profiles').select('id, nik, full_name, site').eq('is_active', true).order('full_name'),
      supabase.from('member_current_status')
        .select('user_id, note, updated_at, master_statuses(status_name, site, is_active, icon)')
    ]);
    if (profilesError) throw profilesError;
    if (statusesError) throw statusesError;
    // Status bersifat harian: yang terakhir diubah bukan hari ini (WIB) dianggap kosong (Not Set).
    loadedDay = dayKey(new Date());
    const byId = new Map((statuses || []).filter(s => s.updated_at && dayKey(new Date(s.updated_at)) === loadedDay).map(s => [s.user_id, { ...s.master_statuses, updated_at: s.updated_at, note: s.note }]));
    rows = (profiles || []).map(m => ({ ...m, current_status: byId.get(m.id) || null }));
    buildFilters();
    errorMessage('');
    render();
  } catch (error) {
    console.error('Failed to load monitoring:', error);
    errorMessage('Tidak bisa memuat monitoring. Periksa koneksi dan permission Supabase.');
    if (!rows.length) clearList('Data monitoring belum dapat dimuat.');
  } finally {
    refreshInFlight = false;
    $('refreshButton').disabled = false;
    $('refreshButton').querySelector('i')?.classList.remove('spin');
    if (refreshQueued && !isStopped) {
      refreshQueued = false;
      void loadMembers();
    }
  }
}

function scheduleRefresh() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => { if (!isStopped) void loadMembers(); }, 240);
}
function subscribe() {
  channel = supabase.channel(`monitoring-status-${profile.id}`)
    // RLS on the table controls actual Realtime event visibility.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'member_current_status' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'master_statuses' }, scheduleRefresh)
    .subscribe(status => {
      const badge = $('realtimeBadge');
      badge.textContent = status === 'SUBSCRIBED' ? 'Connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'Reconnect...' : 'Connecting';
      badge.classList.toggle('connected', status === 'SUBSCRIBED');
      if (status === 'SUBSCRIBED') scheduleRefresh();
    });
}

$('refreshButton').addEventListener('click', () => void loadMembers());
$('memberSearch').addEventListener('input', render);
for (const id of ['statusFilter', 'siteFilter', 'sortFilter']) onSelectChange($(id), render);
window.addEventListener('focus', scheduleRefresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(); });
window.addEventListener('online', scheduleRefresh);
window.addEventListener('pagehide', () => {
  isStopped = true;
  window.clearTimeout(debounceTimer);
  if (channel) void supabase.removeChannel(channel);
});

async function init() {
  try {
    profile = await requireProfile();
    if (!profile) return;
    renderNavigation(profile, 'monitoring');
    wireLogout({ onError: errorMessage });
    $('scopeText').textContent = 'Pantau status harian member JKT dan CKP.';
    $('siteFilterGroup').hidden = false;
    for (const id of ['statusFilter', 'siteFilter', 'sortFilter']) enhanceSelect($(id));
    $('mainContent').setAttribute('aria-busy', 'false');
    await loadMembers();
    subscribe();
    // Ganti hari (WIB) saat halaman masih terbuka: muat ulang agar status kembali kosong.
    window.setInterval(() => { if (!isStopped && loadedDay && dayKey(new Date()) !== loadedDay) void loadMembers(); }, 60000);
  } catch (error) {
    console.error('Monitoring initialization:', error);
    $('mainContent').setAttribute('aria-busy', 'false');
    errorMessage(error.message || 'Gagal membuka monitoring.');
  }
}
void init();
