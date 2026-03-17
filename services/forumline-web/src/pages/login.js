import { ForumlineAuth } from '@forumline/client-sdk';
import { $ } from '../lib/utils.js';

let _showView;

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

export function getAuthIsSignup() {
  return _authIsSignup;
}
export function setAuthIsSignup(val) {
  _authIsSignup = val;
}

// Show the appropriate login sub-view and hide others
function showLoginSubView(viewId) {
  ['signinForm', 'signupForm'].forEach(id => {
    const el = $(id);
    if (el) el.classList.add('hidden');
  });
  const el = $(viewId);
  if (el) el.classList.remove('hidden');
}

// Exported for use by auth state change handler
export { showLoginSubView };

export function initLogin(deps) {
  _showView = deps.showView;

  // Sign In button — redirect to Zitadel
  const signinBtn = $('signinSubmitBtn');
  if (signinBtn) {
    signinBtn.addEventListener('click', async e => {
      e.preventDefault();
      signinBtn.disabled = true;
      signinBtn.textContent = 'Redirecting...';
      await ForumlineAuth.signIn();
    });
  }

  // Create Account button — redirect to Zitadel registration
  const signupBtn = $('signupSubmitBtn');
  if (signupBtn) {
    signupBtn.addEventListener('click', async e => {
      e.preventDefault();
      _authIsSignup = true;
      signupBtn.disabled = true;
      signupBtn.textContent = 'Redirecting...';
      await ForumlineAuth.signUp();
    });
  }
}
