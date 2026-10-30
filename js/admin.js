import {
  supabase, requireProfile, renderNavigation, wireLogout, formatWib,
  toast, confirmDialog, makeIcon, faIcon, enhanceSelect, destroySelect, onSelectChange
} from './supabase.js';

const $ = id => document.getElementById(id);
const ICONS = ['map-pin', 'monitor', 'briefcase', 'factory', 'package', 'users', 'calendar', 'coffee', 'wrench', 'wallet', 'shopping-cart', 'clipboard-check'];
const STATUS_COLUMNS = 'id,status_name,site,icon,sort_order,require_note,is_active,updated_at';
let profile = null;
let users = [];
let statuses = [];
let modal = null; // {type, item} type = 'user' | 'status' | 'password'
let saving = false;

function errorBox(id, message) { $(id).textContent = message; $(id).hidden = !message; }
function create(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function pill(text, { inactive = false, dark = false, icon = '' } = {}) {
  const el = create('span', 'tag' + (inactive ? ' tag-inactive' : '') + (dark ? ' tag-dark' : ''));
  if (icon) el.append(faIcon(icon));
  el.append(text);
  return el;
}
function smallButton(text, handler, style = 'outline-button', icon = '') {
  const button = create('button', style);
  button.type = 'button';
  if (icon) button.append(faIcon(icon));
  button.append(text);
  button.addEventListener('click', handler);
  return button;
}
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
function switchTab(tab) {
  const usersSelected = tab === 'users';
  $('usersPanel').hidden = !usersSelected;
  $('statusesPanel').hidden = usersSelected;
  $('usersTab').setAttribute('aria-selected', String(usersSelected));
  $('statusesTab').setAttribute('aria-selected', String(!usersSelected));
}

async function fetchUsers() {
  const { data, error } = await supabase.rpc('admin_list_users');
  if (error) throw error;
  users = data || [];
  renderUsers();
}
async function fetchStatuses() {
  const { data, error } = await supabase.from('master_statuses').select(STATUS_COLUMNS)
    .order('site').order('sort_order').order('status_name');
  if (error) throw error;
  statuses = data || [];
  renderStatuses();
}
function renderUsers() {
  const search = $('userSearch').value.trim().toLocaleLowerCase('id');
  const site = $('userSiteFilter').value;
  const role = $('userRoleFilter').value;
  const active = $('userActiveFilter').value;
  const visible = users.filter(x => (!search || `${x.nik} ${x.full_name} ${x.email}`.toLocaleLowerCase('id').includes(search)) &&
    (!site || x.site === site) && (!role || x.role === role) && (active === '' || String(x.is_active) === active));
  $('userTotal').textContent = `${visible.length} dari ${users.length} member`;
  const list = $('usersList');
  list.replaceChildren();
  if (!visible.length) { list.append(create('div', 'empty-box', 'Tidak ada user yang sesuai dengan filter.')); return; }
  for (const item of visible) {
    const card = create('article', 'admin-card');
    const header = create('div', 'admin-card-head');
    const who = create('div', 'who');
    const info = create('div');
    info.append(create('h3', '', item.full_name), create('p', 'muted', `NIK ${item.nik} · ${item.email}`));
    who.append(create('div', 'admin-avatar' + (item.is_active ? '' : ' inactive'), initials(item.full_name)), info);
    header.append(who, pill(item.is_active ? 'Active' : 'Inactive', { inactive: !item.is_active, icon: item.is_active ? 'fa-circle-check' : 'fa-circle-pause' }));
    const labels = create('div', 'admin-labels');
    labels.append(
      pill(item.site, { icon: 'fa-location-dot' }),
      pill(item.role.toUpperCase(), { dark: item.role === 'admin', icon: item.role === 'admin' ? 'fa-user-shield' : 'fa-user' })
    );
    const actions = create('div', 'admin-actions');
    actions.append(
      smallButton('Edit', () => openModal('user', item), 'outline-button', 'fa-pen'),
      smallButton('Password', () => openModal('password', item), 'outline-button', 'fa-key')
    );
    card.append(header, labels, actions);
    list.append(card);
  }
}
function renderStatuses() {
  const search = $('statusSearch').value.trim().toLocaleLowerCase('id');
  const site = $('statusSiteFilter').value;
  const active = $('statusActiveFilter').value;
  const visible = statuses.filter(x => (!search || x.status_name.toLocaleLowerCase('id').includes(search)) &&
    (!site || x.site === site) && (active === '' || String(x.is_active) === active));
  $('statusTotal').textContent = `${visible.length} dari ${statuses.length} status`;
  const list = $('statusesList');
  list.replaceChildren();
  if (!visible.length) { list.append(create('div', 'empty-box', 'Tidak ada status yang sesuai dengan filter.')); return; }
  for (const item of visible) {
    const card = create('article', 'admin-card');
    const header = create('div', 'admin-card-head');
    const who = create('div', 'who');
    const avatar = create('div', 'admin-avatar' + (item.is_active ? '' : ' inactive'));
    avatar.append(makeIcon(item.icon));
    const info = create('div');
    info.append(create('h3', '', item.status_name), create('p', 'muted', `Icon: ${item.icon} · Urutan ${item.sort_order}`));
    who.append(avatar, info);
    header.append(who, pill(item.is_active ? 'Active' : 'Inactive', { inactive: !item.is_active, icon: item.is_active ? 'fa-circle-check' : 'fa-circle-pause' }));
    const labels = create('div', 'admin-labels');
    labels.append(
      pill(item.site, { icon: 'fa-location-dot' }),
      pill(item.require_note ? 'Wajib catatan' : 'Catatan opsional', { dark: item.require_note, inactive: !item.require_note, icon: item.require_note ? 'fa-pen' : 'fa-comment' }),
      create('span', 'result-hint', `Updated: ${formatWib(item.updated_at, { withDate: true })}`)
    );
    const actions = create('div', 'admin-actions');
    actions.append(
      smallButton('Edit', () => openModal('status', item), 'outline-button', 'fa-pen'),
      item.is_active
        ? smallButton('Nonaktifkan', () => void toggleStatus(item), 'outline-button outline-danger', 'fa-ban')
        : smallButton('Aktifkan', () => void toggleStatus(item), 'outline-button', 'fa-circle-check')
    );
    card.append(header, labels, actions);
    list.append(card);
  }
}

function field(name, labelText, options = {}) {
  const wrapper = create('div', 'form-field');
  const label = create('label', 'field-label', labelText);
  label.htmlFor = `field-${name}`;
  let input;
  let control;
  if (options.options) {
    input = create('select', 'app-select');
    for (const [value, text] of options.options) input.add(new Option(text, value));
    control = input;
  } else {
    input = create('input', 'app-input');
    input.type = options.type || 'text';
    if (options.autocomplete) input.autocomplete = options.autocomplete;
    if (options.maxLength) input.maxLength = options.maxLength;
    control = input;
    if (options.icon) {
      control = create('div', 'input-icon');
      control.append(faIcon(options.icon), input);
    }
  }
  input.id = `field-${name}`;
  input.name = name;
  input.required = options.required !== false;
  if (options.value !== undefined && options.value !== null) input.value = String(options.value);
  if (options.placeholder) input.placeholder = options.placeholder;
  wrapper.append(label, control);
  return wrapper;
}
// Checkbox bergaya kartu (untuk opsi ya/tidak).
function checkboxField(name, labelText, hint, checked) {
  const wrapper = create('div', 'form-field');
  const label = create('label', 'check-field');
  label.htmlFor = `field-${name}`;
  const input = create('input');
  input.type = 'checkbox';
  input.id = `field-${name}`;
  input.name = name;
  input.checked = !!checked;
  const text = create('span', 'check-text');
  text.append(create('strong', '', labelText), create('small', '', hint));
  label.append(input, text);
  wrapper.append(label);
  return wrapper;
}
function iconTemplate(state) {
  const $j = window.jQuery;
  if (!state.id || !$j) return state.text;
  const el = $j('<span class="s2-icon"></span>');
  el.append(makeIcon(state.id));
  el.append(document.createTextNode(state.text));
  return el;
}
function enhanceModalSelects() {
  const parent = window.jQuery ? window.jQuery('.modal-sheet') : undefined;
  for (const select of $('modalFields').querySelectorAll('select')) {
    enhanceSelect(select, {
      dropdownParent: parent,
      minimumResultsForSearch: select.name === 'icon' ? 6 : Infinity,
      ...(select.name === 'icon' ? { templateResult: iconTemplate, templateSelection: iconTemplate } : {})
    });
  }
}
function destroyModalSelects() {
  for (const select of $('modalFields').querySelectorAll('select')) destroySelect(select);
}
function appendFields(fields) {
  destroyModalSelects();
  $('modalFields').replaceChildren(...fields);
}
function closeModal() {
  if (saving) return;
  destroyModalSelects();
  $('modalOverlay').hidden = true;
  document.body.classList.remove('dialog-open');
  modal = null;
}
function openModal(type, item = null) {
  if (saving) return;
  modal = { type, item };
  const editing = !!item;
  const heading = type === 'password' ? 'Ubah Password'
    : type === 'user' ? (editing ? 'Edit User' : 'Add User') : (editing ? 'Edit Status' : 'Add Status');
  const sub = type === 'password' ? item.full_name
    : type === 'user' ? (editing ? 'Perbarui data dan hak akses member.' : 'Buat akun baru untuk anggota MIS.')
    : (editing ? 'Perbarui pilihan status untuk site.' : 'Tambah pilihan status baru untuk site.');
  const icon = type === 'password' ? 'fa-key' : type === 'user' ? (editing ? 'fa-user-pen' : 'fa-user-plus') : (editing ? 'fa-pen-to-square' : 'fa-circle-plus');
  $('modalHeading').textContent = heading;
  $('modalSub').textContent = sub;
  $('modalIcon').className = `fa-solid ${icon}`;
  errorBox('modalError', '');
  $('saveModalButton').replaceChildren(faIcon(type === 'password' ? 'fa-key' : 'fa-floppy-disk'), type === 'password' ? 'Update Password' : 'Simpan');
  if (type === 'user') {
    appendFields([
      field('nik', 'NIK *', { value: item?.nik, maxLength: 32, placeholder: 'Contoh: 05382', icon: 'fa-id-badge' }),
      field('full_name', 'Nama lengkap *', { value: item?.full_name, maxLength: 120, icon: 'fa-user' }),
      field('email', 'Email *', { type: 'email', value: item?.email, maxLength: 254, autocomplete: 'off', icon: 'fa-envelope' }),
      field('site', 'Site *', { value: item?.site || 'JKT', options: [['JKT', 'JKT'], ['CKP', 'CKP']] }),
      field('role', 'Role *', { value: item?.role || 'user', options: [['user', 'User'], ['admin', 'Admin']] }),
      field('is_active', 'Status Akun *', { value: item ? String(item.is_active) : 'true', options: [['true', 'Active'], ['false', 'Inactive']] }),
      ...(editing ? [] : [field('password', 'Password awal *', { type: 'password', autocomplete: 'new-password', placeholder: 'Minimal 8 karakter', icon: 'fa-lock' }),
        field('confirm_password', 'Konfirmasi password *', { type: 'password', autocomplete: 'new-password', icon: 'fa-lock' })])
    ]);
  } else if (type === 'password') {
    appendFields([
      field('password', 'Password baru *', { type: 'password', autocomplete: 'new-password', placeholder: 'Minimal 8 karakter', icon: 'fa-lock' }),
      field('confirm_password', 'Konfirmasi password *', { type: 'password', autocomplete: 'new-password', icon: 'fa-lock' })
    ]);
  } else {
    appendFields([
      field('status_name', 'Nama status *', { value: item?.status_name, maxLength: 100, placeholder: 'Contoh: Area Sales', icon: 'fa-tag' }),
      field('site', 'Site *', { value: item?.site || 'JKT', options: [['JKT', 'JKT'], ['CKP', 'CKP']] }),
      field('icon', 'Icon *', { value: item?.icon || 'map-pin', options: ICONS.map(name => [name, name]) }),
      field('sort_order', 'Urutan *', { type: 'number', value: item?.sort_order ?? 0, icon: 'fa-arrow-down-1-9' }),
      checkboxField('require_note', 'Wajib isi catatan', 'Jika dicentang, member harus mengisi catatan saat memilih status ini. Jika tidak, catatan boleh dikosongkan.', item?.require_note),
      field('is_active', 'Status *', { value: item ? String(item.is_active) : 'true', options: [['true', 'Active'], ['false', 'Inactive']] })
    ]);
  }
  $('modalOverlay').hidden = false;
  document.body.classList.add('dialog-open');
  enhanceModalSelects();
  $('modalFields').querySelector('input')?.focus();
}

function friendlyError(error) {
  const raw = String(error?.message || error?.error || error);
  const code = error?.code || '';
  if (code === '23505' || /duplicate key|already registered|already been registered|already exists/i.test(raw)) return 'NIK, email, atau nama status sudah digunakan.';
  if (/LAST_ACTIVE_ADMIN_PROTECTED/.test(raw)) return 'Admin aktif terakhir tidak boleh dinonaktifkan atau diturunkan rolenya.';
  if (/STATUS_SITE_IMMUTABLE_AFTER_USE/.test(raw)) return 'Site status tidak bisa diubah selama masih dipakai member. Buat status baru pada site tujuan.';
  if (/FORBIDDEN/.test(raw)) return 'Hanya admin aktif yang dapat melakukan operasi ini.';
  if (/JWT|unauthorized|401/i.test(raw)) return 'Sesi tidak valid. Silakan login ulang.';
  if (/Failed to send|Failed to fetch|NetworkError|FunctionsFetchError/i.test(raw)) return 'Tidak dapat menghubungi Supabase/Edge Function. Periksa koneksi atau deployment.';
  if (/Function not found|404/i.test(raw)) return 'Edge Function manage-user belum dideploy. Baca README.';
  return raw.length < 250 ? raw : 'Operasi gagal. Periksa input, hak akses, dan Supabase logs.';
}

async function invokeManageUser(action, payload) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session) throw new Error('Sesi login tidak ditemukan. Login ulang.');
  const { data, error } = await supabase.functions.invoke('manage-user', {
    body: { action, ...payload },
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` }
  });
  if (error) {
    // Some Supabase errors have a JSON response in FunctionsHttpError.context.
    const result = typeof error.context?.json === 'function' ? await error.context.json().catch(() => null) : null;
    throw new Error(result?.error?.message || error.message || 'Backend gagal memproses permintaan.');
  }
  if (!data?.success) throw new Error(data?.error?.message || 'Operasi gagal.');
  return data;
}

async function saveUser(values) {
  const nik = values.nik.trim().toUpperCase();
  const fullName = values.full_name.trim();
  const email = values.email.trim().toLowerCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(nik)) throw new Error('NIK hanya boleh menggunakan huruf, angka, _ atau -, maksimal 32 karakter.');
  if (fullName.length < 2) throw new Error('Nama lengkap minimal 2 karakter.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Format email tidak valid.');
  const data = { nik, full_name: fullName, email, site: values.site, role: values.role, is_active: values.is_active === 'true' };
  if (modal.item) {
    if (modal.item.site !== data.site) {
      const ok = await confirmDialog({
        title: 'Pindahkan site member?',
        text: 'Mengubah site akan mengosongkan status member saat ini.',
        confirmText: 'Ya, lanjutkan',
        icon: 'warning'
      });
      if (!ok) return false;
    }
    await invokeManageUser('update', { id: modal.item.id, ...data });
  } else {
    if (values.password.length < 8) throw new Error('Password awal minimal 8 karakter.');
    if (values.password !== values.confirm_password) throw new Error('Konfirmasi password tidak sama.');
    await invokeManageUser('create', { ...data, password: values.password });
  }
  await fetchUsers();
  return true;
}
async function savePassword(values) {
  if (values.password.length < 8) throw new Error('Password minimal 8 karakter.');
  if (values.password !== values.confirm_password) throw new Error('Konfirmasi password tidak sama.');
  await invokeManageUser('change-password', { id: modal.item.id, password: values.password });
  return true;
}
async function saveStatus(values) {
  const name = values.status_name.trim();
  const order = Number(values.sort_order);
  if (!name || name.length > 100) throw new Error('Nama status wajib diisi, maksimal 100 karakter.');
  if (!Number.isSafeInteger(order) || order < 0) throw new Error('Urutan harus angka bulat ≥ 0.');
  if (!ICONS.includes(values.icon)) throw new Error('Icon tidak valid.');
  const payload = {
    status_name: name, site: values.site, icon: values.icon, sort_order: order,
    require_note: values.require_note === 'on', is_active: values.is_active === 'true'
  };
  const query = modal.item ? supabase.from('master_statuses').update(payload).eq('id', modal.item.id) : supabase.from('master_statuses').insert(payload);
  const { error } = await query;
  if (error) throw error;
  await fetchStatuses();
  return true;
}
async function toggleStatus(item) {
  const next = !item.is_active;
  const ok = await confirmDialog({
    title: `${next ? 'Aktifkan' : 'Nonaktifkan'} status?`,
    text: `Status "${item.status_name}" (${item.site}) ${next ? 'akan muncul kembali di pilihan member.' : 'tidak akan muncul lagi di pilihan member.'}`,
    confirmText: next ? 'Ya, aktifkan' : 'Ya, nonaktifkan',
    icon: 'warning',
    danger: !next
  });
  if (!ok) return;
  try {
    const { error } = await supabase.from('master_statuses').update({ is_active: next }).eq('id', item.id);
    if (error) throw error;
    toast(`Status berhasil ${next ? 'diaktifkan' : 'dinonaktifkan'}.`);
    await fetchStatuses();
  } catch (error) { toast(friendlyError(error), true); }
}

function setSaveLabel(isSaving) {
  const button = $('saveModalButton');
  if (isSaving) { button.replaceChildren(faIcon('fa-circle-notch spin'), 'Memproses...'); return; }
  const isPassword = modal?.type === 'password';
  button.replaceChildren(faIcon(isPassword ? 'fa-key' : 'fa-floppy-disk'), isPassword ? 'Update Password' : 'Simpan');
}

$('editorForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!modal || saving) return;
  errorBox('modalError', '');
  const values = Object.fromEntries(new FormData(event.currentTarget));
  saving = true;
  $('saveModalButton').disabled = true;
  setSaveLabel(true);
  try {
    const didSave = modal.type === 'user' ? await saveUser(values)
      : modal.type === 'password' ? await savePassword(values) : await saveStatus(values);
    if (didSave) {
      toast('Data berhasil disimpan.');
      saving = false;
      closeModal();
    }
  } catch (error) {
    console.error('Admin save error:', error);
    errorBox('modalError', friendlyError(error));
  } finally {
    saving = false;
    $('saveModalButton').disabled = false;
    if (modal) setSaveLabel(false);
  }
});
$('addUserButton').addEventListener('click', () => openModal('user'));
$('addStatusButton').addEventListener('click', () => openModal('status'));
$('closeModalButton').addEventListener('click', closeModal);
$('cancelModalButton').addEventListener('click', closeModal);
$('modalOverlay').addEventListener('click', event => { if (event.target === $('modalOverlay')) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('modalOverlay').hidden && !document.querySelector('.swal2-container')) closeModal(); });
$('userSearch').addEventListener('input', renderUsers);
for (const name of ['userSiteFilter', 'userRoleFilter', 'userActiveFilter']) onSelectChange($(name), renderUsers);
$('statusSearch').addEventListener('input', renderStatuses);
for (const name of ['statusSiteFilter', 'statusActiveFilter']) onSelectChange($(name), renderStatuses);
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => switchTab(button.dataset.tab));

async function init() {
  try {
    profile = await requireProfile({ adminOnly: true });
    if (!profile) return;
    renderNavigation(profile, 'admin');
    wireLogout({ onError: message => errorBox('pageError', message) });
    for (const name of ['userSiteFilter', 'userRoleFilter', 'userActiveFilter', 'statusSiteFilter', 'statusActiveFilter']) {
      enhanceSelect($(name), { minimumResultsForSearch: Infinity });
    }
    const results = await Promise.allSettled([fetchUsers(), fetchStatuses()]);
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) {
      console.error('Failed admin queries:', failed);
      errorBox('pageError', 'Sebagian data admin gagal dimuat. Periksa koneksi, RLS dan izin role admin.');
    }
    $('mainContent').setAttribute('aria-busy', 'false');
  } catch (error) {
    console.error('Admin init error:', error);
    $('mainContent').setAttribute('aria-busy', 'false');
    errorBox('pageError', error.message || 'Tidak dapat membuka halaman admin.');
  }
}
void init();
