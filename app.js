// =============================================================================
// 販売マニュアル ビューア — App Logic
// パスワード認証 + マニュアル一覧 + スワイプ対応ビューア
// =============================================================================

// Service Worker 登録
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

(function () {
  'use strict';

  // ── 設定 ──────────────────────────────────────────────
  // パスワードの SHA-256 ハッシュ（平文パスワードはコードに含めない）
  // デフォルト: "shashokudeli" のハッシュ
  // 変更する場合: ブラウザコンソールで以下を実行してハッシュを取得
  //   crypto.subtle.digest('SHA-256', new TextEncoder().encode('新パスワード'))
  //     .then(h => console.log([...new Uint8Array(h)].map(b => b.toString(16).padStart(2,'0')).join('')))
  const PASSWORD_HASH = '4be559f35ed81c407dec52e525a630f51ef3b3d35f685d1e09a595a3536ea531';
  const AUTH_KEY = 'manual_auth_token';
  const AUTH_EXPIRY_DAYS = 30;

  // ── DOM 要素 ──────────────────────────────────────────
  const $passwordScreen = document.getElementById('password-screen');
  const $passwordForm = document.getElementById('password-form');
  const $passwordInput = document.getElementById('password-input');
  const $passwordError = document.getElementById('password-error');
  const $app = document.getElementById('app');
  const $searchInput = document.getElementById('search-input');
  const $manualList = document.getElementById('manual-list');
  const $viewerScreen = document.getElementById('viewer-screen');
  const $viewerTitle = document.getElementById('viewer-title');
  const $viewerPageIndicator = document.getElementById('viewer-page-indicator');
  const $viewerSlides = document.getElementById('viewer-slides');
  const $viewerDots = document.getElementById('viewer-dots');
  const $viewerBack = document.getElementById('viewer-back');
  const $navPrev = document.getElementById('nav-prev');
  const $navNext = document.getElementById('nav-next');

  // ── 状態 ──────────────────────────────────────────────
  let manuals = [];
  let currentCategory = 'location';  // 'location' or 'common'
  let currentManual = null;
  let currentPage = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchDeltaX = 0;
  let isSwiping = false;
  let slides = [];

  // =============================================================================
  // 1. パスワード認証
  // =============================================================================

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function isAuthenticated() {
    const token = localStorage.getItem(AUTH_KEY);
    if (!token) return false;
    try {
      const { hash, expiry } = JSON.parse(token);
      if (hash !== PASSWORD_HASH) return false;
      if (new Date().getTime() > expiry) {
        localStorage.removeItem(AUTH_KEY);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function setAuthenticated() {
    const expiry = new Date().getTime() + AUTH_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ hash: PASSWORD_HASH, expiry }));
  }

  function showApp() {
    $passwordScreen.classList.add('hidden');
    $app.classList.add('visible');
    setTimeout(() => { $passwordScreen.style.display = 'none'; }, 500);
    loadManuals();
  }

  $passwordForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const pw = $passwordInput.value;
    const hash = await sha256(pw);

    if (hash === PASSWORD_HASH) {
      setAuthenticated();
      showApp();
    } else {
      $passwordError.classList.add('show');
      $passwordInput.value = '';
      $passwordInput.focus();
      setTimeout(() => $passwordError.classList.remove('show'), 2500);
    }
  });

  // 認証チェック
  if (isAuthenticated()) {
    showApp();
  } else {
    $passwordInput.focus();
  }

  // =============================================================================
  // 2. マニュアル一覧の読み込みと表示
  // =============================================================================

  async function loadManuals() {
    try {
      const res = await fetch('manuals.json');
      const data = await res.json();
      manuals = data.manuals || [];
      updateTabCounts();
      filterAndRender();
    } catch (err) {
      $manualList.innerHTML =
        '<div class="empty-state"><div class="icon">⚠️</div><p>マニュアルデータの読み込みに失敗しました</p></div>';
      console.error('Failed to load manuals:', err);
    }
  }

  function updateTabCounts() {
    const locCount = manuals.filter(m => m.category === 'location').length;
    const comCount = manuals.filter(m => m.category === 'common').length;
    document.getElementById('count-location').textContent = locCount;
    document.getElementById('count-common').textContent = comCount;
  }

  function filterAndRender() {
    const q = $searchInput.value.trim().toLowerCase();
    let list = manuals.filter(m => m.category === currentCategory);
    if (q) {
      list = list.filter(m =>
        m.location.toLowerCase().includes(q) ||
        (m.address || '').toLowerCase().includes(q)
      );
    }
    renderManualList(list);
  }

  function renderManualList(list) {
    if (list.length === 0) {
      $manualList.innerHTML =
        '<div class="empty-state"><div class="icon">🔍</div><p>該当するマニュアルが見つかりません</p></div>';
      return;
    }

    const label = currentCategory === 'location' ? '拠点' : 'マニュアル';
    const countHtml = `<div class="manual-count">${list.length} 件の${label}</div>`;
    const icon = currentCategory === 'location' ? '📋' : '📄';

    const cardsHtml = list.map(m => `
      <div class="manual-card" data-id="${m.id}" role="button" tabindex="0">
        <div class="manual-card-header">
          <div class="manual-card-icon">${icon}</div>
          <div class="manual-card-info">
            <div class="manual-card-name">${escapeHtml(m.location)}</div>
            ${m.address ? `<div class="manual-card-address">${escapeHtml(m.address)}</div>` : ''}
            <div class="manual-card-meta">
              <span>📄 ${m.pageCount}ページ</span>
              <span>🔄 ${m.updateDate || '—'}</span>
            </div>
          </div>
          <span class="manual-card-arrow">›</span>
        </div>
      </div>
    `).join('');

    $manualList.innerHTML = countHtml + cardsHtml;

    // カードクリックイベント
    $manualList.querySelectorAll('.manual-card').forEach(card => {
      card.addEventListener('click', () => openViewer(card.dataset.id));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openViewer(card.dataset.id);
      });
    });
  }

  // カテゴリタブ切替
  document.querySelectorAll('.category-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      currentCategory = this.dataset.category;
      filterAndRender();
    });
  });

  // 検索フィルタ
  $searchInput.addEventListener('input', filterAndRender);

  // =============================================================================
  // 3. マニュアルビューア
  // =============================================================================

  function openViewer(manualId) {
    currentManual = manuals.find(m => m.id === manualId);
    if (!currentManual) return;

    currentPage = 0;
    $viewerTitle.textContent = currentManual.location;
    $viewerScreen.classList.add('visible');
    document.body.style.overflow = 'hidden';

    // スライド生成
    buildSlides();
    updateViewer();

    // URL ハッシュ更新
    history.pushState({ viewer: true }, '', '#' + manualId);
  }

  function closeViewer() {
    $viewerScreen.classList.remove('visible');
    document.body.style.overflow = '';
    currentManual = null;
    slides = [];

    // ハッシュクリア
    if (location.hash) history.back();
  }

  function loadSlideImage(index) {
    const slide = slides[index];
    if (!slide || slide.querySelector('img')) return;
    const i = index;
    slide.innerHTML = `<div class="spinner"></div>`;
    const img = new Image();
    img.src = `${currentManual.imageDir}/page_${String(i + 1).padStart(2, '0')}.webp`;
    img.alt = `${currentManual.location} - ページ ${i + 1}`;
    img.onload = function () {
      slide.innerHTML = '';
      slide.appendChild(img);
    };
    img.onerror = function () {
      slide.innerHTML = '<div class="empty-state"><p>画像を読み込めませんでした</p></div>';
    };
  }

  function preloadNearby(page) {
    const lo = Math.max(0, page - 1);
    const hi = Math.min(slides.length - 1, page + 2);
    for (let i = lo; i <= hi; i++) loadSlideImage(i);
  }

  function buildSlides() {
    // 既存のスライドをクリア（ナビボタンは残す）
    const existingSlides = $viewerSlides.querySelectorAll('.viewer-slide');
    existingSlides.forEach(s => s.remove());
    slides = [];

    for (let i = 0; i < currentManual.pageCount; i++) {
      const slide = document.createElement('div');
      slide.className = 'viewer-slide';
      $viewerSlides.insertBefore(slide, $navPrev);
      slides.push(slide);
    }

    // ドット生成
    $viewerDots.innerHTML = '';
    for (let i = 0; i < currentManual.pageCount; i++) {
      const dot = document.createElement('button');
      dot.className = 'viewer-dot';
      dot.setAttribute('aria-label', `ページ ${i + 1}`);
      dot.addEventListener('click', () => goToPage(i));
      $viewerDots.appendChild(dot);
    }

    preloadNearby(0);
  }

  function updateViewer() {
    // スライド位置更新
    slides.forEach((slide, i) => {
      const offset = (i - currentPage) * 100;
      slide.style.transform = `translateX(${offset}%)`;
    });

    // ページインジケーター
    $viewerPageIndicator.textContent = `${currentPage + 1} / ${currentManual.pageCount}`;

    // ドット更新
    const dots = $viewerDots.querySelectorAll('.viewer-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === currentPage);
    });

    // ナビボタン
    $navPrev.style.opacity = currentPage > 0 ? '1' : '0.3';
    $navPrev.disabled = currentPage === 0;
    $navNext.style.opacity = currentPage < currentManual.pageCount - 1 ? '1' : '0.3';
    $navNext.disabled = currentPage === currentManual.pageCount - 1;

    // 近隣ページを先読み
    preloadNearby(currentPage);
  }

  function goToPage(page) {
    if (page < 0 || page >= currentManual.pageCount) return;
    currentPage = page;
    updateViewer();
  }

  // ── タッチスワイプ ──

  $viewerSlides.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchDeltaX = 0;
    isSwiping = false;

    // トランジション無効化（ドラッグ中）
    slides.forEach(s => { s.style.transition = 'none'; });
  }, { passive: true });

  $viewerSlides.addEventListener('touchmove', function (e) {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;

    // 横方向の移動が大きい場合のみスワイプとして扱う
    if (!isSwiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      isSwiping = true;
    }

    if (!isSwiping) return;

    touchDeltaX = dx;

    // ドラッグに追従
    slides.forEach((slide, i) => {
      const offset = (i - currentPage) * 100;
      const dragPct = (touchDeltaX / $viewerSlides.offsetWidth) * 100;
      slide.style.transform = `translateX(${offset + dragPct}%)`;
    });
  }, { passive: true });

  $viewerSlides.addEventListener('touchend', function () {
    // トランジション復帰
    slides.forEach(s => {
      s.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    });

    if (!isSwiping) return;

    const threshold = $viewerSlides.offsetWidth * 0.2; // 20% でページ送り

    if (touchDeltaX < -threshold && currentPage < currentManual.pageCount - 1) {
      currentPage++;
    } else if (touchDeltaX > threshold && currentPage > 0) {
      currentPage--;
    }

    updateViewer();
    isSwiping = false;
  });

  // ── ナビボタン ──

  $viewerBack.addEventListener('click', closeViewer);
  $navPrev.addEventListener('click', () => goToPage(currentPage - 1));
  $navNext.addEventListener('click', () => goToPage(currentPage + 1));

  // ── キーボード ──

  document.addEventListener('keydown', function (e) {
    if (!currentManual) return;
    if (e.key === 'ArrowLeft') goToPage(currentPage - 1);
    if (e.key === 'ArrowRight') goToPage(currentPage + 1);
    if (e.key === 'Escape') closeViewer();
  });

  // ── ブラウザ戻る ──

  window.addEventListener('popstate', function () {
    if (currentManual) {
      $viewerScreen.classList.remove('visible');
      document.body.style.overflow = '';
      currentManual = null;
      slides = [];
    }
  });

  // =============================================================================
  // 4. ユーティリティ
  // =============================================================================

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
