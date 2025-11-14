function getQuery() {
  const q = new URLSearchParams(location.search);
  return { id: q.get('id'), url: q.get('url'), address: q.get('address'), title: q.get('title') };
}

const state = {
  list: [],
  index: -1,
};

const roomTitleEl = document.getElementById('roomTitle');
const videoEl = document.getElementById('video');
const listEl = document.getElementById('list');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const favBtn = document.getElementById('favBtn');
const blkBtn = document.getElementById('blkBtn');
const dlBtn = document.getElementById('dlBtn');
const copyBtn = document.getElementById('copyBtn');

let player = null;
let retryCount = 0;
const maxRetry = 5;

function isHttp(u) { try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; } catch (_) { return false; } }
function isRtmp(u) { try { const p = new URL(u); return p.protocol === 'rtmp:'; } catch (_) { return /^rtmp:\/\//i.test(String(u||'')); } }

function setup(src) {
  if (!flvjs.isSupported()) {
    videoEl.outerHTML = '<p>当前浏览器不支持 flv.js</p>';
    return;
  }
  if (player) { try { player.unload(); player.detachMediaElement(); player.destroy(); } catch (_) {} player = null; }
  player = flvjs.createPlayer({ type: 'flv', url: src, isLive: true, enableWorker: true });
  player.attachMediaElement(videoEl);
  player.on(flvjs.Events.ERROR, function() {
    if (retryCount < maxRetry) {
      const delay = Math.min(3000, 500 * Math.pow(2, retryCount));
      retryCount++;
      setTimeout(() => { setup(src); }, delay);
    }
  });
  player.load();
  try { player.play(); } catch (_) {}
}

function computeSrc(item) {
  if (!item) return '';
  const address = item.address || '';
  if (isHttp(address)) return `/proxy?url=${encodeURIComponent(address)}`;
  if (isRtmp(address)) return `/proxy-rtmp?url=${encodeURIComponent(address)}`;
  return '';
}

function renderList() {
  listEl.innerHTML = '';
  state.list.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'item' + (i === state.index ? ' active' : '');
    div.textContent = c.title || c.address || '未命名';
    div.dataset.index = String(i);
    listEl.appendChild(div);
  });
}

function setCurrent(i) {
  if (i < 0 || i >= state.list.length) return;
  state.index = i;
  const item = state.list[i];
  roomTitleEl.textContent = item.title || '播放';
  renderList();
  const src = computeSrc(item);
  if (src) setup(src);
  updateOps(item);
}

function updateOps(item) {
  const t = item && item.title ? item.title : '';
  favBtn.disabled = !t;
  blkBtn.disabled = !t;
}

async function loadFavorites() {
  try {
    const r = await fetch('/channels/favorites');
    const d = await r.json();
    const items = (Array.isArray(d.items) ? d.items : []).filter((c) => c && (c.address || c.title));
    state.list = items;
  } catch (_) {
    state.list = [];
  }
}

function findIndexByQuery(q) {
  const { address, title } = q;
  if (!state.list || state.list.length === 0) return -1;
  let idx = -1;
  if (title) idx = state.list.findIndex((c) => (c.title || '') === title);
  if (idx < 0 && address) idx = state.list.findIndex((c) => (c.address || '') === address);
  return idx;
}

async function bootstrap() {
  const q = getQuery();
  await loadFavorites();
  const idx = findIndexByQuery(q);
  renderList();
  if (idx >= 0) {
    setCurrent(idx);
  } else {
    roomTitleEl.textContent = q.title || '播放';
    const src0 = (() => {
      if (q.id) return `/play/${encodeURIComponent(q.id)}`;
      const src = q.url || q.address || '';
      if (isHttp(src)) return `/proxy?url=${encodeURIComponent(src)}`;
      if (isRtmp(src)) return `/proxy-rtmp?url=${encodeURIComponent(src)}`;
      return '';
    })();
    if (src0) setup(src0);
    favBtn.disabled = !q.title;
    blkBtn.disabled = !q.title;
  }
}

prevBtn.onclick = () => {
  if (state.list.length === 0) return;
  const i = state.index <= 0 ? state.list.length - 1 : state.index - 1;
  setCurrent(i);
};
nextBtn.onclick = () => {
  if (state.list.length === 0) return;
  const i = state.index >= state.list.length - 1 ? 0 : state.index + 1;
  setCurrent(i);
};

listEl.onclick = (e) => {
  const item = e.target.closest('.item');
  if (!item) return;
  const i = parseInt(item.dataset.index || '-1', 10);
  if (i >= 0) setCurrent(i);
};

favBtn.onclick = async () => {
  const curr = state.list[state.index];
  const t = curr && curr.title ? curr.title : (getQuery().title || '');
  const src = curr && curr.address ? curr.address : (getQuery().url || getQuery().address || '');
  if (!t) return alert('缺少标题，无法收藏');
  await fetch('/channel/favorite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t, address: src, favorite: 1 }) });
  alert('已收藏');
};
blkBtn.onclick = async () => {
  const curr = state.list[state.index];
  const t = curr && curr.title ? curr.title : (getQuery().title || '');
  if (!t) return alert('缺少标题，无法屏蔽');
  await fetch('/channel/blocked', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t, blocked: 1 }) });
  alert('已屏蔽');
};
dlBtn.onclick = async () => {
  const curr = state.list[state.index];
  const src = curr && curr.address ? curr.address : (getQuery().url || getQuery().address || '');
  if (!isHttp(src)) {
    if (isRtmp(src)) return alert('当前不支持 rtmp 下载，仅支持 http/https');
    return alert('仅支持 http/https 地址下载');
  }
  const t = (curr && curr.title) || getQuery().title || '视频';
  const r = await fetch('/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t, url: src }) });
  if (r.ok) alert('已提交下载'); else alert('下载提交失败');
};
copyBtn.onclick = async () => {
  const curr = state.list[state.index];
  const src = curr && curr.address ? curr.address : (getQuery().url || getQuery().address || '');
  try { await navigator.clipboard.writeText(src); alert('已复制'); } catch (_) { alert('复制失败'); }
};

bootstrap();

