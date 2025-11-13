// 顶部：增加轮询控制
const state = {
  downloading: { page: 1, pageSize: 10, total: 0 },
  completed: { page: 1, pageSize: 10, total: 0 },
};
let downloadingPollTimer = null;
const POLL_MS = 3000;

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

(async function init() {
  await refresh('downloading');
  await refresh('completed');
  startDownloadingPoll();
})();