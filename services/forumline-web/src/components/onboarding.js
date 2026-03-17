import { $ } from '../lib/utils.js';

const onboardingSteps = [
  {
    emoji: '&#x1F30D;',
    bg: 'linear-gradient(135deg, #667eea, #764ba2)',
    title: 'Welcome to Forumline',
    text: 'A network of communities built for meaningful conversation. Join forums, voice chat, and connect with people who share your interests.',
  },
  {
    emoji: '&#x1F4AC;',
    bg: 'linear-gradient(135deg, #f093fb, #f5576c)',
    title: 'Forums for Everything',
    text: 'Browse thousands of communities or create your own. Each forum is a home for a topic you care about — from vinyl collecting to game development.',
  },
  {
    emoji: '&#x1F3A4;',
    bg: 'linear-gradient(135deg, #4facfe, #00f2fe)',
    title: 'Voice Rooms',
    text: 'Jump into voice rooms to talk with your community in real time. No scheduling, no links — just click and connect.',
  },
  {
    emoji: '&#x1F680;',
    bg: 'linear-gradient(135deg, #f6d365, #fda085)',
    title: "You're Ready!",
    text: 'Start by exploring the Discover page or jump into a forum from the sidebar. The community is waiting for you.',
    final: true,
  },
];

let onboardStep = 0;

export function renderOnboardingStep(step) {
  const stepData = onboardingSteps[step];
  $('onboardIllustration').style.background = stepData.bg;
  $('onboardIllustration').innerHTML = stepData.emoji;
  $('onboardTitle').textContent = stepData.title;
  $('onboardText').textContent = stepData.text;

  $('onboardDots').innerHTML = onboardingSteps
    .map((_, i) => `<div class="onboarding-dot ${i === step ? 'active' : ''}"></div>`)
    .join('');

  $('onboardNext').textContent = stepData.final ? 'Get Started' : 'Next';
  $('onboardSkip').style.display = stepData.final ? 'none' : 'block';
}

export function showOnboarding() {
  onboardStep = 0;
  renderOnboardingStep(0);
  $('onboardingOverlay').classList.remove('hidden');
}

export function closeOnboarding() {
  $('onboardingOverlay').classList.add('hidden');
  localStorage.setItem('forumline-onboarded', 'true');
}

export function initOnboarding() {
  $('onboardNext')?.addEventListener('click', () => {
    onboardStep++;
    if (onboardStep >= onboardingSteps.length) {
      closeOnboarding();
    } else {
      renderOnboardingStep(onboardStep);
    }
  });

  $('onboardSkip')?.addEventListener('click', closeOnboarding);

  // Keyboard navigation
  $('onboardingOverlay')?.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      $('onboardNext').click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeOnboarding();
    }
  });
}
