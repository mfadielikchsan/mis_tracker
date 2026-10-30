import { supabase, configReady, getActiveProfile, toast } from './supabase.js';

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const submitButton = document.getElementById('loginButton');
const submitText = document.getElementById('loginButtonText');
const submitIcon = document.getElementById('loginButtonIcon');
const passwordField = document.getElementById('password');
const togglePassword = document.getElementById('togglePassword');

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
  if (message) {
    // Restart the shake animation on repeated errors.
    errorBox.style.animation = 'none';
    void errorBox.offsetWidth;
    errorBox.style.animation = '';
  }
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitText.textContent = isLoading ? 'Memproses...' : 'Masuk';
  submitIcon.className = isLoading ? 'fa-solid fa-circle-notch spin' : 'fa-solid fa-arrow-right';
}

togglePassword.addEventListener('click', () => {
  const visible = passwordField.type === 'password';
  passwordField.type = visible ? 'text' : 'password';
  togglePassword.querySelector('i').className = visible ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  togglePassword.setAttribute('aria-label', visible ? 'Sembunyikan password' : 'Tampilkan password');
});

async function restoreSession() {
  if (!configReady) {
    showError('Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY di js/config.js.');
    submitButton.disabled = true;
    return;
  }
  setLoading(true);
  try {
    await getActiveProfile();
    window.location.replace('./status.html');
  } catch (error) {
    if (error.code === 'PROFILE_QUERY_FAILED') showError(error.message);
    // No session / profile yet: leave the login form available.
  } finally {
    setLoading(false);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const email = document.getElementById('email').value.trim();
  const password = passwordField.value;
  showError('');
  if (!email || !password) {
    showError('Email dan password wajib diisi.');
    return;
  }

  setLoading(true);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showError(error.message?.toLowerCase().includes('invalid login')
        ? 'Email atau password salah.'
        : 'Login gagal. Periksa email, password, atau status verifikasi akun.');
      return;
    }

    const { profile } = await getActiveProfile();
    toast(`Selamat datang, ${profile.full_name.split(/\s+/)[0]}!`);
    setTimeout(() => window.location.replace('./status.html'), 650);
  } catch (error) {
    if (error.code === 'PROFILE_NOT_AVAILABLE') {
      // Authentication succeeded but this account is not authorized to use the app.
      await supabase.auth.signOut();
    }
    showError(error?.message || 'Tidak dapat terhubung ke Supabase. Silakan coba lagi.');
  } finally {
    setLoading(false);
  }
});

restoreSession();
