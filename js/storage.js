window.MS = window.MS || {};

MS.esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

MS.playlistTitle = p =>
  p.title || '플레이리스트 (' + (p.id.length > 16 ? p.id.slice(0, 16) + '…' : p.id) + ')';

MS.store = (() => {
  const KEY = 'music-subtitle:v1';

  function blank() {
    return { version: 1, playlists: [], singles: [], videos: {} };
  }

  function loadLocal() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (!d || d.version !== 1) throw new Error('알 수 없는 데이터 버전');
      return d;
    } catch (err) {
      // 깨진 데이터는 백업 키로 옮겨두고 새로 시작 (사용자 작업물 유실 방지)
      localStorage.setItem(KEY + ':corrupt', raw);
      console.warn('저장 데이터를 읽지 못해 초기화합니다. 원본은 ' + KEY + ':corrupt 키에 보관됨.', err);
      return null;
    }
  }

  const data = blank();

  function save() {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  // 마이그레이션: 타임스탬프를 소수 첫째 자리로 통일 (초기 버전은 둘째 자리까지 저장했음)
  function normalizeTimes() {
    let dirty = false;
    Object.values(data.videos).forEach(v => v.lines.forEach(l => {
      if (l.t != null) {
        const r = Math.round(l.t * 10) / 10;
        if (r !== l.t) { l.t = r; dirty = true; }
      }
    }));
    return dirty;
  }

  // 시작 시: 로컬 편집본(localStorage)이 있으면 그것을, 없으면 배포된 공유 데이터
  // (data/data.json)를 읽는다. 공유 데이터는 열람용이라 localStorage에 쓰지 않는다 —
  // 사용자가 무언가를 편집하는 순간(save 호출)부터 로컬 사본이 만들어진다.
  const ready = (async () => {
    const local = loadLocal();
    if (local) {
      Object.assign(data, blank(), local);
      if (normalizeTimes()) save();
      return;
    }
    try {
      const res = await fetch('data/data.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const d = await res.json();
      if (d && d.version === 1) {
        Object.assign(data, blank(), d);
        normalizeTimes();
      }
    } catch (err) {
      console.info('공유 데이터(data/data.json)가 없어 빈 상태로 시작합니다.', err);
    }
  })();

  function ensureVideo(id) {
    if (!data.videos[id]) {
      // noLyrics: 연주곡 등 "원래 가사가 없는 곡" 표시 (미작업과 구분)
      data.videos[id] = { title: '', channel: '', errorCode: null, noLyrics: false, lines: [] };
    }
    return data.videos[id];
  }

  function isKnownVideo(id) {
    return data.singles.includes(id) || data.playlists.some(p => p.videoIds.includes(id));
  }

  function addPlaylist(id, videoIds) {
    data.playlists.push({ id, title: '', videoIds });
    videoIds.forEach(ensureVideo);
    save();
  }

  // 어디서도 참조되지 않게 된 영상 정리: 가사 작업물이 있으면 개별 영상으로 보존
  function pruneDropped(droppedIds) {
    droppedIds.forEach(vid => {
      if (isKnownVideo(vid)) return;
      const v = data.videos[vid];
      if (v && v.lines.length) data.singles.push(vid);
      else delete data.videos[vid];
    });
  }

  function refreshPlaylist(id, videoIds) {
    const p = data.playlists.find(pl => pl.id === id);
    if (!p) return;
    const dropped = p.videoIds.filter(v => !videoIds.includes(v));
    p.videoIds = videoIds;
    videoIds.forEach(ensureVideo);
    pruneDropped(dropped);
    save();
  }

  function removePlaylist(id) {
    const i = data.playlists.findIndex(p => p.id === id);
    if (i < 0) return;
    const removed = data.playlists.splice(i, 1)[0];
    pruneDropped(removed.videoIds);
    save();
  }

  function renamePlaylist(id, title) {
    const p = data.playlists.find(pl => pl.id === id);
    if (!p) return;
    p.title = title.trim();
    save();
  }

  function addSingle(id) {
    data.singles.push(id);
    ensureVideo(id);
    save();
  }

  function removeSingle(id) {
    data.singles = data.singles.filter(v => v !== id);
    if (!isKnownVideo(id)) delete data.videos[id];
    save();
  }

  function updateVideo(id, patch) {
    Object.assign(ensureVideo(id), patch);
    save();
  }

  function setLines(id, lines) {
    const v = ensureVideo(id);
    v.lines = lines;
    if (lines.length) v.noLyrics = false;
    save();
  }

  function listContext(listId) {
    if (!listId) return null;
    if (listId === '_singles') return { id: '_singles', title: '개별 영상', videoIds: data.singles };
    return data.playlists.find(p => p.id === listId) || null;
  }

  function exportJson() {
    return JSON.stringify(data, null, 2);
  }

  // 선택한 플레이리스트들('_singles' 포함)만 담은 부분 내보내기
  function exportSubsetJson(listIds) {
    const out = blank();
    listIds.forEach(listId => {
      const ctx = listContext(listId);
      if (!ctx) return;
      if (listId === '_singles') out.singles = ctx.videoIds.slice();
      else out.playlists.push({ id: ctx.id, title: ctx.title, videoIds: ctx.videoIds.slice() });
      ctx.videoIds.forEach(id => { if (data.videos[id]) out.videos[id] = data.videos[id]; });
    });
    return JSON.stringify(out, null, 2);
  }

  function validate(text) {
    const d = JSON.parse(text);
    if (!d || d.version !== 1 || !Array.isArray(d.playlists) || typeof d.videos !== 'object') {
      throw new Error('올바른 백업 파일이 아닙니다');
    }
    return d;
  }

  function importJson(text) {
    Object.assign(data, blank(), validate(text));
    save();
  }

  // 기존 데이터를 지우지 않고 합치기. 영상이 겹치면 가사가 있는 쪽을 남긴다.
  function mergeJson(text) {
    const d = validate(text);
    d.playlists.forEach(p => {
      const ex = data.playlists.find(x => x.id === p.id);
      if (ex) {
        ex.title = p.title || ex.title;
        ex.videoIds = p.videoIds;
      } else {
        data.playlists.push(p);
      }
    });
    (d.singles || []).forEach(id => {
      if (!data.singles.includes(id)) data.singles.push(id);
    });
    Object.entries(d.videos).forEach(([id, v]) => {
      const ex = data.videos[id];
      if (!ex || (v.lines && v.lines.length) || !ex.lines.length) data.videos[id] = v;
    });
    save();
  }

  return {
    data, ready, save, ensureVideo, isKnownVideo,
    addPlaylist, refreshPlaylist, removePlaylist, renamePlaylist,
    addSingle, removeSingle, updateVideo, setLines,
    listContext, exportJson, exportSubsetJson, importJson, mergeJson,
  };
})();
