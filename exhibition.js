// ═══════════════════════════════════════════════════════
//  展覽規劃模組  —  exhibition.js
// ═══════════════════════════════════════════════════════

const API_URL = 'https://script.google.com/macros/s/AKfycbwHaxwSZztR-qbtse4qG09YENNe3fGYvIRvafHjVaxKLeFKIFaYJn6r4PDbKV10Rx05/exec';

// 任務結構定義
const TASKS = [
  { k:'藝術家展覽簽約', subs:[] },
  { k:'作品確認', subs:[
    { k:'作品圖確認', anyOne:true, subs:[
      { k:'藝術家有提供', subs:[] },
      { k:'藝術家沒提供 → 預約拍照', subs:[] }
    ]}
  ]},
  { k:'展品運輸', subs:[
    { k:'取件預約', subs:[] },
    { k:'表框', anyOne:true, subs:[
      { k:'是', subs:[] },
      { k:'否', subs:[] }
    ]}
  ]},
  { k:'場地準備', subs:[
    { k:'櫥窗油漆顏色確定', subs:[] },
    { k:'展場內油漆及牆面補洞', subs:[] }
  ]},
  { k:'設計製作', subs:[
    { k:'Facebook', subs:[] },
    { k:'Instagram', subs:[] },
    { k:'海報', subs:[] },
    { k:'卡點', subs:[] },
    { k:'Floor map', subs:[] },
    { k:'小卡製作', anyOne:true, subs:[
      { k:'有', subs:[] },
      { k:'無', subs:[] }
    ]}
  ]},
  { k:'布展', subs:[{ k:'時間預約', subs:[] }] },
  { k:'媒體通知', subs:[{ k:'國內', subs:[] },{ k:'國外', subs:[] }] },
  { k:'開幕宣傳', subs:[{ k:'LINE 群發', subs:[] },{ k:'電子報', subs:[] },{ k:'社群', subs:[] }] },
  { k:'開幕茶會', subs:[] },
  { k:'結展撤展', subs:[] },
  { k:'展覽後展品處置', mutex:true, subs:[
    { k:'作品無售出', subs:[{ k:'作品退回藝術家', subs:[] }] },
    { k:'作品售出', subs:[
      { k:'紙箱製作', subs:[] },
      { k:'保證卡製作', subs:[] },
      { k:'運輸', subs:[] }
    ]}
  ]}
];

function flattenTasks(nodes) {
  const result = [];
  nodes.forEach(n => { result.push(n); if (n.subs.length) result.push(...flattenTasks(n.subs)); });
  return result;
}
const TASK_FLAT  = flattenTasks(TASKS);
const TASK_COUNT = TASK_FLAT.length;

const MONTHS       = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const STATUS_LABELS = { planning:'規劃中', confirmed:'已確認', active:'展覽中', done:'已結束' };

let currentYear  = new Date().getFullYear();
let exhibitions  = [];
let editingExhId = null;
let isSaving     = false;
const taskMeta   = {};

// ── API / Sync ──────────────────────────────────────────

function setSyncState(s) {
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  if (!dot) return;
  dot.className = 'sync-dot' + (s === 'syncing' ? ' syncing' : s === 'error' ? ' error' : '');
  lbl.textContent = s === 'syncing' ? '同步中…' : s === 'error' ? '連線失敗' : '已連線';
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = '_cb' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      delete window[cbName];
      script.parentNode && script.parentNode.removeChild(script);
      reject(new Error('timeout'));
    }, 20000);
    window[cbName] = (data) => {
      clearTimeout(timer);
      delete window[cbName];
      script.parentNode && script.parentNode.removeChild(script);
      resolve(data);
    };
    const script = document.createElement('script');
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => {
      clearTimeout(timer);
      delete window[cbName];
      script.parentNode && script.parentNode.removeChild(script);
      reject(new Error('script load error'));
    };
    document.head.appendChild(script);
  });
}

const requestQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;
  const { url, resolve, reject } = requestQueue.shift();
  try { resolve(await jsonp(url)); }
  catch(e) { reject(e); }
  finally { isProcessing = false; processQueue(); }
}

function queuedJsonp(url) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ url, resolve, reject });
    processQueue();
  });
}

async function fetchWithRetry(url, isWrite, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const data = isWrite ? await queuedJsonp(url) : await jsonp(url);
      if (data && data.error === 'busy') {
        if (attempt < maxRetries) { setSyncState('syncing'); await delay(1000 * (attempt + 1)); continue; }
      }
      return data;
    } catch(e) {
      if (attempt < maxRetries) { await delay(800 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiFetch(method, body) {
  setSyncState('syncing');
  try {
    let data;
    if (method === 'GET') {
      const url = `${API_URL}?action=list&year=${currentYear}&email=${encodeURIComponent(currentUser.email)}`;
      data = await fetchWithRetry(url, false);
    } else {
      const payload = { ...body, email: currentUser.email };
      const url = `${API_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`;
      data = await fetchWithRetry(url, true);
    }
    if (data && data.error === 'unauthorized') { logout(); return null; }
    setSyncState('ok');
    return data;
  } catch(e) { setSyncState('error'); throw e; }
}

async function loadExhibitions() {
  try {
    const res = await apiFetch('GET');
    if (res && res.success) { exhibitions = res.data; renderExhibitions(); }
    else showExhError('載入失敗');
  } catch(e) { showExhError('無法連線至伺服器'); }
}

function showExhError(msg) {
  document.getElementById('ganttBody').innerHTML = `<div class="error-state">${msg}</div>`;
}

// ── 渲染 ──────────────────────────────────────────────

function pct(dateStr) {
  const d = new Date(dateStr), s = new Date(currentYear,0,1), e = new Date(currentYear+1,0,1);
  return Math.max(0, Math.min(1, (d - s) / (e - s)));
}

function renderExhibitions() {
  document.getElementById('yearNum').textContent = currentYear;
  document.getElementById('pageTitle').textContent = `${currentYear} 年度展覽規劃`;
  document.getElementById('monthsRow').innerHTML = MONTHS.map(m => `<div class="month-cell">${m}</div>`).join('');

  const counts = {};
  exhibitions.forEach(e => counts[e.status] = (counts[e.status] || 0) + 1);
  const avgProg = exhibitions.length
    ? Math.round(exhibitions.reduce((s, e) => {
        const t = Array.isArray(e.tasks) ? e.tasks : Array(TASK_COUNT).fill(0);
        return s + t.filter(x => x).length / t.length;
      }, 0) / exhibitions.length * 100) : 0;

  document.getElementById('exhStatsBar').innerHTML = `
    <div class="stat-card"><div class="stat-label">總展覽數</div><div class="stat-val">${exhibitions.length}<span class="stat-unit"> 檔</span></div></div>
    <div class="stat-card"><div class="stat-label">已結束</div><div class="stat-val">${counts.done||0}<span class="stat-unit"> 檔</span></div></div>
    <div class="stat-card"><div class="stat-label">進行中</div><div class="stat-val">${counts.active||0}<span class="stat-unit"> 檔</span></div></div>
    <div class="stat-card"><div class="stat-label">平均進度</div><div class="stat-val">${avgProg}<span class="stat-unit"> %</span></div></div>`;

  const todayPct = pct(new Date().toISOString().slice(0,10));
  const body = document.getElementById('ganttBody');
  if (!exhibitions.length) {
    body.innerHTML = '<div class="loading-state">此年度尚無展覽，點擊「新增展覽」開始規劃。</div>';
    document.getElementById('cardList').innerHTML = '';
    return;
  }
  body.innerHTML = '';
  const sorted = [...exhibitions].sort((a, b) => new Date(a.start) - new Date(b.start));
  sorted.forEach(e => {
    e.start = normalizeDate(e.start);
    e.end   = normalizeDate(e.end);
    const sp = pct(e.start) * 100, ep = pct(e.end) * 100;
    const bL = Math.max(0, sp), bR = Math.min(100, ep), bW = Math.max(0, bR - bL);
    const tasks = Array.isArray(e.tasks) ? e.tasks : Array(TASK_COUNT).fill(0);
    const prog  = Math.round(tasks.filter(x => x).length / tasks.length * 100);
    const row   = document.createElement('div');
    row.className = 'gantt-row';
    row.innerHTML = `
      <div class="gantt-info" onclick="openEditExh(${e.id})">
        <div class="gantt-name">${e.name}</div>
        <div class="gantt-meta">
          <span class="status-badge s-${e.status}">${STATUS_LABELS[e.status]}</span>
          <span class="progress-text">${prog}%</span>
        </div>
      </div>
      <div class="gantt-tl" onclick="openEditExh(${e.id})">
        <div class="tl-grid">${Array(12).fill('<div class="tl-cell"></div>').join('')}</div>
        ${currentYear === new Date().getFullYear() ? `<div class="today-marker" style="left:${todayPct*100}%;background:var(--gold);opacity:0.7"></div>` : ''}
        ${bW > 0 ? `<div class="bar bar-${e.status}" style="left:${bL}%;width:${bW}%">${bW > 6 ? e.name : ''}</div>` : ''}
      </div>`;
    body.appendChild(row);
  });

  // 手機卡片
  const cardList = document.getElementById('cardList');
  cardList.innerHTML = '';
  sorted.forEach(e => {
    const tasks = Array.isArray(e.tasks) ? e.tasks : Array(TASK_COUNT).fill(0);
    const prog  = Math.round(tasks.filter(x => x).length / tasks.length * 100);
    const startFmt = e.start ? e.start.slice(0,7).replace('-','/') : '';
    const endFmt   = e.end   ? e.end.slice(0,7).replace('-','/')   : '';
    const card = document.createElement('div');
    card.className = 'exh-card';
    card.onclick = () => openEditExh(e.id);
    card.innerHTML = `
      <div class="exh-card-top">
        <div class="exh-card-name">${e.name}</div>
        <span class="status-badge s-${e.status}">${STATUS_LABELS[e.status]}</span>
      </div>
      <div class="exh-card-meta">
        <span class="exh-card-date">📅 ${startFmt} — ${endFmt}</span>
        ${e.room ? `<span class="exh-card-date">📍 ${e.room}</span>` : ''}
        <span class="exh-card-date">${prog}%</span>
      </div>
      <div class="exh-progress-bar"><div class="exh-progress-fill" style="width:${prog}%"></div></div>`;
    cardList.appendChild(card);
  });
}

// ── 彈窗 ──────────────────────────────────────────────

function openAddExh() {
  editingExhId = null;
  document.getElementById('exhModalTitle').textContent = '新增展覽';
  document.getElementById('exhDeleteBtn').style.display = 'none';
  fillExhModal({ name:'', artist:'', curator:'', type:'畫作', start:`${currentYear}-01-01`, end:`${currentYear}-03-31`, status:'planning', room:'', tasks: Array(TASK_COUNT).fill(0) });
  document.getElementById('exhOverlay').classList.add('open');
}

function openEditExh(id) {
  editingExhId = id;
  const e = exhibitions.find(x => x.id === id);
  document.getElementById('exhModalTitle').textContent = '編輯展覽';
  document.getElementById('exhDeleteBtn').style.display = 'inline-block';
  fillExhModal(e);
  document.getElementById('exhOverlay').classList.add('open');
}

function closeExhModal() { document.getElementById('exhOverlay').classList.remove('open'); }
function maybeCloseExh(e) { if (e.target === document.getElementById('exhOverlay')) closeExhModal(); }

function chkHtml() {
  return `<div class="chk"><svg class="chkico" viewBox="0 0 8 6"><path d="M1 3L3 5L7 1"/></svg></div>`;
}

function buildTaskNodes(nodes, tasks, depth, idxRef, parentIdx) {
  let html = '';
  const siblingIdxs = [];
  const peek = { i: idxRef.i };
  nodes.forEach(n => { siblingIdxs.push(peek.i); peek.i++; countFlat(n.subs, peek); });

  nodes.forEach((n) => {
    const myIdx    = idxRef.i++;
    const hasSubs  = n.subs && n.subs.length > 0;
    const isChecked = tasks[myIdx] ? 'ck' : '';
    const cls       = depth === 0 ? 'task-parent' : depth === 1 ? 'task-sub' : 'task-sub2';
    const container = depth === 0 ? 'task-subs' : 'task-sub2s';

    taskMeta[myIdx] = {
      anyOne: n.anyOne || false,
      mutex:  n.mutex  || false,
      parentIdx,
      siblingIdxs: siblingIdxs.filter(x => x !== myIdx)
    };

    html += `<div class="${cls} ${isChecked}" data-idx="${myIdx}" onclick="toggleNode(this)">
      ${chkHtml()}<span class="task-name">${n.k}</span>
      ${hasSubs ? `<span class="task-cnt" id="tcnt-${myIdx}"></span>` : `<input type="checkbox" style="display:none" data-idx="${myIdx}" ${isChecked ? 'checked' : ''}>`}
    </div>`;
    if (hasSubs) {
      html += `<div class="${container}" id="subsof-${myIdx}">`;
      html += buildTaskNodes(n.subs, tasks, depth + 1, idxRef, myIdx);
      html += `</div>`;
    }
  });
  return html;
}

function countFlat(nodes, ref) {
  nodes.forEach(n => { ref.i++; if (n.subs) countFlat(n.subs, ref); });
}

function normalizeDate(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return s;
}

function fillExhModal(e) {
  document.getElementById('fName').value    = e.name    || '';
  document.getElementById('fArtist').value  = e.artist  || '';
  document.getElementById('fCurator').value = e.curator || '';
  document.getElementById('fType').value    = e.type    || '其他';
  document.getElementById('fStart').value   = normalizeDate(e.start);
  document.getElementById('fEnd').value     = normalizeDate(e.end);
  document.getElementById('fStatus').value  = e.status  || 'planning';
  document.getElementById('fRoom').value    = e.room    || '';

  let tasks = Array.isArray(e.tasks) ? [...e.tasks] : [];
  while (tasks.length < TASK_COUNT) tasks.push(0);
  Object.keys(taskMeta).forEach(k => delete taskMeta[k]);
  const idxRef = { i: 0 };
  document.getElementById('taskList').innerHTML = buildTaskNodes(TASKS, tasks, 0, idxRef, null);
  applyDisabledStates();
  updateAllCounts();
}

function toggleNode(el) {
  if (el.classList.contains('disabled')) return;
  const idx      = parseInt(el.dataset.idx);
  const meta     = taskMeta[idx];
  const willCheck = !el.classList.contains('ck');

  setNodeChecked(el, willCheck);

  const subsEl = document.getElementById(`subsof-${idx}`);
  if (subsEl) {
    subsEl.querySelectorAll('[data-idx]').forEach(child => {
      if (!child.classList.contains('disabled')) setNodeChecked(child, willCheck);
    });
  }

  if (meta && meta.parentIdx !== null && meta.parentIdx !== undefined) {
    const parentMeta = taskMeta[meta.parentIdx];
    if (parentMeta && (parentMeta.anyOne || parentMeta.mutex)) {
      if (willCheck) {
        meta.siblingIdxs.forEach(sibIdx => disableBranch(sibIdx, true));
      } else {
        const anyChecked = meta.siblingIdxs.some(sibIdx => {
          const s = document.querySelector(`[data-idx="${sibIdx}"]`);
          return s && s.classList.contains('ck');
        });
        if (!anyChecked) meta.siblingIdxs.forEach(sibIdx => disableBranch(sibIdx, false));
      }
    }
  }
  updateAllCounts();
}

function setNodeChecked(el, checked) {
  el.classList.toggle('ck', checked);
  const cb = el.querySelector(':scope > input[type=checkbox]');
  if (cb) cb.checked = checked;
}

function disableBranch(idx, disabled) {
  const el = document.querySelector(`[data-idx="${idx}"]`);
  if (el) el.classList.toggle('disabled', disabled);
  const subs = document.getElementById(`subsof-${idx}`);
  if (subs) subs.querySelectorAll('[data-idx]').forEach(c => c.classList.toggle('disabled', disabled));
}

function applyDisabledStates() {
  Object.entries(taskMeta).forEach(([idxStr, meta]) => {
    const idx = parseInt(idxStr);
    const el  = document.querySelector(`[data-idx="${idx}"]`);
    if (!el || !el.classList.contains('ck')) return;
    if (meta.parentIdx === null || meta.parentIdx === undefined) return;
    const parentMeta = taskMeta[meta.parentIdx];
    if (!parentMeta || (!parentMeta.anyOne && !parentMeta.mutex)) return;
    meta.siblingIdxs.forEach(sibIdx => disableBranch(sibIdx, true));
  });
}

function updateAllCounts() {
  document.querySelectorAll('[id^="tcnt-"]').forEach(cnt => {
    const parentIdx = parseInt(cnt.id.replace('tcnt-', ''));
    const parentEl  = document.querySelector(`[data-idx="${parentIdx}"]`);
    if (!parentEl) return;
    const subsEl = document.getElementById(`subsof-${parentIdx}`);
    if (!subsEl) return;
    const meta = taskMeta[parentIdx];
    const directChildren = Array.from(subsEl.children).filter(c => c.dataset && c.dataset.idx);
    if (meta && (meta.anyOne || meta.mutex)) {
      const anyDone = directChildren.some(c => c.classList.contains('ck'));
      cnt.textContent = anyDone ? '✓' : `0/${directChildren.length}`;
      parentEl.classList.toggle('ck', anyDone);
    } else {
      const done = directChildren.filter(c => c.classList.contains('ck')).length;
      cnt.textContent = `${done}/${directChildren.length}`;
      parentEl.classList.toggle('ck', done === directChildren.length && directChildren.length > 0);
    }
  });
}

async function saveExh() {
  if (isSaving) return;
  isSaving = true;
  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = '儲存中…';

  const tasks = Array(TASK_COUNT).fill(0);
  document.querySelectorAll('#taskList input[type=checkbox]').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (!isNaN(idx)) tasks[idx] = cb.checked ? 1 : 0;
  });
  document.querySelectorAll('#taskList .task-parent,.task-sub,.task-sub2').forEach(el => {
    const idx = parseInt(el.dataset.idx);
    if (!isNaN(idx)) tasks[idx] = el.classList.contains('ck') ? 1 : 0;
  });

  const data = {
    id:      editingExhId,
    name:    document.getElementById('fName').value    || '未命名展覽',
    artist:  document.getElementById('fArtist').value,
    curator: document.getElementById('fCurator').value,
    type:    document.getElementById('fType').value,
    start:   document.getElementById('fStart').value,
    end:     document.getElementById('fEnd').value,
    status:  document.getElementById('fStatus').value,
    room:    document.getElementById('fRoom').value,
    tasks
  };

  try {
    const action = editingExhId ? 'update' : 'create';
    const res = await apiFetch('POST', { action, data, id: editingExhId });
    if (res && res.success) { closeExhModal(); await loadExhibitions(); }
    else alert('儲存失敗：' + (res && res.error || '未知錯誤'));
  } catch(e) { alert('網路錯誤，請稍後再試'); }

  isSaving = false;
  btn.disabled = false;
  btn.textContent = '儲存';
}

async function deleteExh() {
  if (!editingExhId || !confirm('確定要刪除此展覽？')) return;
  try {
    const res = await apiFetch('POST', { action: 'delete', id: editingExhId });
    if (res && res.success) { closeExhModal(); await loadExhibitions(); }
    else alert('刪除失敗');
  } catch(e) { alert('網路錯誤'); }
}

function changeYear(d) { currentYear += d; loadExhibitions(); }
