// 顶部：增加轮询控制
const routes = {
  home: 'homeView',
  explore: 'exploreView',
  downloads: 'downloadView',
  settings: 'settingsView',
};

const __origFetch = window.fetch.bind(window);
window.fetch = async function() {
  const res = await __origFetch.apply(window, arguments);
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('unauthorized');
  }
  const ct = res.headers.get('content-type') || '';
  try {
    const u = new URL(res.url, location.origin);
    const isLogin = u.pathname === '/login' || u.pathname === '/login.html';
    if (ct.includes('text/html') && !isLogin) {
      location.href = '/login';
      throw new Error('unauthorized');
    }
  } catch (_) {}
  return res;
};

function setActiveMenu(hash) {
  document.querySelectorAll('.menu-item').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === hash);
  });
}

function showView(name) {
  Object.values(routes).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const id = routes[name] || routes.downloads;
  const el = document.getElementById(id);
  if (el) el.style.display = '';
  if (name === 'downloads') {
    refreshAll();
    startTasksPoll();
    if (homeFavoritesTimer) { clearInterval(homeFavoritesTimer); homeFavoritesTimer = null; }
  } else if (name === 'settings') {
    loadSettings();
    if (homeFavoritesTimer) { clearInterval(homeFavoritesTimer); homeFavoritesTimer = null; }
  } else if (name === 'explore') {
    loadExplore();
    if (homeFavoritesTimer) { clearInterval(homeFavoritesTimer); homeFavoritesTimer = null; }
  } else if (name === 'home') {
    loadHomeFavorites();
    startHomeFavoritesPoll();
    setupSchedulerToggle();
  }
}

function startHomeFavoritesPoll() {
  try {
    fetch('/config/poll_interval_minutes')
      .then((r) => r.json())
      .then((d) => {
        const n = (d && d.value) ? parseInt(d.value, 10) : 1;
        const ms = Math.max(1, n) * 60 * 1000;
        if (homeFavoritesTimer) clearInterval(homeFavoritesTimer);
        homeFavoritesTimer = setInterval(loadHomeFavorites, ms);
      })
      .catch(() => {});
  } catch (_) {}
}

function router() {
  const h = location.hash || '#/home';
  setActiveMenu(h);
  const name = h.replace('#/', '') || 'home';
  showView(name);
}

window.addEventListener('hashchange', router);
const state = { tasks: { page: 1, pageSize: 10, total: 0 } };
let tasksPollTimer = null;
let POLL_MS = 10000;
let homeFavoritesTimer = null;

// 平台标题缓存（address -> title）
const platformTitleMap = new Map();

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const STATUS_MAP = { downloading: '下载中', completed: '已完成', cancelled: '已取消', error: '失败' };

async function fetchAllTasks() {
  const { page, pageSize } = state.tasks;
  const res = await fetch(`/tasks?page=${page}&pageSize=${pageSize}`);
  const data = await res.json();
  if (!data.ok) return { items: [], total: 0 };
  state.tasks.total = data.total;
  return data;
}

function renderAllList(items) {
  const listEl = document.getElementById('taskList');
  listEl.innerHTML = '';
  items.forEach((t) => {
    const tr = document.createElement('tr');
    tr.className = 'is-' + (t.status || '');
    const url = String(t.url || '').trim().replace(/^`|`$/g, '');
    const urlText = url.length > 60 ? (url.slice(0, 57) + '...') : url;
    const statusText = STATUS_MAP[t.status] || (t.status || '');
    const ops = (t.status === 'downloading')
      ? `<button data-op="play" data-url="${encodeURIComponent(url)}">播放</button>
         <button data-op="cancel" data-id="${t.id}" data-title="${t.title}">取消</button>`
      : `<button data-op="play-completed" data-id="${t.id}" ${t.file_path ? '' : 'disabled'}>播放</button>
         <button data-op="delete" data-id="${t.id}">删除</button>`;
    tr.innerHTML = `
      <td class="title">${t.id}</td>
      <td>${t.title}</td>
      <td title="${url}">${urlText}</td>
      <td class="meta">${fmtTime(t.created_at)}</td>
      <td><span class="badge ${t.status}">${statusText}</span></td>
      <td class="ops">${ops}</td>
    `;
    listEl.appendChild(tr);
  });

  // 稳定事件委托（避免 { once: true } 导致后续点击失效）
  listEl.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.op === 'play') {
      const url = decodeURIComponent(btn.dataset.url);
      window.open(`/player.html?url=${encodeURIComponent(url)}`, '_blank');
    } else if (btn.dataset.op === 'cancel') {
      const id = btn.dataset.id;
      const title = btn.dataset.title;
      btn.disabled = true;
      try {
        await fetch('/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(id ? { id } : { title }),
        });
        await refreshAll();
      } finally {
        btn.disabled = false;
      }
    } else if (btn.dataset.op === 'play-completed') {
      const id = btn.dataset.id;
      window.open(`/player.html?id=${encodeURIComponent(id)}`, '_blank');
    } else if (btn.dataset.op === 'delete') {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await fetch('/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        await refreshAll();
      } finally {
        btn.disabled = false;
      }
    }
  };
}

function renderAllPager() {
  const s = state.tasks;
  const maxPage = Math.max(1, Math.ceil(s.total / s.pageSize));
  s.page = Math.min(s.page, maxPage);

  const infoEl = document.getElementById('taskInfo');
  const prevEl = document.getElementById('taskPrev');
  const nextEl = document.getElementById('taskNext');

  infoEl.textContent = `第 ${s.page} / ${maxPage} 页，共 ${s.total} 条`;
  prevEl.disabled = s.page <= 1;
  nextEl.disabled = s.page >= maxPage;

  prevEl.onclick = async () => {
    if (s.page > 1) {
      s.page -= 1;
      await refreshAll();
    }
  };
  nextEl.onclick = async () => {
    if (s.page < maxPage) {
      s.page += 1;
      await refreshAll();
    }
  };
}

async function refreshAll() {
  const { items } = await fetchAllTasks();
  renderAllList(items);
  renderAllPager();
}

// 启动/暂停任务列表的自动轮询（标签页不可见时暂停）
function startTasksPoll() {
  if (tasksPollTimer) clearInterval(tasksPollTimer);
  const tick = () => refreshAll();

  // 仅在页面可见时轮询
  const setup = () => {
    if (document.visibilityState === 'visible') {
      tick();
      tasksPollTimer = setInterval(tick, POLL_MS);
    } else {
      if (tasksPollTimer) clearInterval(tasksPollTimer);
      tasksPollTimer = null;
    }
  };

  document.removeEventListener('visibilitychange', setup);
  document.addEventListener('visibilitychange', setup);
  setup();
}

document.getElementById('downloadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const url = document.getElementById('url').value.trim();
  if (!title || !url) return;

  const res = await fetch('/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, url }),
  });
  if (!res.ok) {
    let msg = '下载任务提交失败';
    try { const data = await res.json(); if (data?.message) msg = data.message; } catch (_) {}
    alert(msg);
    return;
  }

  document.getElementById('url').value = '';
  await refreshAll();
});

// 新增：解析文本下载，不影响原表单
document.getElementById('parseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('parseText').value.trim();
  if (!text) return;

  const res = await fetch('/download/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: text,
  });
  if (!res.ok) {
    let msg = '解析或下载启动失败';
    try { const data = await res.json(); if (data?.message) msg = data.message; } catch (_) {}
    alert(msg);
    return;
  }

  document.getElementById('parseText').value = '';
  await refreshAll();
});

async function loadSettings() {
  try {
    const r = await fetch('/config/explore_base_url');
    const d = await r.json();
    document.getElementById('baseUrlInput').value = d?.value || '';
  } catch (_) {}
  try {
    const r2 = await fetch('/config/poll_interval_minutes');
    const d2 = await r2.json();
    const minutes = parseInt(String(d2?.value || '1'), 10);
    document.getElementById('intervalInput').value = minutes;
  } catch (_) {}
}

async function setupSchedulerToggle() {
  const btn = document.getElementById('schedulerToggleBtn');
  if (!btn) return;
  btn.disabled = true;
  try {
    const r = await fetch('/scheduler/enabled');
    const d = await r.json();
    const on = !!(d && d.value);
    btn.textContent = '定时任务：' + (on ? '已开启' : '已关闭');
    btn.dataset.on = on ? '1' : '0';
  } catch (_) {}
  btn.disabled = false;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const next = btn.dataset.on === '1' ? 0 : 1;
      const r = await fetch('/scheduler/enabled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: next })
      });
      const d = await r.json();
      const on = !!(d && d.value);
      btn.textContent = '定时任务：' + (on ? '已开启' : '已关闭');
      btn.dataset.on = on ? '1' : '0';
    } catch (_) {}
    btn.disabled = false;
  };

  const manualBtn = document.getElementById('manualUpdateBtn');
  if (manualBtn) {
    manualBtn.onclick = async () => {
      manualBtn.disabled = true;
      try {
        const r = await fetch('/scheduler/manual_update', { method: 'POST' });
        const d = await r.json();
        if (d && d.ok) {
          const n = typeof d.created === 'number' ? d.created : 0;
          alert('已刷新并提交下载 ' + n + ' 条');
          try { await loadHomeFavorites(); } catch (_) {}
        } else {
          alert('刷新失败');
        }
      } catch (_) { alert('刷新失败'); }
      manualBtn.disabled = false;
    };
  }
}

document.getElementById('saveBaseUrl').addEventListener('click', async () => {
  const v = document.getElementById('baseUrlInput').value.trim();
  const r = await fetch('/config/explore_base_url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: v }),
  });
  if (r.ok) alert('已保存');
});

document.getElementById('saveInterval').addEventListener('click', async () => {
  const v = parseInt(document.getElementById('intervalInput').value.trim() || '1', 10);
  const n = isNaN(v) ? 1 : Math.max(1, Math.min(60, v));
  const r = await fetch('/config/poll_interval_minutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: n }),
  });
  if (r.ok) alert('已保存');
});

function addListItem(container, key, text) {
  const isTableBody = container && container.tagName === 'TBODY';
  const items = Array.from(container.querySelectorAll(isTableBody ? 'tr' : 'li'));
  const exist = items.find((el) => el.dataset && el.dataset.key === key);
  const id = container && container.id ? container.id : '';
  let meta = '';
  if (id === 'favPlatforms' || id === 'blkPlatforms') {
    meta = '平台';
  } else if (id === 'favChannels' || id === 'blkChannels') {
    meta = '';
  }

  if (isTableBody) {
    const opBtn = (() => {
      if (id === 'favPlatforms') return `<button data-op="removeFavPlatform" data-address="${encodeURIComponent(key)}">移除</button>`;
      if (id === 'blkPlatforms') return `<button data-op="removeBlkPlatform" data-address="${encodeURIComponent(key)}">移除</button>`;
      if (id === 'favChannels') return `<button data-op="removeFavChannel" data-title="${encodeURIComponent(key)}">移除</button>`;
      if (id === 'blkChannels') return `<button data-op="removeBlkChannel" data-title="${encodeURIComponent(key)}">移除</button>`;
      return '';
    })();
    const html = `<td class="title">${text}</td><td class="meta">${meta}</td><td class="ops">${opBtn}</td>`;
    if (exist) { exist.innerHTML = html; return; }
    const tr = document.createElement('tr');
    tr.dataset.key = key;
    tr.innerHTML = html;
    container.appendChild(tr);
  } else {
    const opBtn = (() => {
      if (id === 'favPlatforms') return `<button data-op="removeFavPlatform" data-address="${encodeURIComponent(key)}">移除</button>`;
      if (id === 'blkPlatforms') return `<button data-op="removeBlkPlatform" data-address="${encodeURIComponent(key)}">移除</button>`;
      if (id === 'favChannels') return `<button data-op="removeFavChannel" data-title="${encodeURIComponent(key)}">移除</button>`;
      if (id === 'blkChannels') return `<button data-op="removeBlkChannel" data-title="${encodeURIComponent(key)}">移除</button>`;
      return '';
    })();
    const html = `<div class="row"><div class="title">${text}</div><div class="meta">${meta}</div><div class="ops">${opBtn}</div></div>`;
    if (exist) { exist.innerHTML = html; return; }
    const li = document.createElement('li');
    li.dataset.key = key;
    li.innerHTML = html;
    container.appendChild(li);
  }
}

function removeListItem(container, key) {
  const items = Array.from(container.querySelectorAll(container.tagName === 'TBODY' ? 'tr' : 'li'));
  const target = items.find((el) => el.dataset && el.dataset.key === key);
  if (target) target.remove();
}

function renderBatch(items, create, container, batchSize = 50) {
  let i = 0;
  function step() {
    const frag = document.createDocumentFragment();
    for (let n = 0; n < batchSize && i < items.length; n++, i++) {
      frag.appendChild(create(items[i]));
    }
    container.appendChild(frag);
    if (i < items.length) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function loadExplore() {
  const listEl = document.getElementById('exploreList');
  const favP = document.getElementById('favPlatforms');
  const blkP = document.getElementById('blkPlatforms');
  const favC = document.getElementById('favChannels');
  const blkC = document.getElementById('blkChannels');
  const bc = document.getElementById('exploreBreadcrumb');
  listEl.innerHTML = '';
  favP.innerHTML = '';
  blkP.innerHTML = '';
  favC.innerHTML = '';
  blkC.innerHTML = '';
  bc.innerHTML = '平台列表 <button class="back-btn" data-op="sync">同步平台</button>';
  bc.onclick = async (e) => {
    const btn = e.target.closest('[data-op="sync"]');
    if (btn) {
      btn.disabled = true;
      try {
        const r = await fetch('/platforms/sync', { method: 'POST' });
        if (!r.ok) { try { const d = await r.json(); alert(d.message || '同步失败'); } catch (_) { alert('同步失败'); } }
        await loadExplore();
      } finally { btn.disabled = false; }
    }
  };

  const r = await fetch('/platforms');
  const d = await r.json();
  const items = Array.isArray(d.items) ? d.items : [];
  const platformMap = new Map();

  function createPlatformCard(p) {
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.dataset.address = p.address;
    card.innerHTML = `
      <div class="card-row">
        <div class="thumb">${p.xinimg ? `<img src="${p.xinimg}" alt="" loading="lazy">` : ''}</div>
        <div>
          <div class="card-title">${p.title || p.address}</div>
          <div class="card-meta">数量：${p.number || 0}</div>
          <div class="card-ops">
            <button class="icon-btn icon-heart ${p.favorite ? 'active' : ''}" title="收藏" data-op="fav" data-address="${encodeURIComponent(p.address)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.3-9.3-7.5C1.6 12.3 1 10.9 1 9.4 1 6.5 3.4 4 6.3 4c1.7 0 3.3.8 4.3 2.1C11.4 4.8 13 4 14.7 4 17.6 4 20 6.5 20 9.4c0 1.5-.6 2.9-1.7 4.1C18.7 16.7 12 21 12 21z"></path></svg>
            </button>
            <button class="icon-btn icon-block ${p.blocked ? 'active' : ''}" title="屏蔽" data-op="blk" data-address="${encodeURIComponent(p.address)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><line x1="7" y1="17" x2="17" y2="7"></line></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    return card;
  }

  items.forEach((p) => { platformTitleMap.set(p.address, p.title || p.address); platformMap.set(p.address, p); });
  renderBatch(items, createPlatformCard, listEl, 60);

  listEl.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (btn) {
      const address = decodeURIComponent(btn.dataset.address || '');
      const card = btn.closest('.card');
      if (btn.dataset.op === 'fav') {
        const next = btn.classList.contains('active') ? 0 : 1;
        const r = await fetch(`/platform/${encodeURIComponent(address)}/favorite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorite: next }),
        });
        if (r.ok) {
          btn.classList.toggle('active', next === 1);
          const titleEl = card && card.querySelector('.card-title');
          const text = titleEl ? titleEl.textContent : address;
          if (next === 1) addListItem(favP, address, text); else removeListItem(favP, address);
        }
      } else if (btn.dataset.op === 'blk') {
        const next = btn.classList.contains('active') ? 0 : 1;
        const r = await fetch(`/platform/${encodeURIComponent(address)}/blocked`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocked: next }),
        });
        if (r.ok) {
          btn.classList.toggle('active', next === 1);
          const titleEl = card && card.querySelector('.card-title');
          const text = titleEl ? titleEl.textContent : address;
          if (next === 1) addListItem(blkP, address, text); else removeListItem(blkP, address);
          if (next === 1) {
            removeListItem(favP, address);
            const heart = card && card.querySelector('.icon-heart');
            if (heart) heart.classList.remove('active');
          }
          if (next === 1 && card) card.remove();
        }
      }
      return;
    }
    const card = e.target.closest('.card');
    if (card && card.dataset.address) {
      const titleEl = card.querySelector('.card-title');
      const title = titleEl ? titleEl.textContent : (platformTitleMap.get(card.dataset.address) || card.dataset.address);
      await loadChannel(card.dataset.address, title);
    }
  };

  (d.favorites || []).forEach((p) => {
    addListItem(favP, p.address, p.title || p.address);
  });
  (d.blocks || []).forEach((p) => {
    addListItem(blkP, p.address, p.title || p.address);
  });

  // 在平台列表页加载全局收藏/屏蔽的频道清单
  try {
    const rFavC = await fetch('/channels/favorites');
    const dFavC = await rFavC.json();
    const favItems = Array.isArray(dFavC.items) ? dFavC.items : [];
    favItems.forEach((c) => {
      const key = c.title || '';
      addListItem(favC, key, c.title || c.address);
    });
  } catch (_) {}
  try {
    const rBlkC = await fetch('/channels/blocked');
    const dBlkC = await rBlkC.json();
    const blkItems = Array.isArray(dBlkC.items) ? dBlkC.items : [];
    blkItems.forEach((c) => {
      const key = c.title || '';
      addListItem(blkC, key, c.title || c.address);
    });
  } catch (_) {}

  favP.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.op === 'removeFavPlatform') {
      const address = decodeURIComponent(btn.dataset.address || '');
      const r = await fetch(`/platform/${encodeURIComponent(address)}/favorite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: 0 }),
      });
      if (r.ok) {
        removeListItem(favP, address);
        const card = Array.from(listEl.querySelectorAll('.card')).find((el) => el.dataset.address === address);
        if (card) {
          const heart = card.querySelector('.icon-heart');
          if (heart) heart.classList.remove('active');
        }
      }
    }
  };

  blkP.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.op === 'removeBlkPlatform') {
      const address = decodeURIComponent(btn.dataset.address || '');
      const r = await fetch(`/platform/${encodeURIComponent(address)}/blocked`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocked: 0 }),
      });
      if (r.ok) {
        removeListItem(blkP, address);
        let card = Array.from(listEl.querySelectorAll('.card')).find((el) => el.dataset.address === address);
        if (card) {
          const blk = card.querySelector('.icon-block');
          if (blk) blk.classList.remove('active');
        } else {
          const p = platformMap.get(address);
          if (p) {
            const newCard = createPlatformCard(p);
            listEl.appendChild(newCard);
          }
        }
      }
    }
  };
}

async function loadChannel(address, platformTitle) {
  const listEl = document.getElementById('exploreList');
  const favC = document.getElementById('favChannels');
  const blkC = document.getElementById('blkChannels');
  const bc = document.getElementById('exploreBreadcrumb');
  listEl.innerHTML = '';
  favC.innerHTML = '';
  blkC.innerHTML = '';
  const title = platformTitle || platformTitleMap.get(address) || address;
  bc.innerHTML = `<button class="back-btn" data-op="back">⟵ 返回平台列表</button> 平台：${title}`;
  bc.onclick = (e) => {
    const btn = e.target.closest('[data-op="back"]');
    if (btn) {
      loadExplore();
    }
  };

  const r = await fetch(`/explore/channel?address=${encodeURIComponent(address)}`);
  const d = await r.json();
  const items = Array.isArray(d.items) ? d.items : [];
  const channelMap = new Map();
  const platformName = d.platform_title || title;
  platformTitleMap.set(address, platformName);
  bc.innerHTML = `<button class="back-btn" data-op="back">⟵ 返回平台列表</button> 平台：${platformName}`;

  function createChannelCard(c) {
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.dataset.address = c.address;
    card.dataset.title = c.title || '';
    card.innerHTML = `
      <div class="card-row">
        <div class="thumb">${c.img ? `<img src="${c.img}" alt="" loading="lazy">` : ''}</div>
        <div>
          <div class="card-title">${c.title || c.address}</div>
          <div class="card-meta">来源：${platformName}</div>
          <div class="card-ops">
            <button class="icon-btn icon-heart ${c.favorite ? 'active' : ''}" title="收藏" data-op="fav" data-address="${encodeURIComponent(c.address)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.3-9.3-7.5C1.6 12.3 1 10.9 1 9.4 1 6.5 3.4 4 6.3 4c1.7 0 3.3.8 4.3 2.1C11.4 4.8 13 4 14.7 4 17.6 4 20 6.5 20 9.4c0 1.5-.6 2.9-1.7 4.1C18.7 16.7 12 21 12 21z"></path></svg>
            </button>
            <button class="icon-btn icon-block ${c.blocked ? 'active' : ''}" title="屏蔽" data-op="blk" data-address="${encodeURIComponent(c.address)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><line x1="7" y1="17" x2="17" y2="7"></line></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    return card;
  }

  items.forEach((c) => { const key = c.platform_address + '|' + c.address; channelMap.set(key, c); });
  renderBatch(items, createChannelCard, listEl, 60);

  listEl.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (btn) {
      const ad = decodeURIComponent(btn.dataset.address || '');
      const card = btn.closest('.card');
      if (btn.dataset.op === 'fav') {
        const next = btn.classList.contains('active') ? 0 : 1;
        const r = await fetch('/channel/favorite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: card.dataset.title || '', address: ad, favorite: next }),
        });
        if (r.ok) {
          btn.classList.toggle('active', next === 1);
          const text = (card && card.dataset && card.dataset.title) ? card.dataset.title : ad;
          const key = text;
          if (next === 1) addListItem(favC, key, text); else removeListItem(favC, key);
        }
      } else if (btn.dataset.op === 'blk') {
        const next = btn.classList.contains('active') ? 0 : 1;
        const r = await fetch('/channel/blocked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: card.dataset.title || '', blocked: next }),
        });
        if (r.ok) {
          btn.classList.toggle('active', next === 1);
          const text = (card && card.dataset && card.dataset.title) ? card.dataset.title : ad;
          const key = text;
          if (next === 1) addListItem(blkC, key, text); else removeListItem(blkC, key);
          if (next === 1) {
            removeListItem(favC, key);
            const heart = card && card.querySelector('.icon-heart');
            if (heart) heart.classList.remove('active');
          }
          if (next === 1 && card) card.remove();
        }
      }
      return;
    }
    const card = e.target.closest('.card');
    if (card) {
      const ad = card.dataset.address;
      const title = card.dataset.title || '';
      window.open(`/player.html?platform=${encodeURIComponent(address)}&address=${encodeURIComponent(ad)}&title=${encodeURIComponent(title)}`, '_blank');
    }
  };

  (d.favorites || []).forEach((c) => {
    const key = c.title || '';
    addListItem(favC, key, c.title || c.address);
  });
  (d.blocks || []).forEach((c) => {
    const key = c.title || '';
    addListItem(blkC, key, c.title || c.address);
  });

  favC.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.op === 'removeFavChannel') {
      const title = btn.closest('tr,li')?.querySelector('.title')?.textContent || '';
      const r = await fetch('/channel/favorite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, favorite: 0 }),
      });
      if (r.ok) {
        removeListItem(favC, title);
        const card = Array.from(listEl.querySelectorAll('.card')).find((el) => (el.dataset.title || '') === title);
        if (card) {
          const heart = card.querySelector('.icon-heart');
          if (heart) heart.classList.remove('active');
        }
      }
    }
  };

  blkC.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.op === 'removeBlkChannel') {
      const title = btn.closest('tr,li')?.querySelector('.title')?.textContent || '';
      const r = await fetch('/channel/blocked', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, blocked: 0 }),
      });
      if (r.ok) {
        removeListItem(blkC, title);
        let card = Array.from(listEl.querySelectorAll('.card')).find((el) => (el.dataset.title || '') === title);
        if (card) {
          const blk = card.querySelector('.icon-block');
          if (blk) blk.classList.remove('active');
        } else {
          const c = Array.from(channelMap.values()).find(v => (v.title || '') === title);
          if (c) {
            const newCard = createChannelCard(c);
            listEl.appendChild(newCard);
          }
        }
      }
    }
  };
}

(function init() { router(); })();

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.onclick = async (e) => {
    e.preventDefault();
    try { await fetch('/auth/logout', { method: 'POST' }); } catch (_) {}
    location.href = '/login';
  };
}
async function loadHomeFavorites() {
  const wrap = document.getElementById('homeFavorites');
  if (!wrap) return;
  wrap.innerHTML = '';
  try {
    const r = await fetch('/channels/favorites');
    const d = await r.json();
    const items = (Array.isArray(d.items) ? d.items : []).filter((c) => c && c.address);
    items.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'card clickable';
      card.dataset.address = c.address || '';
      card.dataset.title = c.title || '';
      card.innerHTML = `
        <div class="card-row">
          <div class="thumb"></div>
          <div>
            <div class="card-title">${c.title || ''}</div>
            <div class="card-meta">收藏频道</div>
            <div class="card-ops">
              <button class="icon-btn icon-heart active" title="取消收藏" data-op="fav">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.3-9.3-7.5C1.6 12.3 1 10.9 1 9.4 1 6.5 3.4 4 6.3 4c1.7 0 3.3.8 4.3 2.1C11.4 4.8 13 4 14.7 4 17.6 4 20 6.5 20 9.4c0 1.5-.6 2.9-1.7 4.1C18.7 16.7 12 21 12 21z"></path></svg>
              </button>
              <button class="icon-btn icon-block" title="屏蔽" data-op="blk">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><line x1="7" y1="17" x2="17" y2="7"></line></svg>
              </button>
            </div>
          </div>
        </div>
      `;
      wrap.appendChild(card);
    });

    wrap.onclick = async (e) => {
      const btn = e.target.closest('button');
      if (btn) {
        const card = btn.closest('.card');
        const title = card?.dataset?.title || '';
        const address = card?.dataset?.address || '';
        if (btn.dataset.op === 'fav') {
          const r2 = await fetch('/channel/favorite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, favorite: 0 }) });
          if (r2.ok) card.remove();
          return;
        }
        if (btn.dataset.op === 'blk') {
          const r3 = await fetch('/channel/blocked', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, blocked: 1 }) });
          if (r3.ok) card.remove();
          return;
        }
      }
      const card = e.target.closest('.card');
      if (card) {
        const title = card.dataset.title || '';
        const address = card.dataset.address || '';
        if (address) window.open(`/player.html?address=${encodeURIComponent(address)}&title=${encodeURIComponent(title)}`, '_blank');
      }
    };
  } catch (_) {}
}
const savePwdBtn = document.getElementById('savePwd');
if (savePwdBtn) {
  savePwdBtn.addEventListener('click', async () => {
    const oldPwd = document.getElementById('oldPwd').value.trim();
    const newPwd = document.getElementById('newPwd').value.trim();
    const newPwd2 = document.getElementById('newPwd2').value.trim();
    const msgEl = document.getElementById('pwdMsg');
    if (!newPwd || newPwd.length < 8) { msgEl.textContent = '新密码长度至少 8 位'; return; }
    if (newPwd !== newPwd2) { msgEl.textContent = '两次输入不一致'; return; }
    msgEl.textContent = '';
    const r = await fetch('/auth/change_password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }) });
    if (r.ok) {
      alert('密码已更新');
      document.getElementById('oldPwd').value = '';
      document.getElementById('newPwd').value = '';
      document.getElementById('newPwd2').value = '';
    } else {
      let d = { message: '修改失败' };
      try { d = await r.json(); } catch (_) {}
      msgEl.textContent = d.message || '修改失败';
    }
  });
}