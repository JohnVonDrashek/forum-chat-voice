import { $ } from '../lib/utils.js';
import store from '../state/store.js';
import * as data from '../state/data.js';

export function renderActivityFeed() {
  const el = $('activityFeed');
  el.innerHTML = data.activities.map(a => `
    <div class="activity-item">
      <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${a.seed}" alt="">
      <div>
        <div class="activity-text">${a.text}</div>
        <div class="activity-time">${a.time}</div>
      </div>
    </div>
  `).join('');
}

let _showView, _renderForumList, _renderDmList;

export function showHome() {
  store.currentView = 'home';
  store.currentForum = null;
  store.currentThread = null;
  store.currentDm = null;
  _showView('homeView');
  _renderForumList();
  _renderDmList();
}

export function initHome(deps) {
  _showView = deps.showView;
  _renderForumList = deps.renderForumList;
  _renderDmList = deps.renderDmList;
}
