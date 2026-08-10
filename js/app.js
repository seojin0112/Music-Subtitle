window.MS = window.MS || {};

// 위험 버튼 2단계 확인: 첫 클릭 → "한 번 더", 2.5초 내 재클릭 → 실행
MS.ui = {
  armButton(btn, onConfirm) {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      clearTimeout(Number(btn.dataset.armTimer));
      btn.textContent = btn.dataset.origLabel;
      btn.classList.remove('armed');
      onConfirm();
      return;
    }
    btn.dataset.armed = '1';
    btn.dataset.origLabel = btn.textContent;
    btn.textContent = '한 번 더 누르면 실행';
    btn.classList.add('armed');
    btn.dataset.armTimer = setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.origLabel;
      btn.classList.remove('armed');
    }, 2500);
  },
};

(() => {
  function $(id) { return document.getElementById(id); }

  // ---------- 라우팅 ----------

  function route() {
    const h = location.hash || '#/';
    const w = h.match(/^#\/watch\/([A-Za-z0-9_-]{11})(?:\?list=([A-Za-z0-9_-]+))?$/);
    if (w) {
      showView('watch');
      MS.watch.open(w[1], w[2]);
      return;
    }
    MS.watch.close();
    const l = h.match(/^#\/list\/([A-Za-z0-9_-]+)$/);
    if (l) {
      showView('list');
      renderList(l[1]);
      return;
    }
    showView('home');
    renderHome();
  }

  function showView(name) {
    $('view-home').hidden = name !== 'home';
    $('view-list').hidden = name !== 'list';
    $('view-watch').hidden = name !== 'watch';
  }

  function currentListId() {
    const m = location.hash.match(/^#\/list\/([A-Za-z0-9_-]+)$/);
    return m ? m[1] : null;
  }

  // ---------- 상태 메시지 ----------

  let statusTimer = null;
  function status(msg, isError, hideAfter) {
    const el = $('app-status');
    clearTimeout(statusTimer);
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
    if (hideAfter) statusTimer = setTimeout(() => { el.hidden = true; }, hideAfter);
  }

  // ---------- 홈: 플레이리스트 리스트 ----------

  // 내보내기/삭제 선택 모드 상태
  let selectMode = null; // null | 'export' | 'delete'
  const selected = new Set();

  function playlistRow(ctx, isSingles) {
    const withLyrics = ctx.videoIds.filter(id => {
      const v = MS.store.data.videos[id];
      return v && v.lines.length;
    }).length;
    const sub = ctx.videoIds.length + '곡' + (withLyrics ? ' · 자막 ' + withLyrics + '곡' : '');
    const check = selectMode
      ? '<input type="checkbox" class="pl-checkbox"' + (selected.has(ctx.id) ? ' checked' : '') + '>'
      : '';
    return '<a class="pl-row' + (selectMode ? ' selecting' : '') + '" href="#/list/' + ctx.id + '" data-list="' + ctx.id + '">' +
      check +
      '<div><div class="pl-row-title">' + MS.esc(isSingles ? '개별 영상' : MS.playlistTitle(ctx)) + '</div>' +
      '<div class="pl-row-sub">' + sub + '</div></div>' +
      '<span class="chevron">›</span></a>';
  }

  function allListIds() {
    const ids = MS.store.data.playlists.map(p => p.id);
    if (MS.store.data.singles.length) ids.push('_singles');
    return ids;
  }

  function setSelectMode(mode) {
    selectMode = mode;
    selected.clear();
    syncToolbar();
    renderHome();
  }

  function syncToolbar() {
    ['btn-export-mode', 'btn-import-merge', 'btn-import-replace', 'btn-delete-mode']
      .forEach(id => { $(id).hidden = !!selectMode; });
    $('select-controls').hidden = !selectMode;
    if (!selectMode) return;
    $('btn-select-all').textContent =
      selected.size === allListIds().length ? '전체 해제' : '전체 선택';
    const btn = $('btn-select-confirm');
    if (!btn.dataset.armed) {
      btn.textContent = (selectMode === 'export' ? '선택 내보내기' : '선택 삭제') + ' (' + selected.size + ')';
    }
    btn.classList.toggle('primary', selectMode === 'export');
    btn.classList.toggle('danger', selectMode === 'delete');
  }

  function confirmSelection(btn) {
    if (!selected.size) return status('선택된 목록이 없습니다.', true, 4000);
    // '_singles'를 먼저 지워야 플레이리스트 삭제로 보존된 영상이 함께 지워지지 않는다
    const ids = Array.from(selected).sort(a => (a === '_singles' ? -1 : 1));
    if (selectMode === 'export') {
      let name = 'data.json';
      if (ids.length === 1) {
        const label = ids[0] === '_singles' ? '개별 영상' : MS.playlistTitle(MS.store.listContext(ids[0]));
        name = label.replace(/[\\/:*?"<>|]/g, '') + '.json';
      }
      downloadJson(MS.store.exportSubsetJson(ids), name);
      status('목록 ' + ids.length + '개를 내보냈습니다.', false, 4000);
      setSelectMode(null);
      return;
    }
    MS.ui.armButton(btn, () => {
      ids.forEach(id => {
        if (id === '_singles') MS.store.data.singles.slice().forEach(v => MS.store.removeSingle(v));
        else MS.store.removePlaylist(id);
      });
      status('목록 ' + ids.length + '개를 삭제했습니다.', false, 4000);
      setSelectMode(null);
    });
  }

  function renderHome() {
    const d = MS.store.data;
    const rows = d.playlists.map(p => playlistRow(p, false));
    if (d.singles.length) rows.push(playlistRow({ id: '_singles', videoIds: d.singles }, true));
    $('playlist-rows').innerHTML = rows.length
      ? '<div class="pl-list">' + rows.join('') + '</div>'
      : '<p class="empty big">위에 유튜브 플레이리스트나 영상 주소를 넣어 시작하세요.</p>';
  }

  // ---------- 플레이리스트 상세 ----------

  function videoCard(vid, listId) {
    const v = MS.store.data.videos[vid] || { lines: [] };
    const synced = v.lines.filter(l => l.t != null).length;
    const removeBtn = listId === '_singles'
      ? '<button type="button" class="card-remove danger" data-act="remove-single" data-vid="' + vid + '" title="목록에서 제거">✕</button>'
      : '';
    return '<div class="card-wrap">' + removeBtn +
      '<a class="card" data-vid="' + vid + '" href="#/watch/' + vid + '?list=' + listId + '">' +
      '<div class="thumb"><img loading="lazy" src="https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg" alt="">' +
      (v.errorCode ? '<span class="badge lock">재생 제한</span>' : '') +
      '</div>' +
      '<div class="card-title">' + MS.esc(v.title || vid) + '</div>' +
      '<div class="card-sub">' + MS.esc(v.channel || '') + '</div>' +
      '<div class="card-badges">' +
      (v.lines.length
        ? '<span class="badge">가사 ' + v.lines.length + '줄</span>'
        : v.noLyrics
          ? '<span class="badge none">가사 없음</span>'
          : '<span class="badge dim">미작업</span>') +
      (synced ? '<span class="badge ok">싱크 ' + synced + '/' + v.lines.length + '</span>' : '') +
      '</div></a></div>';
  }

  function renderList(listId) {
    const ctx = MS.store.listContext(listId);
    if (!ctx || !ctx.videoIds.length) { location.hash = '#/'; return; }
    const isSingles = listId === '_singles';
    const manage = isSingles ? '' :
      '<button type="button" data-act="rename" title="이름 바꾸기">✏️</button>' +
      '<span class="spacer"></span>' +
      '<button type="button" data-act="refresh">↻ 새로고침</button>';
    $('list-content').innerHTML =
      '<div class="pl-head" data-list="' + listId + '">' +
      '<a class="back-link" href="#/">← 홈</a>' +
      '<h2 class="pl-title">' + MS.esc(isSingles ? '개별 영상' : MS.playlistTitle(ctx)) + '</h2>' +
      '<span class="muted">' + ctx.videoIds.length + '곡</span>' +
      manage + '</div>' +
      '<div class="grid">' + ctx.videoIds.map(v => videoCard(v, listId)).join('') + '</div>';
  }

  function updateCardMeta(id, meta) {
    MS.store.updateVideo(id, meta);
    document.querySelectorAll('.card[data-vid="' + id + '"]').forEach(card => {
      card.querySelector('.card-title').textContent = meta.title;
      card.querySelector('.card-sub').textContent = meta.channel;
    });
  }

  async function fetchMissingMetas(ids) {
    const missing = ids.filter(id => !(MS.store.data.videos[id] || {}).title);
    if (missing.length) await MS.yt.fetchMetas(missing, updateCardMeta);
  }

  // 제목이 없는 플레이리스트의 실제 유튜브 제목을 받아와 채운다
  async function fillPlaylistTitle(id) {
    const title = await MS.yt.fetchPlaylistTitle(id);
    const p = MS.store.data.playlists.find(pl => pl.id === id);
    if (!title || !p || p.title) return; // 조회 실패했거나 그 사이 직접 이름을 지정함
    MS.store.renamePlaylist(id, title);
    if (!$('view-home').hidden) renderHome();
    if (currentListId() === id) renderList(id);
    MS.watch.refreshChrome();
  }

  // ---------- 추가 / 관리 동작 ----------

  async function onAddPlaylist(e) {
    e.preventDefault();
    const input = $('input-playlist');
    const id = MS.yt.parsePlaylistInput(input.value);
    if (!id) return status('플레이리스트 URL 또는 ID를 인식하지 못했습니다.', true, 6000);
    if (id.startsWith('RD')) return status('믹스(자동 재생목록)는 불러올 수 없습니다. 일반 재생목록을 사용하세요.', true, 8000);
    if (MS.store.data.playlists.some(p => p.id === id)) return status('이미 추가된 플레이리스트입니다.', true, 6000);
    status('플레이리스트 불러오는 중…');
    try {
      const ids = await MS.yt.fetchPlaylistIds(id);
      MS.store.addPlaylist(id, ids);
      fillPlaylistTitle(id);
      input.value = '';
      renderHome();
      status('영상 ' + ids.length + '개 추가됨 — 제목 불러오는 중…' +
        (ids.length >= 200 ? ' (한 번에 최대 200개까지 불러옵니다)' : ''));
      await fetchMissingMetas(ids);
      status('완료', false, 3000);
    } catch (err) {
      status(err.message, true, 8000);
    }
  }

  async function onAddVideo(e) {
    e.preventDefault();
    const input = $('input-video');
    const id = MS.yt.parseVideoInput(input.value);
    if (!id) return status('영상 URL 또는 ID를 인식하지 못했습니다.', true, 6000);
    if (MS.store.isKnownVideo(id)) return status('이미 추가된 영상입니다.', true, 6000);
    MS.store.addSingle(id);
    input.value = '';
    renderHome();
    await fetchMissingMetas([id]);
    status('영상 추가됨', false, 3000);
  }

  async function refreshPlaylist(listId) {
    status('플레이리스트 다시 불러오는 중…');
    try {
      const ids = await MS.yt.fetchPlaylistIds(listId);
      MS.store.refreshPlaylist(listId, ids);
      fillPlaylistTitle(listId);
      if (currentListId() === listId) renderList(listId);
      status('새로고침 완료 (' + ids.length + '곡) — 제목 불러오는 중…');
      await fetchMissingMetas(ids);
      status('완료', false, 3000);
    } catch (err) {
      status(err.message, true, 8000);
    }
  }

  function startRename(head, listId) {
    const h2 = head.querySelector('.pl-title');
    const p = MS.store.data.playlists.find(pl => pl.id === listId);
    if (!p) return;
    const inp = document.createElement('input');
    inp.className = 'rename-input';
    inp.value = p.title || '';
    inp.placeholder = MS.playlistTitle(p);
    h2.replaceWith(inp);
    inp.focus();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      MS.store.renamePlaylist(listId, inp.value);
      renderList(listId);
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') { done = true; renderList(listId); }
    });
  }

  function onListClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    if (!act) return;
    e.preventDefault();
    if (act === 'remove-single') {
      MS.ui.armButton(btn, () => {
        MS.store.removeSingle(btn.dataset.vid);
        if (MS.store.data.singles.length) renderList('_singles');
        else location.hash = '#/';
      });
      return;
    }
    const head = btn.closest('.pl-head');
    const listId = head.dataset.list;
    if (act === 'refresh') refreshPlaylist(listId);
    else if (act === 'rename') startRename(head, listId);
  }

  // ---------- 내보내기 / 가져오기 ----------

  function downloadJson(text, filename) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  let importMode = 'replace';

  async function importBackup(file) {
    try {
      const text = await file.text();
      if (importMode === 'merge') MS.store.mergeJson(text);
      else MS.store.importJson(text);
      location.hash = '#/';
      renderHome();
      status(importMode === 'merge' ? '기존 데이터에 추가했습니다.' : '데이터를 교체했습니다.', false, 4000);
    } catch (err) {
      status('가져오기 실패: ' + err.message, true, 8000);
    }
  }

  // ---------- 부팅 ----------

  MS.store.ready.then(() => {
    $('form-add-playlist').addEventListener('submit', onAddPlaylist);
    $('form-add-video').addEventListener('submit', onAddVideo);
    $('list-content').addEventListener('click', onListClick);

    $('btn-export-mode').addEventListener('click', () => setSelectMode('export'));
    $('btn-delete-mode').addEventListener('click', () => setSelectMode('delete'));
    $('btn-select-cancel').addEventListener('click', () => setSelectMode(null));
    $('btn-select-all').addEventListener('click', () => {
      const all = allListIds();
      if (selected.size === all.length) selected.clear();
      else all.forEach(id => selected.add(id));
      syncToolbar();
      renderHome();
    });
    $('btn-select-confirm').addEventListener('click', e => confirmSelection(e.target));
    $('playlist-rows').addEventListener('click', e => {
      if (!selectMode) return; // 평소에는 행 클릭 = 목록 열기(링크)
      const row = e.target.closest('.pl-row');
      if (!row) return;
      e.preventDefault();
      const id = row.dataset.list;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      row.querySelector('.pl-checkbox').checked = selected.has(id);
      syncToolbar();
    });

    $('btn-import-merge').addEventListener('click', () => { importMode = 'merge'; $('import-file').click(); });
    $('btn-import-replace').addEventListener('click', () => { importMode = 'replace'; $('import-file').click(); });
    $('import-file').addEventListener('change', e => {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });

    window.addEventListener('hashchange', route);
    route();

    // 이전에 추가되어 제목이 비어 있는 플레이리스트 백필
    MS.store.data.playlists.forEach(p => { if (!p.title) fillPlaylistTitle(p.id); });
  });
})();
