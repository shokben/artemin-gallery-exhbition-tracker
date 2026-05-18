// ═══════════════════════════════════════════════════════
//  徵件管理模組  —  consignment.js
//  資料儲存：Google Sheets（透過 Apps Script）
//  圖片儲存：Google Drive（透過 Apps Script uploadImage）
// ═══════════════════════════════════════════════════════

const MEDIA_LABEL = {
  oil:'油彩', acrylic:'壓克力', watercolor:'水彩', ink:'水墨',
  print:'版畫', sculpture:'雕塑', photo:'攝影', mixed:'複合媒材', other:'其他'
};
const ART_STATUS_LABEL = { new:'新登錄', consign:'委賣中', reserved:'預留', sold:'已售出' };
const LOC_LABEL        = { gallery:'藝廊', collector:'藏家' };

let artworks    = [];
let artSelected = new Set();
let editArtId   = null;
let artSortCol  = '';
let artSortDir  = 1;
// tmpImgs 格式：{ url, isNew, base64, filename, mimeType }
// isNew=true  → 還未上傳，儲存時才送到 Drive
// isNew=false → 已在 Drive，直接保留 url
let tmpImgs = { hq: [], cond: [] };

// ── 資料載入（從 Sheets）──────────────────────────────

async function loadArtworks() {
  setArtSyncState('syncing');
  try {
    const url = `${API_URL}?action=listArtworks&email=${encodeURIComponent(currentUser.email)}`;
    const res = await fetchWithRetry(url, false);
    if (res && res.success) {
      artworks = res.data;
      renderArtworks();
      setArtSyncState('ok');
    } else {
      setArtSyncState('error');
      showArtError('載入作品失敗');
    }
  } catch(e) {
    setArtSyncState('error');
    showArtError('無法連線');
  }
}

function setArtSyncState(s) {
  if (currentTab !== 'consignment') return;
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  if (!dot) return;
  dot.className   = 'sync-dot' + (s === 'syncing' ? ' syncing' : s === 'error' ? ' error' : '');
  lbl.textContent = s === 'syncing' ? '同步中…' : s === 'error' ? '連線失敗' : '已連線';
}

function showArtError(msg) {
  const el = document.getElementById('artEmpty');
  el.innerHTML = `
    <div style="font-size:36px;margin-bottom:8px">⚠️</div>
    <p>${msg}</p>
    <button onclick="loadArtworks()" style="margin-top:12px;padding:6px 16px;border:1px solid var(--border-md);border-radius:var(--radius);background:white;cursor:pointer;font-family:var(--sans);font-size:13px">重新載入</button>`;
  el.style.display = 'block';
  document.getElementById('artTbody').innerHTML = '';
}

// ── 圖片上傳（到 Drive）──────────────────────────────

async function uploadSingleImage(base64, filename, mimeType) {
  const payload = { action:'uploadImage', email:currentUser.email, base64, filename, mimeType };
  const url = `${API_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const res = await fetchWithRetry(url, true);
  if (res && res.success) return res.url;
  throw new Error(res && res.error || '上傳失敗');
}

async function uploadPendingImages() {
  const result = { hq: [], cond: [] };
  for (const type of ['hq', 'cond']) {
    for (const img of tmpImgs[type]) {
      if (img.isNew) {
        const url = await uploadSingleImage(img.base64, img.filename, img.mimeType);
        result[type].push(url);
      } else {
        result[type].push(img.url);
      }
    }
  }
  return result;
}

// ── 格式化 ──────────────────────────────────────────

function fmtPrice(n) { return n ? 'NT$ ' + Number(n).toLocaleString() : '—'; }
function fmtSize(w, h, d) { return [w,h,d].filter(Boolean).join(' × ') || '—'; }
function fmtDate(d) {
  if (!d) return '';
  const p = String(d).slice(0,10).split('-');
  return p.length === 3 ? `${p[0]}/${p[1]}/${p[2]}` : d;
}
function escHtml(str) {
  return String(str||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 統計 ──────────────────────────────────────────────

function updateArtStats() {
  const t      = artworks.length;
  const c      = artworks.filter(a => a.status === 'consign').length;
  const r      = artworks.filter(a => a.status === 'reserved').length;
  const s      = artworks.filter(a => a.status === 'sold').length;
  const g      = artworks.filter(a => !a.location || a.location === 'gallery').length;
  const signed = artworks.filter(a => a.contractSigned).length;
  document.getElementById('artStatsBar').innerHTML = [
    { label:'作品總數',  value: t },
    { label:'委賣中',    value: c },
    { label:'預留',      value: r },
    { label:'已售出',    value: s },
    { label:'在藝廊',    value: g },
    { label:'已簽合約',  value: signed }
  ].map(x => `<div class="stat-card"><div class="stat-label">${x.label}</div><div class="stat-val">${x.value}</div></div>`).join('');
}

// ── 渲染 ──────────────────────────────────────────────

function renderArtworks() {
  const q   = (document.getElementById('artSearch').value || '').toLowerCase();
  const st  = document.getElementById('artStatusFilter').value;
  const loc = document.getElementById('artLocFilter').value;
  const ct  = document.getElementById('artContractFilter').value;
  const med = document.getElementById('artMediaFilter').value;

  let list = artworks.filter(a => {
    if (st  && a.status   !== st)  return false;
    if (loc && a.location !== loc) return false;
    if (med && a.media    !== med) return false;
    if (ct === '1' && !a.contractSigned)  return false;
    if (ct === '0' &&  a.contractSigned)  return false;
    if (q) {
      const hay = [a.title, a.artist, a.consignor, a.note,
                   a.locationNote, a.contractNote, a.internalNote].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (artSortCol) {
    list.sort((a, b) => {
      let va = a[artSortCol] || 0, vb = b[artSortCol] || 0;
      if (typeof va === 'string') return va.localeCompare(vb, 'zh-TW') * artSortDir;
      return (Number(va) - Number(vb)) * artSortDir;
    });
  }

  const tbody = document.getElementById('artTbody');
  const empty = document.getElementById('artEmpty');
  const n     = artSelected.size;
  document.getElementById('artSelInfo').textContent    = n ? `已選取 ${n} 件` : '';
  document.getElementById('artClearSel').style.display = n ? '' : 'none';

  if (!list.length) {
    tbody.innerHTML = '';
    empty.innerHTML = `<div style="font-size:40px;margin-bottom:10px">🖼</div><p>目前無作品記錄</p><p style="font-size:12px;color:var(--ink-3);margin-top:4px">點選右上角「登錄新作品」開始建檔</p>`;
    empty.style.display = 'block';
    updateArtStats();
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = list.map(a => {
    const sel    = artSelected.has(a.id);
    const locCls = a.location === 'collector' ? 'ab-collector' : 'ab-gallery';
    const hqUrls = Array.isArray(a.hqImgs) ? a.hqImgs : [];
    const thumb  = hqUrls[0]
      ? `<img src="${hqUrls[0]}" alt="" onerror="this.parentNode.textContent='${escHtml(a.title[0]||'?')}';">`
      : escHtml(a.title[0] || '?');

    const contractHTML = a.contractSigned
      ? `<div class="contract-yes">✓ 已簽約</div>${a.contractExpiry ? `<div class="contract-expiry">至 ${fmtDate(a.contractExpiry)}</div>` : ''}`
      : `<span class="contract-no">— 未簽約</span>`;

    return `
      <tr class="${sel ? 'art-selected' : ''}" onclick="artRowClick(event,'${a.id}')">
        <td class="cb-wrap"><input type="checkbox" ${sel?'checked':''} onclick="toggleArtSel(event,'${a.id}')"></td>
        <td>
          <div class="art-cell">
            <div class="art-thumb">${thumb}</div>
            <div>
              <div class="art-cell-name">${escHtml(a.title)}</div>
              <div class="art-cell-sub">${escHtml(a.support||'')}</div>
            </div>
          </div>
        </td>
        <td>${escHtml(a.artist||'—')}</td>
        <td>${escHtml(a.year||'—')}</td>
        <td>${MEDIA_LABEL[a.media]||'—'}</td>
        <td>${fmtSize(a.w,a.h,a.d)}</td>
        <td>
          <div>${escHtml(a.consignor||'—')}</div>
          ${a.phone ? `<div class="art-cell-sub">${escHtml(a.phone)}</div>` : ''}
        </td>
        <td>
          <span class="art-badge ${locCls}">${LOC_LABEL[a.location]||'藝廊'}</span>
          ${a.locationNote ? `<div class="art-cell-sub">${escHtml(a.locationNote)}</div>` : ''}
        </td>
        <td>${contractHTML}</td>
        <td class="price-net">${fmtPrice(a.netPrice)}</td>
        <td class="price-offer">${fmtPrice(a.offerPrice)}</td>
        <td><span class="art-badge ab-${a.status||'new'}">${ART_STATUS_LABEL[a.status||'new']}</span></td>
        <td>
          <div class="row-actions">
            <button class="year-btn" style="width:auto;padding:0 8px;font-size:13px" onclick="openEditArtwork(event,'${a.id}')">✏️</button>
            <button class="year-btn" style="width:auto;padding:0 8px;font-size:13px;color:#b04040;border-color:#e5a0a0" onclick="confirmDeleteArtwork(event,'${a.id}')">🗑</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('artCheckAll').checked =
    list.length > 0 && list.every(a => artSelected.has(a.id));
  updateArtStats();
}

// ── 選取 ──────────────────────────────────────────────

function artRowClick(e, id) {
  if (e.target.type === 'checkbox' || e.target.closest('button')) return;
  toggleArtSel(e, id);
}
function toggleArtSel(e, id) {
  e.stopPropagation();
  artSelected.has(id) ? artSelected.delete(id) : artSelected.add(id);
  renderArtworks();
}
function toggleAllArt(checked) {
  const q   = document.getElementById('artSearch').value.toLowerCase();
  const st  = document.getElementById('artStatusFilter').value;
  const loc = document.getElementById('artLocFilter').value;
  const ct  = document.getElementById('artContractFilter').value;
  const med = document.getElementById('artMediaFilter').value;
  artworks.filter(a => {
    if (st  && a.status   !== st)  return false;
    if (loc && a.location !== loc) return false;
    if (med && a.media    !== med) return false;
    if (ct === '1' && !a.contractSigned) return false;
    if (ct === '0' &&  a.contractSigned) return false;
    if (q) {
      const hay = [a.title,a.artist,a.consignor,a.note,a.locationNote].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).forEach(a => checked ? artSelected.add(a.id) : artSelected.delete(a.id));
  renderArtworks();
}
function clearArtSel() { artSelected.clear(); renderArtworks(); }
function artSortBy(col) {
  if (artSortCol === col) artSortDir *= -1;
  else { artSortCol = col; artSortDir = 1; }
  renderArtworks();
}

// ── 彈窗 ──────────────────────────────────────────────

const ART_FIELDS = [
  'title','artist','year','status','location','locationNote',
  'media','support','w','h','d','note','internalNote',
  'consignor','phone','email','netPrice','offerPrice',
  'contractDate','contractExpiry','contractNote'
];

function openAddArtwork() {
  editArtId = null;
  clearArtForm();
  tmpImgs = { hq: [], cond: [] };
  renderArtPreviews('hq');
  renderArtPreviews('cond');
  document.getElementById('artModalTitle').textContent  = '登錄新作品';
  document.getElementById('artDeleteBtn').style.display = 'none';
  document.getElementById('artOverlay').classList.add('open');
}

function openEditArtwork(e, id) {
  e.stopPropagation();
  editArtId = id;
  const a = artworks.find(x => x.id === id);
  if (!a) return;
  clearArtForm();
  tmpImgs = {
    hq:   (Array.isArray(a.hqImgs)   ? a.hqImgs   : []).map(url => ({ url, isNew:false })),
    cond: (Array.isArray(a.condImgs) ? a.condImgs : []).map(url => ({ url, isNew:false }))
  };
  ART_FIELDS.forEach(k => {
    const el = document.getElementById('af_' + k);
    if (el) el.value = a[k] || '';
  });
  document.getElementById('af_contractSigned').checked = !!a.contractSigned;
  toggleArtContract();
  renderArtPreviews('hq');
  renderArtPreviews('cond');
  document.getElementById('artModalTitle').textContent  = '編輯作品';
  document.getElementById('artDeleteBtn').style.display = 'inline-block';
  document.getElementById('artOverlay').classList.add('open');
}

function closeArtModal() { document.getElementById('artOverlay').classList.remove('open'); }
function maybeCloseArt(e) { if (e.target === document.getElementById('artOverlay')) closeArtModal(); }

function clearArtForm() {
  ART_FIELDS.forEach(k => {
    const el = document.getElementById('af_' + k);
    if (!el) return;
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
  document.getElementById('af_contractSigned').checked = false;
  toggleArtContract();
}

function toggleArtContract() {
  const checked = document.getElementById('af_contractSigned').checked;
  document.getElementById('af_contractFields').className = 'contract-sub-fields' + (checked ? ' open' : '');
  document.getElementById('af_contractBlock').className  = 'contract-block full' + (checked ? ' signed' : '');
  const tag = document.getElementById('af_contractTag');
  tag.textContent = checked ? '✓ 已簽約' : '未簽約';
  tag.className   = 'contract-tag ' + (checked ? 'signed' : 'unsigned');
}

// ── 儲存（上傳圖片 → 寫入 Sheets）────────────────────

async function saveArtwork() {
  const title     = document.getElementById('af_title').value.trim();
  const artist    = document.getElementById('af_artist').value.trim();
  const consignor = document.getElementById('af_consignor').value.trim();
  if (!title || !artist || !consignor) {
    alert('請填寫作品名稱、藝術家與委賣人姓名（必填）');
    return;
  }

  const saveBtn = document.querySelector('#artOverlay .btn-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '上傳圖片中…';
  setArtSyncState('syncing');

  try {
    // 1. 上傳新圖到 Drive，舊圖保留 URL
    const uploadedImgs = await uploadPendingImages();

    // 2. 組合資料
    const data = {
      id: editArtId || null,
      ...Object.fromEntries(ART_FIELDS.map(k => {
        const el = document.getElementById('af_' + k);
        return [k, el ? el.value.trim() : ''];
      })),
      contractSigned: document.getElementById('af_contractSigned').checked,
      hqImgs:   uploadedImgs.hq,
      condImgs: uploadedImgs.cond
    };

    // 3. 寫入 Sheets
    saveBtn.textContent = '儲存中…';
    const action  = editArtId ? 'updateArtwork' : 'createArtwork';
    const payload = { action, data, email: currentUser.email };
    const url     = `${API_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const res     = await fetchWithRetry(url, true);

    if (res && res.success) {
      closeArtModal();
      await loadArtworks();
      setArtSyncState('ok');
    } else {
      alert('儲存失敗：' + (res && res.error || '未知錯誤'));
      setArtSyncState('error');
    }
  } catch(e) {
    alert('發生錯誤：' + e.message);
    setArtSyncState('error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '儲存作品';
  }
}

// ── 刪除 ──────────────────────────────────────────────

function confirmDeleteArtwork(e, id) {
  e.stopPropagation();
  const a = artworks.find(x => x.id === id);
  if (!a || !confirm(`確定要刪除「${a.title}」？\n（圖片也會一併從 Drive 刪除）`)) return;
  doDeleteArtwork(id);
}

async function deleteArtwork() {
  const a = artworks.find(x => x.id === editArtId);
  if (!a || !confirm(`確定要刪除「${a.title}」？\n（圖片也會一併從 Drive 刪除）`)) return;
  closeArtModal();
  await doDeleteArtwork(editArtId);
}

async function doDeleteArtwork(id) {
  setArtSyncState('syncing');
  try {
    const payload = { action:'deleteArtwork', id, email: currentUser.email };
    const url     = `${API_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const res     = await fetchWithRetry(url, true);
    if (res && res.success) {
      artSelected.delete(id);
      await loadArtworks();
      setArtSyncState('ok');
    } else {
      alert('刪除失敗：' + (res && res.error || ''));
      setArtSyncState('error');
    }
  } catch(e) {
    alert('刪除失敗：' + e.message);
    setArtSyncState('error');
  }
}

// ── 圖片預覽 ──────────────────────────────────────────

function handleArtImgs(input, type) {
  Array.from(input.files).forEach(f => {
    const reader = new FileReader();
    reader.onload = ev => {
      tmpImgs[type].push({
        isNew:    true,
        base64:   ev.target.result,
        url:      ev.target.result,   // 本地預覽用
        filename: f.name,
        mimeType: f.type || 'image/jpeg'
      });
      renderArtPreviews(type);
    };
    reader.readAsDataURL(f);
  });
  input.value = '';
}

function renderArtPreviews(type) {
  document.getElementById('af_prev_' + type).innerHTML =
    tmpImgs[type].map((img, i) => `
      <div class="img-preview-wrap">
        <img src="${img.url}" alt="">
        ${img.isNew ? `<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;font-size:9px;text-align:center;padding:2px;border-radius:0 0 5px 5px">待上傳</div>` : ''}
        <button class="rm" onclick="removeArtImg('${type}',${i})">✕</button>
      </div>`).join('');
}

function removeArtImg(type, i) {
  tmpImgs[type].splice(i, 1);
  renderArtPreviews(type);
}

// ── 匯出 ──────────────────────────────────────────────

function openExport() {
  const n = artSelected.size;
  document.getElementById('expCount').textContent = n ? `${n} 件` : `全部 ${artworks.length} 件`;
  document.getElementById('exportOverlay').classList.add('open');
}

function doExport() {
  const fmt  = document.querySelector('input[name=expFmt]:checked').value;
  const list = artSelected.size ? artworks.filter(a => artSelected.has(a.id)) : [...artworks];
  if (!list.length) { alert('沒有可匯出的作品'); return; }

  if (fmt === 'json') {
    dlBlob(new Blob([JSON.stringify(list,null,2)],{type:'application/json'}),'artworks.json');
  } else if (fmt === 'csv') {
    const h = ['作品名稱','藝術家','年份','媒材','載體','尺寸(cm)','作品說明','內部備註',
               '委賣人','電話','信箱','位置','位置備註','委賣合約','簽署日期','到期日','合約備註',
               '賣方實拿(NTD)','藝廊售價(NTD)','狀態'];
    const r = list.map(a=>[a.title,a.artist,a.year||'',MEDIA_LABEL[a.media]||'',a.support||'',
      fmtSize(a.w,a.h,a.d),a.note||'',a.internalNote||'',a.consignor,a.phone||'',a.email||'',
      LOC_LABEL[a.location]||'藝廊',a.locationNote||'',a.contractSigned?'已簽約':'未簽約',
      a.contractDate||'',a.contractExpiry||'',a.contractNote||'',
      a.netPrice||'',a.offerPrice||'',ART_STATUS_LABEL[a.status||'new']]);
    dlBlob(makeCSV([h,...r]),'artworks_internal.csv');
  } else if (fmt === 'client_csv') {
    const h = ['作品名稱','藝術家','年份','媒材','載體','尺寸(cm)','作品說明','位置','藝廊售價(NTD)','狀態'];
    const r = list.map(a=>[a.title,a.artist,a.year||'',MEDIA_LABEL[a.media]||'',a.support||'',
      fmtSize(a.w,a.h,a.d),a.note||'',LOC_LABEL[a.location]||'藝廊',a.offerPrice||'',ART_STATUS_LABEL[a.status||'new']]);
    dlBlob(makeCSV([h,...r]),'artwork_list_client.csv');
  } else if (fmt === 'collector_html') {
    dlBlob(new Blob([buildCollectorHTML(list)],{type:'text/html;charset=utf-8'}),'artwork_collection.html');
  }
  document.getElementById('exportOverlay').classList.remove('open');
}

function makeCSV(rows) {
  const csv = rows.map(r=>r.map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  return new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
}

function dlBlob(blob,name) {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}

function buildCollectorHTML(list) {
  const date = new Date().toLocaleDateString('zh-TW',{year:'numeric',month:'long',day:'numeric'});
  const cards = list.map(a=>{
    const hq   = Array.isArray(a.hqImgs) ? a.hqImgs : [];
    const main = hq[0]
      ? `<img src="${hq[0]}" alt="${escHtml(a.title)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;border-radius:8px 8px 0 0">`
      : `<div style="width:100%;aspect-ratio:4/3;background:#f0ede8;display:flex;align-items:center;justify-content:center;border-radius:8px 8px 0 0;font-size:52px;color:#c8c0b8">${a.title[0]}</div>`;
    const thumbs = hq.slice(1).map(s=>`<img src="${s}" alt="" style="width:62px;height:62px;object-fit:cover;border-radius:4px">`).join('');
    const media  = [MEDIA_LABEL[a.media],a.support].filter(Boolean).join('，');
    const size   = fmtSize(a.w,a.h,a.d);
    const price  = a.offerPrice?`NT$ ${Number(a.offerPrice).toLocaleString()}`:'請洽藝廊';
    const col    = {new:'#3a5a8a',consign:'#3a7a6a',reserved:'#7a5c2a',sold:'#b04040'}[a.status]||'#3a5a8a';
    return `<article class="card">${main}${thumbs?`<div style="display:flex;gap:6px;padding:8px 14px 0;flex-wrap:wrap">${thumbs}</div>`:''}<div style="padding:16px"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px"><div><h2 style="font-size:16px;font-weight:600;color:#1a1814;line-height:1.3">${escHtml(a.title)}</h2><p style="font-size:13px;color:#6b6460;margin-top:2px">${escHtml(a.artist)}${a.year?'，'+a.year+' 年':''}</p></div><span style="flex-shrink:0;font-size:11px;padding:3px 10px;border-radius:20px;font-weight:500;background:${col}18;color:${col}">${ART_STATUS_LABEL[a.status||'new']}</span></div><table style="width:100%;font-size:12px;color:#4a4642;border-collapse:collapse;margin-bottom:14px">${media?`<tr><td style="padding:3px 0;color:#8a8480;width:48px">媒材</td><td>${escHtml(media)}</td></tr>`:''}${size!=='—'?`<tr><td style="padding:3px 0;color:#8a8480">尺寸</td><td>${escHtml(size)} cm</td></tr>`:''}${a.note?`<tr><td style="padding:3px 0;color:#8a8480;vertical-align:top">說明</td><td style="line-height:1.6">${escHtml(a.note)}</td></tr>`:''}</table><div style="border-top:1px solid #f0ede8;padding-top:12px;display:flex;align-items:center;justify-content:space-between"><span style="font-size:12px;color:#8a8480">藝廊售價</span><span style="font-size:20px;font-weight:700;color:#3a5a8a">${price}</span></div></div></article>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>藝術作品精選 — Artemin Gallery</title><link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500&family=Noto+Sans+TC:wght@300;400;500&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Noto Sans TC',sans-serif;background:#faf8f4;color:#1a1814;padding:48px 24px}.header{text-align:center;margin-bottom:48px}.header .logo{font-family:'Noto Serif TC',serif;font-size:12px;letter-spacing:.14em;color:#b8924a;margin-bottom:10px}.header h1{font-family:'Noto Serif TC',serif;font-size:28px;font-weight:400;letter-spacing:.06em;margin-bottom:8px}.header p{font-size:13px;color:#8a8480}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px;max-width:1100px;margin:0 auto}.card{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(26,24,20,.08)}.footer{text-align:center;margin-top:48px;font-size:12px;color:#b8b0a8;letter-spacing:.05em}@media print{body{background:#fff;padding:20px}.card{box-shadow:none!important;border:1px solid #e8e4da}}@media(max-width:600px){body{padding:24px 12px}.grid{grid-template-columns:1fr}}</style></head><body><header class="header"><div class="logo">ARTEMIN GALLERY</div><h1>藝術作品精選</h1><p>${date}　·　共 ${list.length} 件作品</p></header><main class="grid">${cards}</main><footer class="footer">如需洽詢，請聯繫藝廊　·　本清單僅供參考</footer></body></html>`;
}
