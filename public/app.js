// 顶部：增加轮询控制
const routes = {
  home: 'homeView',
  explore: 'exploreView',
  downloads: 'downloadView',
  settings: 'settingsView',
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
    refresh('downloading');
    refresh('completed');
    startDownloadingPoll();
  } else if (name === 'settings') {
    loadSettings();
  } else if (name === 'explore') {
    loadExplore();
  }
}

function router() {
  const h = location.hash || '#/downloads';
  setActiveMenu(h);
  const name = h.replace('#/', '') || 'downloads';
  showView(name);
}

window.addEventListener('hashchange', router);
const state = {
  downloading: { page: 1, pageSize: 10, total: 0 },
  completed: { page: 1, pageSize: 10, total: 0 },
};
let downloadingPollTimer = null;
let POLL_MS = 10000;

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function fetchTasks(status) {
  const { page, pageSize } = state[status];
  const res = await fetch(`/tasks?status=${status}&page=${page}&pageSize=${pageSize}`);
  const data = await res.json();
  if (!data.ok) return { items: [], total: 0 };
  state[status].total = data.total;
  return data;
}

function renderList(status, items) {
  const listEl = document.getElementById(status === 'downloading' ? 'downloadingList' : 'completedList');
  listEl.innerHTML = '';
  items.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'row';
    li.innerHTML = `
      <div class="title">${t.title}</div>
      <div class="meta">${fmtTime(t.created_at)}</div>
      <div class="ops">
        ${status === 'downloading'
          ? `<button data-op="play" data-url="${encodeURIComponent(t.url)}">播放</button>
             <button data-op="cancel" data-id="${t.id}" data-title="${t.title}">取消</button>`
          : `<button data-op="play-completed" data-id="${t.id}">播放</button>
             <button data-op="delete" data-id="${t.id}">删除</button>`}
      </div>
    `;
    listEl.appendChild(li);
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
        await refresh('downloading'); // 取消后立即刷新下载中列表
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
        await refresh('completed');
      } finally {
        btn.disabled = false;
      }
    }
  };
}

function renderPager(status) {
  const s = state[status];
  const maxPage = Math.max(1, Math.ceil(s.total / s.pageSize));
  s.page = Math.min(s.page, maxPage);

  const infoEl = document.getElementById(status === 'downloading' ? 'downInfo' : 'compInfo');
  const prevEl = document.getElementById(status === 'downloading' ? 'downPrev' : 'compPrev');
  const nextEl = document.getElementById(status === 'downloading' ? 'downNext' : 'compNext');

  infoEl.textContent = `第 ${s.page} / ${maxPage} 页，共 ${s.total} 条`;
  prevEl.disabled = s.page <= 1;
  nextEl.disabled = s.page >= maxPage;

  prevEl.onclick = async () => {
    if (s.page > 1) {
      s.page -= 1;
      await refresh(status);
    }
  };
  nextEl.onclick = async () => {
    if (s.page < maxPage) {
      s.page += 1;
      await refresh(status);
    }
  };
}

async function refresh(status) {
  const { items } = await fetchTasks(status);
  renderList(status, items);
  renderPager(status);
}

// 启动/暂停“下载中”列表的自动轮询（标签页不可见时暂停）
function startDownloadingPoll() {
  if (downloadingPollTimer) clearInterval(downloadingPollTimer);
  const tick = () => refresh('downloading');

  // 仅在页面可见时轮询
  const setup = () => {
    if (document.visibilityState === 'visible') {
      tick(); // 切回可见时先立即刷新一次
      downloadingPollTimer = setInterval(tick, POLL_MS);
    } else {
      if (downloadingPollTimer) clearInterval(downloadingPollTimer);
      downloadingPollTimer = null;
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
  await refresh('downloading');
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
  await refresh('downloading');
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
    const pa = String(key).split('|')[0] || '';
    meta = `来源：${pa}`;
  }

  if (isTableBody) {
    const opBtn = (() => {
      if (id === 'favPlatforms') return `<button data-op="removeFavPlatform" data-address="${encodeURIComponent(key)}">移除</button>`;
      if (id === 'blkPlatforms') return `<button data-op="removeBlkPlatform" data-address="${encodeURIComponent(key)}">移除</button>`;
      if (id === 'favChannels') return `<button data-op="removeFavChannel" data-platform="${encodeURIComponent(String(key).split('|')[0] || '')}" data-address="${encodeURIComponent(String(key).split('|')[1] || '')}">移除</button>`;
      if (id === 'blkChannels') return `<button data-op="removeBlkChannel" data-platform="${encodeURIComponent(String(key).split('|')[0] || '')}" data-address="${encodeURIComponent(String(key).split('|')[1] || '')}">移除</button>`;
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
      if (id === 'favChannels') return `<button data-op="removeFavChannel" data-platform="${encodeURIComponent(String(key).split('|')[0] || '')}" data-address="${encodeURIComponent(String(key).split('|')[1] || '')}">移除</button>`;
      if (id === 'blkChannels') return `<button data-op="removeBlkChannel" data-platform="${encodeURIComponent(String(key).split('|')[0] || '')}" data-address="${encodeURIComponent(String(key).split('|')[1] || '')}">移除</button>`;
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
  bc.textContent = '平台列表';

  const r = await fetch('/explore/platforms');
  const d = await r.json();
  const items = Array.isArray(d.items) ? d.items : [];
  const platformMap = new Map();

  function createPlatformCard(p) {
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.dataset.address = p.address;
    card.innerHTML = `
      <div class="card-row">
        <div class="thumb">${p.xinimg ? `<img src="${p.xinimg}" alt="">` : ''}</div>
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

  items.forEach((p) => {
    platformMap.set(p.address, p);
    const card = createPlatformCard(p);
    listEl.appendChild(card);
  });

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
      await loadChannel(card.dataset.address);
    }
  };

  (d.favorites || []).forEach((p) => {
    addListItem(favP, p.address, p.title || p.address);
  });
  (d.blocks || []).forEach((p) => {
    addListItem(blkP, p.address, p.title || p.address);
  });

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

async function loadChannel(address) {
  const listEl = document.getElementById('exploreList');
  const favC = document.getElementById('favChannels');
  const blkC = document.getElementById('blkChannels');
  const bc = document.getElementById('exploreBreadcrumb');
  listEl.innerHTML = '';
  favC.innerHTML = '';
  blkC.innerHTML = '';
  bc.textContent = `平台：${address}`;

  const r = await fetch(`/explore/channel?address=${encodeURIComponent(address)}`);
  const d = await r.json();
  const items = Array.isArray(d.items) ? d.items : [];
  const channelMap = new Map();

  function createChannelCard(c) {
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.dataset.platform = c.platform_address;
    card.dataset.address = c.address;
    card.dataset.title = c.title || '';
    card.innerHTML = `
      <div class="card-row">
        <div class="thumb">${c.img ? `<img src="${c.img}" alt="">` : ''}</div>
        <div>
          <div class="card-title">${c.title || c.address}</div>
          <div class="card-meta">来源：${c.platform_address}</div>
          <div class="card-ops">
            <button class="icon-btn icon-heart ${c.favorite ? 'active' : ''}" title="收藏" data-op="fav" data-platform="${encodeURIComponent(c.platform_address)}" data-address="${encodeURIComponent(c.address)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.3-9.3-7.5C1.6 12.3 1 10.9 1 9.4 1 6.5 3.4 4 6.3 4c1.7 0 3.3.8 4.3 2.1C11.4 4.8 13 4 14.7 4 17.6 4 20 6.5 20 9.4c0 1.5-.6 2.9-1.7 4.1C18.7 16.7 12 21 12 21z"></path></svg>
            </button>
            <button class="icon-btn icon-block ${c.blocked ? 'active' : ''}" title="屏蔽" data-op="blk" data-platform="${encodeURIComponent(c.platform_address)}" data-address="${encodeURIComponent(c.address)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><line x1="7" y1="17" x2="17" y2="7"></line></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    return card;
  }

  items.forEach((c) => {
    const key = c.platform_address + '|' + c.address;
    channelMap.set(key, c);
    const card = createChannelCard(c);
    listEl.appendChild(card);
  });

  listEl.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (btn) {
      const pa = decodeURIComponent(btn.dataset.platform || '');
      const ad = decodeURIComponent(btn.dataset.address || '');
      const card = btn.closest('.card');
      if (btn.dataset.op === 'fav') {
        const next = btn.classList.contains('active') ? 0 : 1;
        const r = await fetch('/channel/favorite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform_address: pa, address: ad, favorite: next }),
        });
        if (r.ok) {
          btn.classList.toggle('active', next === 1);
          const text = (card && card.dataset && card.dataset.title) ? card.dataset.title : ad;
          const key = pa + '|' + ad;
          if (next === 1) addListItem(favC, key, text); else removeListItem(favC, key);
        }
      } else if (btn.dataset.op === 'blk') {
        const next = btn.classList.contains('active') ? 0 : 1;
        const r = await fetch('/channel/blocked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform_address: pa, address: ad, blocked: next }),
        });
        if (r.ok) {
          btn.classList.toggle('active', next === 1);
          const text = (card && card.dataset && card.dataset.title) ? card.dataset.title : ad;
          const key = pa + '|' + ad;
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
      const pa = card.dataset.platform;
      const ad = card.dataset.address;
      const title = card.dataset.title || '';
      window.open(`/player.html?platform=${encodeURIComponent(pa)}&address=${encodeURIComponent(ad)}&title=${encodeURIComponent(title)}`, '_blank');
    }
  };

  (d.favorites || []).forEach((c) => {
    const key = c.platform_address + '|' + c.address;
    addListItem(favC, key, c.title || c.address);
  });
  (d.blocks || []).forEach((c) => {
    const key = c.platform_address + '|' + c.address;
    addListItem(blkC, key, c.title || c.address);
  });

  favC.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.op === 'removeFavChannel') {
      const pa = decodeURIComponent(btn.dataset.platform || '');
      const ad = decodeURIComponent(btn.dataset.address || '');
      const r = await fetch('/channel/favorite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform_address: pa, address: ad, favorite: 0 }),
      });
      if (r.ok) {
        removeListItem(favC, pa + '|' + ad);
        const card = Array.from(listEl.querySelectorAll('.card')).find((el) => el.dataset.platform === pa && el.dataset.address === ad);
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
      const pa = decodeURIComponent(btn.dataset.platform || '');
      const ad = decodeURIComponent(btn.dataset.address || '');
      const r = await fetch('/channel/blocked', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform_address: pa, address: ad, blocked: 0 }),
      });
      if (r.ok) {
        removeListItem(blkC, pa + '|' + ad);
        let card = Array.from(listEl.querySelectorAll('.card')).find((el) => el.dataset.platform === pa && el.dataset.address === ad);
        if (card) {
          const blk = card.querySelector('.icon-block');
          if (blk) blk.classList.remove('active');
        } else {
          const key = pa + '|' + ad;
          const c = channelMap.get(key);
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