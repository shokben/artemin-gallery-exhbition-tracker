// ═══════════════════════════════════════════════════════
//  主程式  —  main.js
//  處理 Google 登入、Tab 切換、初始化
// ═══════════════════════════════════════════════════════

let currentUser = null;

const WHITELIST = [
  'benhsiao@artemingallery.com',
  'phiisc@artemingallery.com',
  'info@artemingallery.com',
  'chanelcheng@artemingallery.com',
  'casperchen@artemingallery.com'
];

// ── Google 登入 ──────────────────────────────────────

function handleGoogleLogin(response) {
  const payload = parseJwt(response.credential);
  const email   = payload.email;

  if (!WHITELIST.includes(email.toLowerCase())) {
    const err = document.getElementById('loginErr');
    err.textContent = '此帳號沒有存取權限，請聯繫管理員。';
    err.style.display = 'block';
    return;
  }

  currentUser = { email, name: payload.name, avatar: payload.picture };
  sessionStorage.setItem('gallery_user', JSON.stringify(currentUser));
  showApp();
  initApp();
}

function parseJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(
    decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    )
  );
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display   = 'block';
  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userAvatar').src       = currentUser.avatar || '';
}

function logout() {
  currentUser  = null;
  exhibitions  = [];
  sessionStorage.removeItem('gallery_user');
  document.getElementById('appScreen').style.display   = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginErr').style.display    = 'none';
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
}

// 頁面載入時檢查 session
(function checkSession() {
  const saved = sessionStorage.getItem('gallery_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      showApp();
      initApp();
    } catch(e) { sessionStorage.removeItem('gallery_user'); }
  }
})();

// ── 初始化 ──────────────────────────────────────────

function initApp() {
  // 兩個模組都從 Google Sheets 載入
  loadExhibitions();
  loadArtworks();
}

// ── Tab 切換 ──────────────────────────────────────────

let currentTab = 'exhibition';

function switchTab(tab) {
  currentTab = tab;

  // 更新 Tab 按鈕樣式
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'tab-' + tab);
  });

  // 切換頁面
  document.getElementById('page-exhibition').style.display   = tab === 'exhibition'   ? '' : 'none';
  document.getElementById('page-consignment').style.display  = tab === 'consignment'  ? '' : 'none';

  // 切換到徵件時隱藏 sync 狀態（sync 是展覽用的）
  document.getElementById('syncStatus').style.display = tab === 'exhibition' ? '' : 'none';
}
