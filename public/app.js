const state = {
  downloading: { page: 1, pageSize: 5, total: 0 },
  completed: { page: 1, pageSize: 5, total: 0 },
};

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
             <button data-op="cancel" data-title="${t.title}">取消</button>`
          : `<button data-op="play-completed" data-id="${t.id}">播放</button>
             <button data-op="delete" data-id="${t.id}">删除</button>`}
      </div>
    `;
    listEl.appendChild(li);
  });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.op === 'play') {
      const url = decodeURIComponent(btn.dataset.url);
      window.open(`/player.html?url=${encodeURIComponent(url)}`, '_blank');
    } else if (btn.dataset.op === 'cancel') {
      const title = btn.dataset.title;
      await fetch('/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      await refresh('downloading');
    } else if (btn.dataset.op === 'play-completed') {
      const id = btn.dataset.id;
      window.open(`/player.html?id=${encodeURIComponent(id)}`, '_blank');
    } else if (btn.dataset.op === 'delete') {
      const id = btn.dataset.id;
      await fetch('/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await refresh('completed');
    }
  }, { once: true });
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

document.getElementById('downloadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const url = document.getElementById('url').value.trim();
  if (!title || !url) return;

  await fetch('/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, url }),
  });

  document.getElementById('url').value = '';
  await refresh('downloading');
});

(async function init() {
  await refresh('downloading');
  await refresh('completed');
})();