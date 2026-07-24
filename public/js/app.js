/* ═══════════════════════════════════════════════════════════════
   Product Rates AI — SPA Engine
   Handles: routing, state, API, page rendering, localStorage
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
const State = {
  currentPage: 'home',
  currentAnalysis: null,
  selectedIngredient: null,
  uploadedImageDataUrl: null,
  analysisSubPage: 'overview',
  history: [],
  theme: 'light',
  notificationSoundEnabled: false,
};

// ─────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────
const Router = {
  pages: ['home', 'search', 'analysis', 'history', 'settings'],

  go(page, subPage = null) {
    // hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.subpage').forEach(p => p.classList.remove('active'));

    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.page === page);
    });

    State.currentPage = page;

    if (page === 'explore') {
      // Hide all pages, show the explore subpage
      const el = document.getElementById(`subpage-explore-${subPage}`);
      if (el) {
        el.classList.add('active');
        // Reset tabs innerHTML so they rebuild fresh on every visit
        const tabsEl = document.getElementById(`${subPage}-tabs`);
        if (tabsEl) tabsEl.innerHTML = '';
        // Defer call so ExploreAPI is always defined at runtime
        setTimeout(() => {
          if (typeof ExploreAPI !== 'undefined') {
            ExploreAPI.load(subPage);
          }
        }, 0);
      }
    } else {
      const el = document.getElementById(`page-${page}`);
      if (el) el.classList.add('active');
    }

    if (page === 'analysis') {
      Router.showAnalysisTab(subPage || State.analysisSubPage);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  goAnalysis(tab) {
    Router.go('analysis', tab);
  },

  showAnalysisTab(tab) {
    State.analysisSubPage = tab;
    document.querySelectorAll('.analysis-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.analysis-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === tab);
    });
  },

  showIngredientDetail(ingredient) {
    State.selectedIngredient = ingredient;
    document.querySelectorAll('.page, .subpage').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('subpage-ingredient');
    if (el) {
      el.classList.add('active');
      Pages.renderIngredientDetail();
    }
  },

  back() {
    // If on ingredient subpage → go back to analysis/ingredients tab
    const ingPage = document.getElementById('subpage-ingredient');
    if (ingPage && ingPage.classList.contains('active')) {
      ingPage.classList.remove('active');
      Router.go('analysis', 'ingredients');
      return;
    }
    // If on explore subpage → go back to home
    const isExplore = Array.from(document.querySelectorAll('.subpage')).some(p => p.id.startsWith('subpage-explore-') && p.classList.contains('active'));
    if (isExplore) {
      Router.go('home');
      return;
    }
    Router.go('home');
  },
};

// ─────────────────────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────────────────────
const Storage = {
  KEY_HISTORY: 'prai_history',
  KEY_THEME:   'prai_theme',
  KEY_NOTIFICATION_SOUND: 'prai_notification_sound',

  getHistory() {
    try { return JSON.parse(localStorage.getItem(this.KEY_HISTORY) || '[]'); }
    catch { return []; }
  },

  saveHistory(items) {
    localStorage.setItem(this.KEY_HISTORY, JSON.stringify(items));
  },

  addScan(scan) {
    const history = this.getHistory();
    history.unshift(scan);
    if (history.length > 20) history.pop();
    this.saveHistory(history);
    State.history = history;
  },

  clearHistory() {
    localStorage.removeItem(this.KEY_HISTORY);
    State.history = [];
  },

  getTheme() { return localStorage.getItem(this.KEY_THEME) || 'light'; },
  setTheme(t) { localStorage.setItem(this.KEY_THEME, t); },

  getNotificationSoundEnabled() {
    return localStorage.getItem(this.KEY_NOTIFICATION_SOUND) === 'true';
  },

  setNotificationSoundEnabled(enabled) {
    localStorage.setItem(this.KEY_NOTIFICATION_SOUND, String(Boolean(enabled)));
  },
};

// ─────────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────────
const Theme = {
  apply(theme) {
    State.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    Storage.setTheme(theme);
    // update toggle in settings
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = theme === 'dark';
  },

  toggle() {
    Theme.apply(State.theme === 'dark' ? 'light' : 'dark');
  },

  init() {
    Theme.apply(Storage.getTheme());
  },
};


const Notifications = {
  _ctx: null,

  init() {
    State.notificationSoundEnabled = Storage.getNotificationSoundEnabled();
    this.syncBell();
  },

  syncBell() {
    const bell = document.getElementById('notification-bell');
    if (!bell) return;
    bell.classList.toggle('active', State.notificationSoundEnabled);
    bell.setAttribute('aria-pressed', String(State.notificationSoundEnabled));
    bell.setAttribute('title', State.notificationSoundEnabled ? 'Analysis sound on' : 'Analysis sound off');
  },

  async toggle() {
    State.notificationSoundEnabled = !State.notificationSoundEnabled;
    Storage.setNotificationSoundEnabled(State.notificationSoundEnabled);
    this.syncBell();

    if (State.notificationSoundEnabled) {
      await this._ensureContext();
      this.playAnalysisComplete(0.35);
      Toast.show('Analysis sound turned on');
    } else {
      Toast.show('Analysis sound turned off');
    }
  },

  async _ensureContext() {
    if (!this._ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this._ctx = new AudioCtx();
    }
    if (this._ctx.state === 'suspended') {
      try { await this._ctx.resume(); }
      catch { return null; }
    }
    return this._ctx;
  },

  async playAnalysisComplete(volume = 0.24) {
    if (!State.notificationSoundEnabled) return;
    const ctx = await this._ensureContext();
    if (!ctx) return;

    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(0.35, volume));
    master.connect(ctx.destination);

    const now = ctx.currentTime + 0.02;
    const notes = [
      { freq: 523.25, time: 0.00, dur: 0.22, gain: 0.55 },
      { freq: 659.25, time: 0.11, dur: 0.24, gain: 0.42 },
      { freq: 783.99, time: 0.23, dur: 0.42, gain: 0.3 },
    ];

    notes.forEach(note => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.freq, now + note.time);
      gain.gain.setValueAtTime(0.0001, now + note.time);
      gain.gain.exponentialRampToValueAtTime(note.gain, now + note.time + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.time + note.dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + note.time);
      osc.stop(now + note.time + note.dur + 0.05);
    });
  },
};

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────
const API = {
  async analyze(file) {
    const formData = new FormData();
    formData.append('image', file);

    const resp = await fetch('/api/analyze', {
      method: 'POST',
      body: formData,
    });

    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `Server error ${resp.status}`);
    }
    return data;
  },
};

// ─────────────────────────────────────────────────────────────
// LOADING UI
// ─────────────────────────────────────────────────────────────
const Loading = {
  steps: [
    'Reading product image…',
    'Identifying ingredients…',
    'Analyzing safety & efficacy…',
    'Generating AI verdict…',
    'Almost done…',
  ],
  _timer: null,
  _stepIdx: 0,

  show() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('active');
    this._stepIdx = 0;
    this._renderSteps();
    this._advanceStep();
  },

  hide() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('active');
    clearTimeout(this._timer);
  },

  _renderSteps() {
    const container = document.getElementById('loading-steps');
    if (!container) return;
    container.innerHTML = this.steps.map((s, i) => `
      <div class="loading-step" id="lstep-${i}">
        <div class="step-dot"></div>
        <span>${s}</span>
      </div>
    `).join('');
  },

  _advanceStep() {
    if (this._stepIdx >= this.steps.length) return;

    const prev = document.getElementById(`lstep-${this._stepIdx - 1}`);
    if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }

    const cur = document.getElementById(`lstep-${this._stepIdx}`);
    if (cur) cur.classList.add('active');

    this._stepIdx++;
    this._timer = setTimeout(() => this._advanceStep(), 1600);
  },
};

// ─────────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────────
const Toast = {
  _timer: null,
  show(msg, duration = 3500) {
    const t = document.getElementById('error-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => t.classList.remove('show'), duration);
  },
};

// ─────────────────────────────────────────────────────────────
// ERROR MODAL
// ─────────────────────────────────────────────────────────────
const ErrorModal = {
  show(rawMessage) {
    const { icon, title, body, hint } = ErrorModal._parse(rawMessage);
    document.getElementById('err-icon').textContent  = icon;
    document.getElementById('err-title').textContent = title;
    document.getElementById('err-body').textContent  = body;
    document.getElementById('err-hint').innerHTML    = hint;
    document.getElementById('error-modal').classList.add('active');
  },

  hide() {
    document.getElementById('error-modal').classList.remove('active');
  },

  _parse(msg) {
    const s = (msg || '').toLowerCase();

    // Quota / rate limit
    if (s.includes('429') || s.includes('resource_exhausted') ||
        s.includes('quota') || s.includes('rate') || s.includes('limit')) {
      return {
        icon:  '📊',
        title: 'API Quota Reached',
        body:  'You\'ve used up your free Gemini API quota for today (20 requests/day on the free tier).',
        hint:  'What you can do:<br>'
             + '&bull; <strong>Wait until tomorrow</strong> — quota resets daily<br>'
             + '&bull; <strong>Upgrade your plan</strong> at '
             + '<a href="https://ai.dev/rate-limit" target="_blank" style="color:var(--clr-primary)">ai.dev/rate-limit</a><br>'
             + '&bull; <strong>Use a different API key</strong> in your <code>.env</code> file'
      };
    }

    // No API key
    if (s.includes('api_key') || s.includes('api key') || s.includes('invalid_argument') || s.includes('unauthenticated')) {
      return {
        icon:  '🔑',
        title: 'Invalid API Key',
        body:  'Your Gemini API key is missing or incorrect.',
        hint:  'Check your <code>.env</code> file and make sure <code>GEMINI_API_KEY=your_key</code> is set correctly.<br><br>'
             + 'Get a free key at <a href="https://aistudio.google.com" target="_blank" style="color:var(--clr-primary)">aistudio.google.com</a>'
      };
    }

    // Model not found
    if (s.includes('model') && (s.includes('not found') || s.includes('404'))) {
      return {
        icon:  '🤖',
        title: 'Model Unavailable',
        body:  'The Gemini model specified in analyzer.py was not found.',
        hint:  'In <code>analyzer.py</code>, change the model name to <code>gemini-2.0-flash</code> or <code>gemini-1.5-flash</code> and restart the server.'
      };
    }

    // Image / file error
    if (s.includes('image') || s.includes('file') || s.includes('upload')) {
      return {
        icon:  '🖼️',
        title: 'Image Error',
        body:  'There was a problem reading the uploaded image.',
        hint:  'Make sure you\'re uploading a clear JPG, PNG, or WebP photo of the product\'s ingredient list.'
      };
    }

    // Generic fallback
    return {
      icon:  '⚠️',
      title: 'Analysis Failed',
      body:  'Something went wrong while analyzing the product.',
      hint:  '<details><summary style="cursor:pointer;color:var(--clr-text-tertiary);font-size:12px">Show technical details</summary>'
           + `<pre style="font-size:11px;margin-top:8px;white-space:pre-wrap;word-break:break-all;color:var(--clr-text-secondary)">${(msg || '').slice(0, 400)}</pre></details>`
    };
  },
};

// ─────────────────────────────────────────────────────────────
// UPLOAD MODAL
// ─────────────────────────────────────────────────────────────
const UploadModal = {
  open() {
    document.getElementById('upload-modal').classList.add('active');
  },
  close() {
    document.getElementById('upload-modal').classList.remove('active');
  },

  handleFile(file) {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      Toast.show('Please upload a JPG, PNG, or WebP image.');
      return;
    }

    // Store data URL for display
    const reader = new FileReader();
    reader.onload = e => { State.uploadedImageDataUrl = e.target.result; };
    reader.readAsDataURL(file);

    this.close();
    this._startAnalysis(file);
  },

  async _startAnalysis(file) {
    Loading.show();
    try {
      const data = await API.analyze(file);
      State.currentAnalysis = data;

      // Save to history
      Storage.addScan({
        id: Date.now(),
        product_name: data.product_name || 'Unknown Product',
        brand: data.brand || '',
        overall_rating: data.overall_rating,
        imageDataUrl: State.uploadedImageDataUrl,
        date: new Date().toISOString(),
        fullData: data
      });

      Loading.hide();
      Notifications.playAnalysisComplete();
      Pages.renderHome();   // refresh recent scans on home page
      Pages.renderAll();
      Router.go('analysis', 'overview');

    } catch (err) {
      Loading.hide();
      ErrorModal.show(err.message || 'Analysis failed. Try again.');
    }
  },
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const H = {
  score(rating) {
    // rating is 0-10, display as /100
    return Math.round((rating || 0) * 10);
  },

  scoreLabel(score) {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Average';
    return 'Poor';
  },

  scoreClass(score) {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'average';
    return 'poor';
  },

  scoreColor(score) {
    if (score >= 80) return '#22C55E';
    if (score >= 60) return '#84CC16';
    if (score >= 40) return '#F59E0B';
    return '#EF4444';
  },

  scoreBadgeClass(score) {
    if (score >= 80) return 'badge-green';
    if (score >= 60) return 'badge-blue';
    if (score >= 40) return 'badge-amber';
    return 'badge-red';
  },

  skinTypeScore(value) {
    const map = {
      'excellent': 95, 'great': 88, 'good': 78, 'suitable': 78,
      'moderate': 60, 'okay': 55, 'use with caution': 45,
      'caution': 40, 'not recommended': 20, 'avoid': 15,
      'yes': 85, 'no': 20,
    };
    if (typeof value === 'number') return Math.min(100, Math.max(0, value));
    const v = (value || '').toLowerCase().trim();
    for (const [k, s] of Object.entries(map)) {
      if (v.includes(k)) return s;
    }
    return 70; // default
  },

  skinTypeLabel(score) {
    if (score >= 85) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Average';
    return 'Poor';
  },

  skinTypeFillClass(score) {
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'average';
    return 'poor';
  },

  ingredientClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'good') return 'good';
    if (s.includes('caution')) return 'caution';
    if (s === 'avoid' || s === 'bad') return 'avoid';
    return 'good';
  },

  ingredientEmoji(status) {
    const s = (status || '').toLowerCase();
    if (s === 'good') return '✅';
    if (s.includes('caution')) return '⚠️';
    if (s === 'avoid' || s === 'bad') return '❌';
    return '✅';
  },

  recClass(rec) {
    const r = (rec || '').toLowerCase();
    if (r === 'yes') return 'yes';
    if (r === 'no') return 'no';
    return 'maybe';
  },

  recIcon(rec) {
    const r = (rec || '').toLowerCase();
    if (r === 'yes') return '👍';
    if (r === 'no') return '👎';
    return '🤔';
  },

  safetyLevel(value) {
    if (!value) return { level: 'caution', icon: '⚠️' };
    const v = value.toLowerCase();
    if (v.includes('safe') || v.includes('yes') || v.includes('suitable') || v.includes('okay'))
      return { level: 'safe', icon: '✅' };
    if (v.includes('no') || v.includes('avoid') || v.includes('unsafe'))
      return { level: 'unsafe', icon: '❌' };
    return { level: 'caution', icon: '⚠️' };
  },

  timeAgo(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 172800) return 'Yesterday';
    return d.toLocaleDateString();
  },

  escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  stars(rating) {
    // rating 0-10 → 0-5 stars
    const stars = Math.round((rating / 10) * 5 * 2) / 2;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      if (stars >= i) html += '★';
      else if (stars >= i - 0.5) html += '⭑';
      else html += '☆';
    }
    return html;
  },

  circlePathLen: r => 2 * Math.PI * r,

  makeSVGRing(score, color, size = 160, stroke = 10) {
    const r = (size / 2) - (stroke / 2);
    const len = H.circlePathLen(r);
    const offset = len - (score / 100) * len;
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle class="score-ring-bg" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"/>
        <circle class="score-ring-fill" cx="${size/2}" cy="${size/2}" r="${r}"
          stroke="${color}" stroke-width="${stroke}"
          stroke-dasharray="${len}" stroke-dashoffset="${len}"
          data-target-offset="${offset}" />
      </svg>`;
  },

  animateRings() {
    document.querySelectorAll('.score-ring-fill, .confidence-ring-fill').forEach(el => {
      const target = parseFloat(el.dataset.targetOffset);
      if (!isNaN(target)) {
        requestAnimationFrame(() => { el.style.strokeDashoffset = target; });
      }
    });

    document.querySelectorAll('.progress-fill').forEach(el => {
      const target = el.dataset.targetWidth;
      if (target) {
        requestAnimationFrame(() => { el.style.width = target; });
      }
    });
  },
};

// ─────────────────────────────────────────────────────────────
// PAGE RENDERERS
// ─────────────────────────────────────────────────────────────
const Pages = {

  renderAll() {
    const d = State.currentAnalysis;
    if (!d) return;
    this.renderOverview();
    this.renderIngredients();
    this.renderCompatibility();
    this.renderVerdict();
    this.renderSafety();
  },

  // ── HOME ──────────────────────────────────────────────────
  renderHome() {
    const history = Storage.getHistory();
    const container = document.getElementById('recent-scans-list');
    if (!container) return;

    if (history.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:var(--sp-6) var(--sp-5);color:var(--clr-text-tertiary);">
          <div style="font-size:36px;margin-bottom:8px">📷</div>
          <div style="font-size:var(--fs-sm)">No scans yet. Scan your first product!</div>
        </div>`;
      return;
    }

    container.innerHTML = history.slice(0, 3).map(item => {
      const score = H.score(item.overall_rating);
      const color = H.scoreColor(score);
      const label = H.scoreLabel(score);
      const thumb = item.imageDataUrl
        ? `<img src="${item.imageDataUrl}" alt="${H.escHtml(item.product_name)}" style="width:100%;height:100%;object-fit:cover;">`
        : `<span style="font-size:22px">🧴</span>`;

      return `
        <div class="recent-item" onclick="History.openScan(${item.id})">
          <div class="recent-thumb">${thumb}</div>
          <div class="recent-info">
            <div class="recent-name">${H.escHtml(item.product_name)}</div>
            <div class="recent-meta">${H.escHtml(item.brand || '')} • ${H.timeAgo(item.date)}</div>
          </div>
          <div class="score-pill">
            <div class="score-num" style="color:${color}">${score}</div>
            <div class="score-lbl" style="color:${color}">${label}</div>
          </div>
        </div>`;
    }).join('');
  },

  // ── OVERVIEW ─────────────────────────────────────────────
  renderOverview() {
    const d = State.currentAnalysis;
    if (!d) return;

    const score = H.score(d.overall_rating);
    const color = H.scoreColor(score);
    const label = H.scoreLabel(score);
    const recClass = H.recClass(d.buy_recommendation);
    const recIcon = H.recIcon(d.buy_recommendation);

    const imgHtml = State.uploadedImageDataUrl
      ? `<img src="${State.uploadedImageDataUrl}" alt="${H.escHtml(d.product_name)}">`
      : `<span style="font-size:48px">🧴</span>`;

    const heroIngredients = (d.hero_ingredients || []).slice(0, 4)
      .map(hi => `<span class="chip">${H.escHtml(hi.name)}</span>`).join('');

    document.getElementById('overview-content').innerHTML = `
      <div class="overview-hero">
        <div class="overview-product-image">${imgHtml}</div>
        <div class="overview-name">${H.escHtml(d.product_name || 'Unknown Product')}</div>
        <div class="overview-brand">${H.escHtml(d.brand || '')} ${d.category ? `· ${H.escHtml(d.category)}` : ''}</div>
        <div class="overview-tags">
          ${(d.best_for || []).slice(0, 3).map(t => `<span class="chip">${H.escHtml(t)}</span>`).join('')}
        </div>
      </div>

      <div class="score-ring-container">
        ${H.makeSVGRing(score, color)}
        <div class="score-ring-wrap" style="position:relative;width:160px;height:160px;margin-top:-164px;">
          <div class="score-ring-text">
            <div class="score-ring-num" style="color:${color}">${score}</div>
            <div class="score-ring-denom">/100</div>
          </div>
        </div>
        <div class="score-ring-label">${label} Product</div>
      </div>

      <div class="buy-rec-card ${recClass}">
        <div class="buy-rec-icon">${recIcon}</div>
        <div class="buy-rec-content">
          <div class="buy-rec-title">${d.buy_recommendation === 'Yes' ? 'Recommended' : d.buy_recommendation === 'No' ? 'Not Recommended' : 'Use with Caution'}</div>
          <div class="buy-rec-text">${H.escHtml(d.quick_summary || '')}</div>
        </div>
      </div>

      ${heroIngredients ? `
      <div class="px-5 mb-4">
        <div class="section-title mb-3" style="font-size:var(--fs-sm);color:var(--clr-text-tertiary);text-transform:uppercase;letter-spacing:.8px">Hero Ingredients</div>
        <div class="flex flex-wrap gap-2">${heroIngredients}</div>
      </div>` : ''}

      <div class="px-5">
        <button class="btn btn-primary btn-full btn-lg" onclick="Router.goAnalysis('ingredients')">
          View Full Analysis →
        </button>
      </div>
    `;

    setTimeout(() => H.animateRings(), 100);
  },

  // ── INGREDIENTS ──────────────────────────────────────────
  renderIngredients(filter = 'all', search = '') {
    const d = State.currentAnalysis;
    if (!d) return;

    const all = d.ingredients || [];
    const filtered = all.filter(i => {
      const cls = H.ingredientClass(i.good_or_bad);
      const matchFilter = filter === 'all' || cls === filter;
      const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase());
      return matchFilter && matchSearch;
    });

    const goodCount    = all.filter(i => H.ingredientClass(i.good_or_bad) === 'good').length;
    const cautionCount = all.filter(i => H.ingredientClass(i.good_or_bad) === 'caution').length;
    const avoidCount   = all.filter(i => H.ingredientClass(i.good_or_bad) === 'avoid').length;

    const filterTabs = [
      { key: 'all',     label: 'All', count: all.length },
      { key: 'good',    label: '✅ Good', count: goodCount },
      { key: 'caution', label: '⚠️ Caution', count: cautionCount },
      { key: 'avoid',   label: '❌ Avoid', count: avoidCount },
    ].map(t => `
      <span class="chip ${filter === t.key ? 'active' : ''}"
            onclick="Pages.renderIngredients('${t.key}', document.getElementById('ingredient-search').value)">
        ${t.label} <strong>${t.count}</strong>
      </span>`).join('');

    const cards = filtered.map(i => {
      const cls = H.ingredientClass(i.good_or_bad);
      const emoji = H.ingredientEmoji(i.good_or_bad);
      const safe = JSON.stringify(i).replace(/"/g, '&quot;');
      return `
        <div class="ingredient-card ${cls}" onclick="Router.showIngredientDetail(${safe})">
          <div class="ingredient-card-icon">${emoji}</div>
          <div class="ingredient-card-body">
            <div class="ingredient-card-name">${H.escHtml(i.name)}</div>
            <div class="ingredient-card-purpose">${H.escHtml(i.purpose || i.simple_explanation || '')}</div>
          </div>
          <div class="ingredient-card-arrow">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>`;
    }).join('');

    document.getElementById('ingredients-content').innerHTML = `
      <div class="search-bar">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="ingredient-search" type="text" placeholder="Search ingredients…" value="${H.escHtml(search)}"
               oninput="Pages.renderIngredients('${filter}', this.value)">
      </div>
      <div class="filter-bar">${filterTabs}</div>
      <div class="ingredient-list">${cards || '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No results</div><div class="empty-sub">Try a different filter or search term</div></div>'}</div>
    `;
  },

  // ── INGREDIENT DETAIL ─────────────────────────────────────
  renderIngredientDetail() {
    const i = State.selectedIngredient;
    if (!i) return;

    const cls = H.ingredientClass(i.good_or_bad);
    const emoji = H.ingredientEmoji(i.good_or_bad);

    const bgMap = { good: '#D1FAE5', caution: '#FEF3C7', avoid: '#FEE2E2' };
    const bg = bgMap[cls] || '#F3F4F6';

    // Find in ingredients_to_watch
    const d = State.currentAnalysis;
    const watchEntry = (d?.ingredients_to_watch || []).find(w =>
      w.name.toLowerCase() === i.name.toLowerCase()
    );

    const badgeMap = { good: 'badge-green', caution: 'badge-amber', avoid: 'badge-red' };
    const labelMap = { good: 'Safe', caution: 'Use with Caution', avoid: 'Avoid' };

    const avoidChips = (watchEntry?.who_should_avoid || [])
      .map(a => `<span class="chip">${H.escHtml(a)}</span>`).join('');

    document.getElementById('ingredient-detail-content').innerHTML = `
      <div class="ingredient-detail-hero">
        <div class="ingredient-detail-icon" style="background:${bg}">${emoji}</div>
        <div class="ingredient-detail-name">${H.escHtml(i.name)}</div>
        <span class="badge ${badgeMap[cls]}" style="margin-top:8px">${labelMap[cls]}</span>
      </div>

      ${i.purpose ? `
      <div class="detail-section">
        <div class="detail-section-title">Purpose</div>
        <div class="detail-section-content">${H.escHtml(i.purpose)}</div>
      </div>` : ''}

      <div class="detail-section">
        <div class="detail-section-title">About</div>
        <div class="detail-section-content">${H.escHtml(i.simple_explanation || 'No description available.')}</div>
      </div>

      ${watchEntry?.why ? `
      <div class="detail-section">
        <div class="detail-section-title">Why to Watch</div>
        <div class="detail-section-content">${H.escHtml(watchEntry.why)}</div>
      </div>` : ''}

      ${avoidChips ? `
      <div class="detail-section">
        <div class="detail-section-title">Who Should Avoid</div>
        <div class="avoid-chips">${avoidChips}</div>
      </div>` : ''}
    `;
  },

  // ── SKIN COMPATIBILITY ────────────────────────────────────
  renderCompatibility() {
    const d = State.currentAnalysis;
    if (!d) return;

    const skinTypes = [
      { key: 'oily',        label: 'Oily Skin',        emoji: '💧' },
      { key: 'dry',         label: 'Dry Skin',          emoji: '🌵' },
      { key: 'combination', label: 'Combination Skin',  emoji: '🌗' },
      { key: 'normal',      label: 'Normal Skin',       emoji: '✨' },
      { key: 'sensitive',   label: 'Sensitive Skin',    emoji: '🌸' },
      { key: 'acne_prone',  label: 'Acne Prone Skin',   emoji: '🔬' },
    ];

    const items = skinTypes.map(st => {
      const raw = d.skin_types?.[st.key] || '';
      const score = H.skinTypeScore(raw);
      const label = H.skinTypeLabel(score);
      const fillClass = H.skinTypeFillClass(score);

      return `
        <div class="compat-item card" style="padding:var(--sp-4)">
          <div class="compat-icon" style="background:var(--clr-surface-2)">${st.emoji}</div>
          <div class="compat-body">
            <div class="compat-top">
              <div>
                <div class="compat-name">${st.label}</div>
                <div class="compat-label" style="color:${H.scoreColor(score)}">${label}</div>
              </div>
              <div class="compat-score" style="color:${H.scoreColor(score)}">${score}%</div>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${fillClass}" data-target-width="${score}%" style="width:0%"></div>
            </div>
            ${raw ? `<div style="font-size:var(--fs-xs);color:var(--clr-text-tertiary);margin-top:4px">${H.escHtml(raw)}</div>` : ''}
          </div>
        </div>`;
    });

    document.getElementById('compatibility-content').innerHTML = `
      <div class="compatibility-list">${items.join('')}</div>
    `;

    setTimeout(() => H.animateRings(), 100);
  },

  // ── VERDICT ───────────────────────────────────────────────
  renderVerdict() {
    const d = State.currentAnalysis;
    if (!d) return;

    const confidence = d.confidence || 0;
    const r = 26;
    const len = H.circlePathLen(r);
    const offset = len - (confidence / 100) * len;
    const color = H.scoreColor(confidence);

    const pros = (d.pros || []).map(p =>
      `<div class="pros-cons-item pro">${H.escHtml(p)}</div>`).join('');
    const cons = (d.cons || []).map(c =>
      `<div class="pros-cons-item con">${H.escHtml(c)}</div>`).join('');

    const score = H.score(d.overall_rating);
    const label = H.scoreLabel(score);

    const metrics = [
      { label: 'Safety', color: '#22C55E' },
      { label: 'Effectiveness', color: '#60A5FA' },
      { label: 'Suitability', color: '#A78BFA' },
    ].map(m => `
      <div class="conf-metric">
        <div class="conf-metric-dot" style="background:${m.color}"></div>
        <div class="conf-metric-label">${m.label}</div>
        <div class="conf-metric-val">${confidence >= 70 ? 'High' : confidence >= 40 ? 'Medium' : 'Low'}</div>
      </div>`).join('');

    document.getElementById('verdict-content').innerHTML = `
      <div class="verdict-hero">
        <div class="verdict-bot-icon">🤖</div>
        <div class="verdict-tag">AI Verdict</div>
        <div class="verdict-heading">${label} Choice!</div>
        <div class="stars" style="justify-content:center;margin-bottom:16px">${H.stars(d.overall_rating)}</div>
        <div class="verdict-text">${H.escHtml(d.final_verdict || d.quick_summary || '')}</div>
      </div>

      <div class="confidence-section">
        <div class="confidence-ring">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--clr-surface-2)" stroke-width="7"/>
            <circle class="confidence-ring-fill" cx="36" cy="36" r="${r}"
              fill="none" stroke="${color}" stroke-width="7"
              stroke-linecap="round"
              stroke-dasharray="${len}" stroke-dashoffset="${len}"
              data-target-offset="${offset}"
              style="transform:rotate(-90deg);transform-origin:center"/>
          </svg>
          <div class="confidence-ring-text">${confidence}%</div>
        </div>
        <div class="confidence-labels">
          <div class="confidence-title">Confidence Score</div>
          <div class="confidence-sub">AI certainty on this analysis</div>
          <div class="confidence-metrics">${metrics}</div>
        </div>
      </div>

      <div class="pros-cons">
        ${pros ? `<div class="pros-card">
          <div class="pros-cons-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            Pros
          </div>
          <div class="pros-cons-list">${pros}</div>
        </div>` : ''}

        ${cons ? `<div class="cons-card">
          <div class="pros-cons-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Cons
          </div>
          <div class="pros-cons-list">${cons}</div>
        </div>` : ''}
      </div>
    `;

    setTimeout(() => H.animateRings(), 100);
  },

  // ── SAFETY ────────────────────────────────────────────────
  renderSafety() {
    const d = State.currentAnalysis;
    if (!d) return;

    const safetyItems = [
      { label: 'Pregnancy Safe',  value: d.pregnancy,          icon: '🤰' },
      { label: 'Safe for Children', value: d.safe_for_children, icon: '👶' },
      { label: 'Daily Use',       value: d.daily_use,          icon: '📅' },
    ].map(item => {
      const sl = H.safetyLevel(item.value);
      const badgeClass = { safe: 'badge-green', caution: 'badge-amber', unsafe: 'badge-red' }[sl.level];
      return `
        <div class="safety-item">
          <div class="safety-icon ${sl.level}">${item.icon}</div>
          <div class="safety-info">
            <div class="safety-label">${item.label}</div>
            <div class="safety-value">${H.escHtml(item.value || 'No data')}</div>
          </div>
          <div class="safety-badge">
            <span class="badge ${badgeClass}">${sl.level === 'safe' ? 'Safe' : sl.level === 'unsafe' ? 'Avoid' : 'Consult'}</span>
          </div>
        </div>`;
    });

    // Possible allergens
    const allergens = d.possible_allergens || [];
    const allergenHtml = allergens.length
      ? `<div class="safety-item">
          <div class="safety-icon caution">⚠️</div>
          <div class="safety-info">
            <div class="safety-label">Possible Allergens</div>
            <div class="safety-value">${allergens.map(a => H.escHtml(a)).join(' · ')}</div>
          </div>
        </div>`
      : `<div class="safety-item">
          <div class="safety-icon safe">✅</div>
          <div class="safety-info">
            <div class="safety-label">Possible Allergens</div>
            <div class="safety-value">None detected</div>
          </div>
          <div class="safety-badge"><span class="badge badge-green">Clean</span></div>
        </div>`;

    // Contains grid
    const contains = d.contains || {};
    const containsItems = [
      { key: 'fragrance',     label: 'Fragrance' },
      { key: 'parabens',      label: 'Parabens' },
      { key: 'sulfates',      label: 'Sulfates' },
      { key: 'silicones',     label: 'Silicones' },
      { key: 'drying_alcohol',label: 'Drying Alcohol' },
      { key: 'mineral_oil',   label: 'Mineral Oil' },
    ].map(c => `
      <div class="contains-item">
        <div class="contains-dot ${contains[c.key] ? 'yes' : 'no'}"></div>
        <div>
          <div class="contains-name">${c.label}</div>
          <div class="contains-val">${contains[c.key] ? 'Contains' : 'Free'}</div>
        </div>
      </div>`).join('');

    document.getElementById('safety-content').innerHTML = `
      <div class="safety-list">
        ${safetyItems.join('')}
        ${allergenHtml}
      </div>

      <div class="section-header">
        <div class="section-title">Ingredient Flags</div>
      </div>
      <div class="contains-grid">${containsItems}</div>
    `;
  },

  // ── HISTORY ───────────────────────────────────────────────
  renderHistory(filter = 'all') {
    const history = Storage.getHistory();
    const container = document.getElementById('history-list');
    if (!container) return;

    const filtered = history.filter(item => {
      const score = H.score(item.overall_rating);
      if (filter === 'all') return true;
      if (filter === 'good')    return score >= 70;
      if (filter === 'average') return score >= 40 && score < 70;
      if (filter === 'poor')    return score < 40;
      return true;
    });

    const filterBar = ['all', 'good', 'average', 'poor'].map(f => `
      <span class="chip ${filter === f ? 'active' : ''}"
            onclick="Pages.renderHistory('${f}')">
        ${f.charAt(0).toUpperCase() + f.slice(1)}
      </span>`).join('');

    document.getElementById('history-filter-bar').innerHTML = filterBar;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🧴</div>
          <div class="empty-title">No scans yet</div>
          <div class="empty-sub">Scan a product to see your history here</div>
          <button class="btn btn-primary mt-4" onclick="UploadModal.open()">Scan Product</button>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(item => {
      const score = H.score(item.overall_rating);
      const color = H.scoreColor(score);
      const label = H.scoreLabel(score);
      const thumb = item.imageDataUrl
        ? `<img src="${item.imageDataUrl}" alt="${H.escHtml(item.product_name)}" style="width:100%;height:100%;object-fit:cover;">`
        : `<span>🧴</span>`;

      return `
        <div class="history-card" onclick="History.openScan(${item.id})">
          <div class="history-thumb">${thumb}</div>
          <div class="history-info">
            <div class="history-name">${H.escHtml(item.product_name)}</div>
            <div class="history-meta">${H.escHtml(item.brand || '')} · ${H.timeAgo(item.date)}</div>
          </div>
          <div class="history-score">
            <div class="history-score-num" style="color:${color}">${score}</div>
            <span class="badge ${H.scoreBadgeClass(score)}">${label}</span>
          </div>
        </div>`;
    }).join('');
  },

  // ── SETTINGS ─────────────────────────────────────────────
  renderSettings() {
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = State.theme === 'dark';
  },

  // ── SEARCH ───────────────────────────────────────────────
  renderSearch() {
    // Search is mostly handled by the upload flow
    // Could add product name search in a future version
  },
};

// ─────────────────────────────────────────────────────────────
// HISTORY MANAGER
// ─────────────────────────────────────────────────────────────
const History = {
  openScan(id) {
    const items = Storage.getHistory();
    const item = items.find(i => i.id === id);
    if (!item) return;

    if (!item.fullData) {
      Toast.show('Sorry, this old scan does not have full details saved.');
      return;
    }

    State.currentAnalysis = item.fullData;
    State.uploadedImageDataUrl = item.imageDataUrl;
    Pages.renderAll();
    Router.go('analysis', 'overview');
  },

  clear() {
    if (confirm('Are you sure you want to clear all scan history? This cannot be undone.')) {
      Storage.clearHistory();
      Pages.renderHistory();
      Pages.renderHome();
      Toast.show('History cleared ✓');
    }
  },
};

// ─────────────────────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────────────────────
function initEvents() {
  // Bottom nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (page === 'home')     Pages.renderHome();
      if (page === 'history')  Pages.renderHistory();
      if (page === 'settings') Pages.renderSettings();
      Router.go(page);
    });
  });

  // Analysis sub-tabs
  document.querySelectorAll('.analysis-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      Router.showAnalysisTab(tab.dataset.tab);
    });
  });

  // Upload modal close on backdrop click
  document.getElementById('upload-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('upload-modal')) UploadModal.close();
  });

  // Drag & drop
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) UploadModal.handleFile(file);
  });

  dropZone.addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input').addEventListener('change', e => {
    if (e.target.files[0]) UploadModal.handleFile(e.target.files[0]);
    e.target.value = ''; // reset so same file can trigger 'change' again
  });

  document.getElementById('camera-btn').addEventListener('click', () => {
    const input = document.getElementById('camera-input');
    input.click();
  });

  document.getElementById('camera-input').addEventListener('change', e => {
    if (e.target.files[0]) UploadModal.handleFile(e.target.files[0]);
    e.target.value = ''; // reset
  });

  // Dark mode toggle
  const dmToggle = document.getElementById('dark-mode-toggle');
  if (dmToggle) {
    dmToggle.addEventListener('change', () => Theme.apply(dmToggle.checked ? 'dark' : 'light'));
  }

  // Settings reset history
  document.getElementById('reset-history-btn').addEventListener('click', History.clear);

  // Keyboard support for back
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') Router.back();
  });
}

// ─────────────────────────────────────────────────────────────
// SEARCH PAGE
// ─────────────────────────────────────────────────────────────
const SearchPage = {
  async submit(e) {
    e.preventDefault();
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    const resultsEl = document.getElementById('search-results');
    const ctaEl = document.getElementById('search-upload-cta');
    
    ctaEl.style.display = 'none';
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:16px;background:var(--clr-surface-2);border-radius:16px;margin-bottom:12px">
        <div style="width:24px;height:24px;border:3px solid var(--clr-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>
        <div style="font-size:14px;color:var(--clr-text-secondary)">Searching for "<strong>${query}</strong>"…</div>
      </div>
    `;

    try {
      const res = await fetch('/api/search-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();

      if (data.error) {
        resultsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">😔</div><div class="empty-title">No results found</div><div class="empty-sub">${data.error}</div></div>`;
        return;
      }

      const products = data.products || [];
      if (products.length === 0) {
        resultsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No products found</div><div class="empty-sub">Try a different search term or scan a product image instead.</div></div>`;
        return;
      }

      resultsEl.innerHTML = `
        <div style="font-size:12px;color:var(--clr-text-tertiary);margin-bottom:12px">${products.length} results for "${query}"</div>
        ${products.map((p, i) => `
          <div class="card" style="margin-bottom:10px;display:flex;align-items:center;gap:12px;padding:14px">
            <div style="width:48px;height:48px;border-radius:10px;background:var(--clr-surface-2);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">
              ${p.image ? `<img src="${p.image}" style="width:48px;height:48px;object-fit:cover;border-radius:10px" onerror="this.parentElement.textContent='🧴'">` : '🧴'}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700;color:var(--clr-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name || query}</div>
              ${p.brand ? `<div style="font-size:12px;color:var(--clr-text-secondary)">${p.brand}</div>` : ''}
            </div>
            <button class="btn btn-primary" style="padding:8px 14px;font-size:12px;flex-shrink:0" onclick="SearchPage.analyzeByName(decodeURIComponent('${encodeURIComponent(p.name || query)}'), decodeURIComponent('${encodeURIComponent(p.brand || '')}'), decodeURIComponent('${encodeURIComponent(p.image || '')}'))">
              Analyze
            </button>
          </div>
        `).join('')}
        <div class="card" style="text-align:center;padding:16px;margin-top:8px">
          <div style="font-size:13px;color:var(--clr-text-secondary);margin-bottom:10px">Don't see your product? Scan it directly</div>
          <button class="btn btn-ghost" onclick="UploadModal.open()">📸 Scan Image</button>
        </div>
      `;

    } catch (err) {
      resultsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Search failed</div><div class="empty-sub">${err.message}</div></div>`;
    }
  },

  async analyzeByName(productName, brand = '', imageUrl = '') {
    Loading.show();
    try {
      const res = await fetch('/api/analyze-by-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: productName, brand })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      State.currentAnalysis = data;
      State.uploadedImageDataUrl = imageUrl || null;

      Storage.addScan({
        id: Date.now(),
        product_name: data.product_name || productName || 'Unknown Product',
        brand: data.brand || brand || '',
        overall_rating: data.overall_rating,
        imageDataUrl: imageUrl || null,
        date: new Date().toISOString(),
        fullData: data
      });

      Loading.hide();
      Notifications.playAnalysisComplete();
      Pages.renderHome();
      Pages.renderAll();
      Router.go('analysis', 'overview');
    } catch (err) {
      Loading.hide();
      ErrorModal.show(err.message || 'Analysis failed. Try again.');
    }
  }
};

// ─────────────────────────────────────────────────────────────
// EXPLORE API
// ─────────────────────────────────────────────────────────────
const ExploreAPI = {
  cache: {},
  async fetchJSON(path) {
    if (this.cache[path]) return this.cache[path];
    try {
      const res = await fetch(`/api/data/${path}`);
      if (!res.ok) throw new Error('Network error');
      const data = await res.json();
      this.cache[path] = data;
      return data;
    } catch (e) {
      console.error('Failed to load', path, e);
      return null;
    }
  },

  async fetchList(folder) {
    try {
      const res = await fetch(`/api/list/${folder}`);
      if (!res.ok) throw new Error('Not found');
      return await res.json();
    } catch (e) {
      console.error('Failed to list', folder, e);
      return [];
    }
  },

  async load(category) {
    const container = document.getElementById(`explore-${category}-content`);
    if (!container) return;
    
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--clr-text-tertiary)">Loading...</div>';
    
    if (category === 'budget') {
      const data = await this.fetchJSON('budget/budget.json');
      this.renderProductPage(data, 'budget');

    } else if (category === 'premium') {
      const data = await this.fetchJSON('premium/premium.json');
      this.renderProductPage(data, 'premium');

    } else if (category === 'natural') {
      const files = await this.fetchList('natural');
      const tabsEl = document.getElementById('natural-tabs');
      if (tabsEl && tabsEl.innerHTML === '') {
        tabsEl.innerHTML = `
          <button class="et-tab active" onclick="ExploreAPI.filterNatural('all', this)">All</button>
          <button class="et-tab" onclick="ExploreAPI.filterNatural('skin', this)">Skin</button>
          <button class="et-tab" onclick="ExploreAPI.filterNatural('hair', this)">Hair</button>
        `;
      }
      this._naturalFiles = files;
      this.renderNaturalList(files, container);

    } else if (category === 'guides') {
      // Combine skin + hair + concerns + routines as guide categories
      const skinFiles = await this.fetchList('skin');
      const hairFiles = await this.fetchList('hair');
      const concernFiles = await this.fetchList('concerns');
      const routineFiles = await this.fetchList('routines');
      
      container.innerHTML = '';
      
      const sections = [
        { label: '🧬 Skin Types', files: skinFiles, folder: 'skin' },
        { label: '⚠️ Skin Concerns', files: concernFiles, folder: 'concerns' },
        { label: '📅 Routines', files: routineFiles, folder: 'routines' },
        { label: '💇 Hair Care', files: hairFiles, folder: 'hair' },
      ];

      sections.forEach(({ label, files, folder }) => {
        if (!files || files.length === 0) return;
        const sec = document.createElement('div');
        sec.style.marginBottom = '8px';
        sec.innerHTML = `<div style="font-size:13px;font-weight:700;color:var(--clr-text-tertiary);padding:12px 0 6px;text-transform:uppercase;letter-spacing:0.5px">${label}</div>`;
        files.forEach(f => {
          const name = this.prettyName(f);
          const item = document.createElement('div');
          item.className = 'cat-item';
          item.innerHTML = `<div class="cat-icon" style="background:var(--clr-surface-2)">&#128214;</div><div class="cat-info"><div class="cat-title">${name}</div><div class="cat-sub">Tap to read guide</div></div><div class="cat-arrow">&rsaquo;</div>`;
          item.style.cursor = 'pointer';
          item.onclick = () => this.openKnowledgeDetail('guides', folder, f);
          sec.appendChild(item);
        });
        container.appendChild(sec);
      });

    } else if (category === 'routine') {
      const files = await this.fetchList('routines');
      this._routineFiles = files;
      this.filterRoutine('morning', null);
      // Set up tab click handlers
      document.querySelectorAll('#routine-tabs .et-tab').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('#routine-tabs .et-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          ExploreAPI.filterRoutine(btn.dataset.filter, btn);
        };
      });
    }
  },

  filterNatural(type, btn) {
    if (btn) {
      document.querySelectorAll('#natural-tabs .et-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    const container = document.getElementById('explore-natural-content');
    if (!this._naturalFiles) return;
    let files = this._naturalFiles;
    // For now show all — can be filtered by metadata once loaded
    this.renderNaturalList(files, container);
  },

  filterRoutine(type, btn) {
    const container = document.getElementById('explore-routine-content');
    if (!container || !this._routineFiles) return;
    const filtered = this._routineFiles.filter(f => f.toLowerCase().includes(type));
    container.innerHTML = '';
    if (filtered.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--clr-text-tertiary)">No routines found.</div>';
      return;
    }
    filtered.forEach(f => {
      const name = this.prettyName(f);
      const item = document.createElement('div');
      item.className = 'cat-item';
      item.innerHTML = `<div class="cat-icon" style="background:var(--clr-surface-2)">&#128203;</div><div class="cat-info"><div class="cat-title">${name}</div><div class="cat-sub">Open routine details</div></div><div class="cat-arrow">&rsaquo;</div>`;
      item.style.cursor = 'pointer';
      item.onclick = () => this.openKnowledgeDetail('routine', 'routines', f);
      container.appendChild(item);
    });
  },

  renderNaturalList(files, container) {
    if (!files || files.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--clr-text-tertiary)">No data found.</div>';
      return;
    }
    container.innerHTML = '';
    files.forEach(f => {
      const emoji = this.getNaturalEmoji(f);
      const name = this.prettyName(f);
      const item = document.createElement('div');
      item.className = 'cat-item';
      item.innerHTML = `<div class="cat-icon">${emoji}</div><div class="cat-info"><div class="cat-title">${name}</div><div class="cat-sub">Tap to read benefits and usage</div></div><div class="cat-arrow">&rsaquo;</div>`;
      item.style.cursor = 'pointer';
      item.onclick = () => this.openKnowledgeDetail('natural', 'natural', f);
      container.appendChild(item);
    });
  },

  prettyName(value) {
    return String(value || '')
      .replace('.json', '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  },

  getNaturalEmoji(fileName) {
    const emojiMap = {
      aloe: '&#127793;', honey: '&#127855;', green: '&#127861;', coconut: '&#129381;', tea_tree: '&#127807;', oatmeal: '&#127806;',
      turmeric: '&#128993;', rose: '&#127801;', neem: '&#127807;', cucumber: '&#129362;', chamomile: '&#127804;', argan: '&#129689;',
      shea: '&#129532;', jojoba: '&#128167;', rice: '&#127806;', hibiscus: '&#127802;', amla: '&#129744;', centella: '&#127807;',
      licorice: '&#127852;', fenugreek: '&#127807;'
    };
    const key = Object.keys(emojiMap).find(k => fileName.includes(k)) || '';
    return emojiMap[key] || '&#127807;';
  },

  async openKnowledgeDetail(pageCategory, folder, fileName) {
    const container = document.getElementById(`explore-${pageCategory}-content`);
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--clr-text-tertiary)">Loading...</div>';
    const data = await this.fetchJSON(`${folder}/${fileName}`);

    if (!data) {
      container.innerHTML = `
        <div class="card" style="padding:20px;text-align:center">
          <div style="font-size:14px;font-weight:700;color:var(--clr-text-primary);margin-bottom:6px">Unable to open this guide</div>
          <div style="font-size:13px;color:var(--clr-text-secondary);margin-bottom:14px">The JSON file could not be loaded.</div>
          <button class="btn btn-ghost" onclick="ExploreAPI.load('${pageCategory}')">Back to list</button>
        </div>`;
      return;
    }

    this.renderKnowledgeDetail(pageCategory, fileName, data);
  },

  renderKnowledgeDetail(pageCategory, fileName, data) {
    const container = document.getElementById(`explore-${pageCategory}-content`);
    if (!container) return;

    const title = data.name || data.routine_name || this.prettyName(fileName);
    const subtitle = [data.category, data.scientific_name, data.routine_type, data.frequency]
      .filter(Boolean)
      .map(v => H.escHtml(String(v)))
      .join(' &middot; ');
    const description = data.description ? `
      <div class="card" style="padding:16px;margin-bottom:14px">
        <div style="font-size:14px;line-height:1.6;color:var(--clr-text-secondary)">${H.escHtml(data.description)}</div>
      </div>` : '';
    const numericRating = Number(data.rating);
    const rating = Number.isFinite(numericRating) ? `
      <div class="card" style="padding:14px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;font-weight:700;color:var(--clr-text-primary)">Overall Rating</div>
        <div style="font-size:14px;color:var(--clr-primary)">${'&#9733;'.repeat(Math.max(0, Math.min(5, numericRating)))}<span style="color:var(--clr-text-tertiary)">${'&#9734;'.repeat(Math.max(0, 5 - numericRating))}</span></div>
      </div>` : '';

    const hiddenKeys = new Set(['name', 'routine_name', 'description', 'category', 'scientific_name', 'routine_type', 'frequency', 'rating']);
    const sections = Object.entries(data)
      .filter(([key, value]) => !hiddenKeys.has(key) && value && (!Array.isArray(value) || value.length > 0))
      .map(([key, value]) => this.renderKnowledgeSection(key, value))
      .join('');

    container.innerHTML = `
      <button class="btn btn-ghost" style="margin-bottom:12px" onclick="ExploreAPI.load('${pageCategory}')">&larr; Back to list</button>
      <div class="card" style="padding:18px;margin-bottom:14px;background:linear-gradient(135deg,var(--clr-surface-1),var(--clr-surface-2))">
        <div style="font-size:22px;font-weight:800;color:var(--clr-text-primary);line-height:1.2">${H.escHtml(title)}</div>
        ${subtitle ? `<div style="font-size:13px;color:var(--clr-text-tertiary);margin-top:6px">${subtitle}</div>` : ''}
      </div>
      ${description}
      ${rating}
      ${sections || '<div class="card" style="padding:16px;color:var(--clr-text-secondary)">No detailed data available.</div>'}
    `;
  },

  renderKnowledgeSection(key, value) {
    const label = this.prettyName(key);

    if (Array.isArray(value)) {
      if (value.length === 0) return '';

      if (value.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
        const cards = value.map((item, index) => {
          const primary = item.action || item.step_name || item.name || item.day || item.step || `Item ${index + 1}`;
          const details = Object.entries(item)
            .filter(([subKey]) => !['action', 'step_name', 'name', 'day', 'step'].includes(subKey))
            .map(([subKey, subValue]) => `
              <div style="font-size:13px;color:var(--clr-text-secondary);margin-top:6px">
                <strong style="color:var(--clr-text-primary)">${H.escHtml(this.prettyName(subKey))}:</strong> ${this.renderKnowledgeInline(subValue)}
              </div>`)
            .join('');

          return `
            <div class="card" style="padding:14px 16px;margin-bottom:10px">
              <div style="font-size:14px;font-weight:700;color:var(--clr-text-primary)">${H.escHtml(String(primary))}</div>
              ${details}
            </div>`;
        }).join('');

        return `<div style="margin-bottom:16px"><div class="section-title mb-3">${H.escHtml(label)}</div>${cards}</div>`;
      }

      const items = value.map(item => `<li style="margin-bottom:8px">${this.renderKnowledgeInline(item)}</li>`).join('');
      return `
        <div class="card" style="padding:16px;margin-bottom:14px">
          <div class="section-title mb-3">${H.escHtml(label)}</div>
          <ul style="margin:0;padding-left:18px;color:var(--clr-text-secondary);font-size:14px;line-height:1.6">${items}</ul>
        </div>`;
    }

    if (value && typeof value === 'object') {
      const rows = Object.entries(value).map(([subKey, subValue], index) => `
        <div style="padding:10px 0;${index > 0 ? 'border-top:1px solid var(--clr-border);' : ''}">
          <div style="font-size:12px;font-weight:700;color:var(--clr-text-tertiary);text-transform:uppercase;letter-spacing:0.4px">${H.escHtml(this.prettyName(subKey))}</div>
          <div style="font-size:14px;color:var(--clr-text-secondary);line-height:1.6;margin-top:4px">${this.renderKnowledgeInline(subValue)}</div>
        </div>`).join('');
      return `
        <div class="card" style="padding:16px;margin-bottom:14px">
          <div class="section-title mb-1">${H.escHtml(label)}</div>
          ${rows}
        </div>`;
    }

    return `
      <div class="card" style="padding:16px;margin-bottom:14px">
        <div class="section-title mb-2">${H.escHtml(label)}</div>
        <div style="font-size:14px;color:var(--clr-text-secondary);line-height:1.6">${this.renderKnowledgeInline(value)}</div>
      </div>`;
  },

  renderKnowledgeInline(value) {
    if (Array.isArray(value)) {
      return value.map(item => H.escHtml(String(item))).join(', ');
    }

    if (value && typeof value === 'object') {
      return Object.entries(value)
        .map(([key, item]) => `${H.escHtml(this.prettyName(key))}: ${H.escHtml(String(item))}`)
        .join(' &middot; ');
    }

    return H.escHtml(String(value));
  },

  renderProductPage(data, category) {
    const container = document.getElementById(`explore-${category}-content`);
    const tabsContainer = document.getElementById(`${category}-tabs`);
    
    if (!data) {
      container.innerHTML = '<div style="text-align:center;padding:20px;">Data not available</div>';
      return;
    }

    let displayData = data;
    
    if (Array.isArray(data)) {
        const grouped = {};
        data.forEach(p => {
           let pr = p.price_range || 'other';
           if (pr === 'under_300') pr = 'Under ₹300';
           else if (pr === 'under_500') pr = 'Under ₹500';
           else if (pr === 'under_1000') pr = 'Under ₹1000';
           else if (pr === 'under_2000') pr = 'Under ₹2000';
           
           if (!grouped[pr]) grouped[pr] = [];
           grouped[pr].push(p);
        });
        displayData = grouped;
        
        if (tabsContainer && tabsContainer.innerHTML === '') {
            const cats = ['All', ...new Set(data.map(p => p.category))].filter(Boolean).slice(0, 6);
            tabsContainer.innerHTML = cats.map((c, i) => 
               `<button class="et-tab ${i===0?'active':''}" onclick="ExploreAPI.filterByCategory('${category}', '${c.replace(/'/g, "\\'")}')">${c}</button>`
            ).join('');
        }
    } else if (typeof data === 'object') {
        const categories = Object.keys(data);
        if (categories.length === 0) return;
        
        if (tabsContainer && tabsContainer.innerHTML === '') {
          tabsContainer.innerHTML = categories.map((k, i) => 
            `<button class="et-tab ${i===0?'active':''}" onclick="ExploreAPI.switchTab('${category}', '${k.replace(/'/g, "\\'")}')">${k}</button>`
          ).join('');
        }
        
        displayData = data[categories[0]];
    }
    
    this.renderProductsGrid(displayData, container);
  },

  filterByCategory(pageCategory, filterCat) {
      const data = this.cache[`${pageCategory}/${pageCategory}.json`];
      if (!data || !Array.isArray(data)) return;
      
      const filtered = filterCat === 'All' ? data : data.filter(p => p.category === filterCat);
      
      const grouped = {};
      filtered.forEach(p => {
         let pr = p.price_range || 'other';
         if (pr === 'under_300') pr = 'Under ₹300';
         else if (pr === 'under_500') pr = 'Under ₹500';
         else if (pr === 'under_1000') pr = 'Under ₹1000';
         else if (pr === 'under_2000') pr = 'Under ₹2000';
         
         if (!grouped[pr]) grouped[pr] = [];
         grouped[pr].push(p);
      });
      
      const container = document.getElementById(`explore-${pageCategory}-content`);
      this.renderProductsGrid(grouped, container);
      
      const tabsContainer = document.getElementById(`${pageCategory}-tabs`);
      if (tabsContainer) {
          Array.from(tabsContainer.children).forEach(btn => {
              btn.classList.toggle('active', btn.textContent === filterCat);
          });
      }
  },
  
  switchTab(category, tabKey) {
    const tabsContainer = document.getElementById(`${category}-tabs`);
    if (tabsContainer) {
      Array.from(tabsContainer.children).forEach(btn => {
        btn.classList.toggle('active', btn.textContent === tabKey);
      });
    }
    
    const data = this.cache[`${category}/${category}.json`];
    if (data && data[tabKey]) {
      const container = document.getElementById(`explore-${category}-content`);
      this.renderProductsGrid(data[tabKey], container);
    }
  },
  
  renderProductsGrid(products, container) {
    if (!Array.isArray(products)) {
        // If it's an object with subcategories
        let html = '';
        for (const [subcat, items] of Object.entries(products)) {
            html += `<div style="display:flex;justify-content:space-between;margin-top:20px;margin-bottom:10px;font-size:14px;font-weight:700;color:var(--clr-text-primary)"><span>${subcat}</span><span style="color:var(--clr-primary);font-size:12px;cursor:pointer;">View all</span></div>`;
            html += '<div class="explore-products-grid">';
            html += (Array.isArray(items) ? items : []).map(p => this.createProductCard(p)).join('');
            html += '</div>';
        }
        container.innerHTML = html;
        return;
    }
    
    container.innerHTML = '<div class="explore-products-grid">' + 
      products.map(p => this.createProductCard(p)).join('') + 
      '</div>';
  },
  
  promptAnalyzeProduct(productName, brand = '', imageUrl = '') {
    const label = [brand, productName].filter(Boolean).join(' ');
    if (!confirm(`Analyze ${label || 'this product'}?`)) return;
    SearchPage.analyzeByName(productName, brand, imageUrl);
  },

  createProductCard(p) {
    const name = p.name || p.product_name || p.Product || p.title || 'Unknown Product';
    const brand = p.brand || p.Brand || p.company || '';
    const price = p.price || p.Price || p.cost || '';
    const img = p.image || p.image_url || p.Image || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🧴</text></svg>';
    const encodedName = encodeURIComponent(name);
    const encodedBrand = encodeURIComponent(brand);
    const encodedImg = encodeURIComponent(img);
    
    return `
      <div class="ep-card">
        <img src="${img}" alt="${name}" class="ep-img" title="Double-click to analyze" ondblclick="ExploreAPI.promptAnalyzeProduct(decodeURIComponent('${encodedName}'), decodeURIComponent('${encodedBrand}'), decodeURIComponent('${encodedImg}'))" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🧴</text></svg>'">
        ${brand ? `<div class="ep-brand">${brand}</div>` : ''}
        <div class="ep-name">${name}</div>
        ${price ? `<div class="ep-price">${price}</div>` : ''}
      </div>
    `;
  }
};

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
function init() {
  Theme.init();
  Notifications.init();
  State.history = Storage.getHistory();
  Pages.renderHome();
  initEvents();
  Router.go('home');
}

document.addEventListener('DOMContentLoaded', init);
