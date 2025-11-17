let favSet = new Set();
let blkSet = new Set();

function init(db) {
  try {
    favSet = new Set((db.listChannelFavorites() || []).map((c) => String(c.title || '')));
    blkSet = new Set((db.listChannelBlocked() || []).map((c) => String(c.title || '')));
  } catch (_) {
    favSet = new Set();
    blkSet = new Set();
  }
}

function setFavorite(title, flag) {
  const t = String(title || '').trim();
  if (!t) return;
  if (flag) {
    favSet.add(t);
    blkSet.delete(t);
  } else {
    favSet.delete(t);
  }
}

function setBlocked(title, flag) {
  const t = String(title || '').trim();
  if (!t) return;
  if (flag) {
    blkSet.add(t);
    favSet.delete(t);
  } else {
    blkSet.delete(t);
  }
}

function getFavSet() { return favSet; }
function getBlkSet() { return blkSet; }

module.exports = { init, setFavorite, setBlocked, getFavSet, getBlkSet };