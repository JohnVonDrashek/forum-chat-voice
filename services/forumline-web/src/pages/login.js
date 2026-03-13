import { $ } from '../lib/utils.js';
import store from '../state/store.js';
import { ForumlineAuth } from '../api/auth.js';

let _showView, _showHome, _showToast, _showOnboarding;

// Track if the current SIGNED_IN event came from a signup
let _authIsSignup = false;

export function showLogin() {
  // Hide top bar and sidebar for login
  document.querySelector('.top-bar').classList.add('hidden');
  document.querySelector('.sidebar').classList.add('hidden');
  document.querySelector('.mobile-tab-bar')?.classList.add('hidden');
  _showView('loginView');
}

export function hideLogin() {
  document.querySelector('.top-bar').classList.remove('hidden');
  document.querySelector('.sidebar').classList.remove('hidden');
  document.querySelector('.mobile-tab-bar')?.classList.remove('hidden');
}

export function getAuthIsSignup() { return _authIsSignup; }
export function setAuthIsSignup(val) { _authIsSignup = val; }

// --- Auth UI Helpers ---
function showLoginError(msg) {
  const el = $('loginError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideLoginError() {
  $('loginError').classList.add('hidden');
}

function setLoginLoading(btn, loading, originalText) {
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = originalText || 'Loading...';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || originalText;
  }
}

// Show the appropriate login sub-view and hide others
function showLoginSubView(viewId) {
  ['signinForm', 'signupForm', 'forgotForm', 'forgotSuccess', 'resetPasswordForm', 'resetPasswordSuccess'].forEach(id => {
    $(id).classList.add('hidden');
  });
  $(viewId).classList.remove('hidden');
  hideLoginError();

  // Update tabs visibility and state
  const tabContainer = document.querySelector('.login-tabs');
  if (viewId === 'signinForm' || viewId === 'signupForm') {
    tabContainer.classList.remove('hidden');
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    if (viewId === 'signinForm') {
      document.querySelector('[data-ltab="signin"]').classList.add('active');
    } else {
      document.querySelector('[data-ltab="signup"]').classList.add('active');
    }
  } else {
    tabContainer.classList.add('hidden');
  }

  // Update header text
  const headerH1 = document.querySelector('.login-header h1');
  const headerP = document.querySelector('.login-header p');
  if (viewId === 'forgotForm' || viewId === 'forgotSuccess') {
    headerH1.textContent = 'Reset Password';
    headerP.textContent = '';
  } else if (viewId === 'resetPasswordForm') {
    headerH1.textContent = 'Set New Password';
    headerP.textContent = '';
  } else if (viewId === 'resetPasswordSuccess') {
    headerH1.textContent = 'Password Updated';
    headerP.textContent = '';
  } else {
    headerH1.textContent = 'Welcome to Forumline';
    headerP.textContent = 'Join a network of communities';
  }
}

// Exported for use by auth state change handler
export { showLoginSubView };

export function initLogin(deps) {
  _showView = deps.showView;
  _showHome = deps.showHome;
  _showToast = deps.showToast;
  _showOnboarding = deps.showOnboarding;

  // Login tab switching
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.login-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      if (tab.dataset.ltab === 'signin') {
        showLoginSubView('signinForm');
      } else {
        showLoginSubView('signupForm');
      }
    });
  });

  // Forgot Password Link
  $('forgotPasswordLink').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginSubView('forgotForm');
  });

  // Back to Signin from Forgot
  $('backToSignin').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginSubView('signinForm');
  });

  // Back from Forgot Success
  $('forgotBackBtn').addEventListener('click', () => {
    showLoginSubView('signinForm');
  });

  // Try Again from Forgot Success
  $('forgotTryAgain').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginSubView('forgotForm');
  });

  // Sign In Form — real GoTrue integration
  $('signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideLoginError();
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    if (!email || !password) return;

    const btn = $('signinSubmitBtn');
    setLoginLoading(btn, true, 'Signing in...');

    const { error } = await ForumlineAuth.signIn(email, password);
    setLoginLoading(btn, false, 'Sign In');

    if (error) {
      showLoginError(error.message);
    }
    // On success, onAuthStateChange handler will hide login and show home
  });

  // Sign Up Form — real GoTrue integration
  $('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideLoginError();
    const username = $('signupUsername').value.trim();
    const email = $('signupEmail').value.trim();
    const password = $('signupPassword').value;
    if (!username || !email || !password) return;

    if (password.length < 6) {
      showLoginError('Password must be at least 6 characters');
      return;
    }

    const btn = $('signupSubmitBtn');
    setLoginLoading(btn, true, 'Creating account...');

    _authIsSignup = true;
    const { error } = await ForumlineAuth.signUp(email, password, username);
    setLoginLoading(btn, false, 'Create Account');

    if (error) {
      _authIsSignup = false;
      showLoginError(error.message);
    }
    // On success, onAuthStateChange handler will hide login, show home, and show onboarding
  });

  // Forgot Password Form
  $('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideLoginError();
    const email = $('forgotEmail').value.trim();
    if (!email) return;

    const btn = $('forgotSubmitBtn');
    setLoginLoading(btn, true, 'Sending...');

    const { error } = await ForumlineAuth.resetPasswordForEmail(email);
    setLoginLoading(btn, false, 'Send Reset Link');

    if (error) {
      showLoginError(error.message);
    } else {
      $('forgotSuccessEmail').textContent = 'We\'ve sent a password reset link to ' + email;
      showLoginSubView('forgotSuccess');
    }
  });

  // Reset Password Button
  $('resetPasswordBtn').addEventListener('click', async () => {
    hideLoginError();
    const pw = $('resetNewPassword').value;
    const confirm = $('resetConfirmPassword').value;

    if (pw.length < 6) {
      showLoginError('Password must be at least 6 characters');
      return;
    }
    if (pw !== confirm) {
      showLoginError('Passwords do not match');
      return;
    }

    const btn = $('resetPasswordBtn');
    setLoginLoading(btn, true, 'Updating...');

    const { error } = await ForumlineAuth.updateUser({ password: pw });
    setLoginLoading(btn, false, 'Update Password');

    if (error) {
      showLoginError(error.message);
    } else {
      showLoginSubView('resetPasswordSuccess');
      setTimeout(() => {
        showLoginSubView('signinForm');
        _showToast('Password updated successfully. Please sign in.');
      }, 2000);
    }
  });
}
