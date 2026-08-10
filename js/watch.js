window.MS = window.MS || {};

// 시청 화면: 플레이어 + [자막 보기 / 가사 입력 / 싱크 편집] 3개 모드
MS.watch = (() => {
  const els = {};
  let st = null; // { videoId, listId, mode, player, ready, poll, target, preview, userScrollAt, lastActive }

  function $(id) { return document.getElementById(id); }

  function curVideo() { return MS.store.data.videos[st.videoId]; }
  function curLines() { const v = curVideo(); return v ? v.lines : []; }

  function fmt(t) {
    if (t == null) return '—';
    const m = Math.floor(t / 60);
    return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0');
  }

  function round1(t) {
    return Math.max(0, Math.round(t * 10) / 10);
  }

  function playerReady() {
    return st && st.ready && st.player && typeof st.player.getCurrentTime === 'function';
  }

  // ---------- 진입 / 이탈 ----------

  async function open(videoId, listId) {
    cacheEls();
    listId = listId || null;

    if (st && st.player) {
      if (st.videoId === videoId && st.listId === listId) return; // 같은 영상 재진입(해시 echo)
      st.videoId = videoId;
      st.listId = listId;
      st.player.loadVideoById(videoId);
      resetForVideo();
      return;
    }

    st = { videoId, listId, mode: 'view', player: null, ready: false, poll: null,
           target: 0, preview: null, userScrollAt: 0, lastActive: -2 };
    resetForVideo();

    await MS.yt.ready();
    if (!st) return; // 로딩 중 홈으로 이탈함

    const el = document.createElement('div');
    els.host.appendChild(el);
    st.player = new YT.Player(el, {
      width: '100%', height: '100%',
      videoId,
      playerVars: { rel: 0, playsinline: 1 },
      events: { onReady: onPlayerReady, onStateChange: onPlayerState, onError: onPlayerError },
    });
    st.poll = setInterval(tick, 250);
  }

  function close() {
    if (!st) return;
    if (st.poll) clearInterval(st.poll);
    if (st.player && st.player.destroy) {
      try { st.player.destroy(); } catch (err) { console.warn('플레이어 정리 실패:', err); }
    }
    els.host.innerHTML = '';
    st = null;
  }

  function resetForVideo() {
    st.target = 0;
    st.preview = null;
    st.lastActive = -2;
    els.error.hidden = true;
    els.error.innerHTML = '';
    els.playpause.textContent = '재생';
    MS.store.ensureVideo(st.videoId);
    renderHeader();
    setMode('view');
    prefillEdit();
  }

  function renderHeader() {
    const v = curVideo();
    els.title.textContent = (v && v.title) || st.videoId;
    els.channel.textContent = (v && v.channel) || '';
    els.ytLink.href = 'https://www.youtube.com/watch?v=' + st.videoId;
    const ctx = MS.store.listContext(st.listId);
    const i = ctx ? ctx.videoIds.indexOf(st.videoId) : -1;
    els.prev.hidden = !(ctx && i > 0);
    els.next.hidden = !(ctx && i >= 0 && i < ctx.videoIds.length - 1);
    renderPlaylistPanel(ctx, i);
    renderSidebar();
  }

  // 왼쪽 사이드바: 홈 이동 + 다른 플레이리스트 선택
  function renderSidebar() {
    const d = MS.store.data;
    const items = d.playlists.map(p => ({ id: p.id, title: MS.playlistTitle(p) }));
    if (d.singles.length) items.push({ id: '_singles', title: '개별 영상' });
    els.wsItems.innerHTML = items.map(it =>
      '<li><a class="ws-item' + (it.id === st.listId ? ' current' : '') + '" href="#/list/' + it.id + '" title="' +
      MS.esc(it.title) + '">' + MS.esc(it.title) + '</a></li>').join('');
  }

  // 플레이어 옆 재생목록 패널: 현재 곡 강조 + 클릭 이동
  function renderPlaylistPanel(ctx, cur) {
    if (!ctx) {
      els.wpl.hidden = true;
      return;
    }
    els.wpl.hidden = false;
    els.wplTitle.textContent =
      (ctx.id === '_singles' ? '개별 영상' : ctx.title || '재생목록') +
      ' (' + (cur + 1) + '/' + ctx.videoIds.length + ')';
    els.wplItems.innerHTML = ctx.videoIds.map((vid, n) => {
      const v = MS.store.data.videos[vid] || { lines: [] };
      const synced = v.lines.length > 0 && v.lines.every(l => l.t != null);
      const dot = v.lines.length
        ? '<span class="wpl-dot' + (synced ? ' done' : '') + '" title="' + (synced ? '싱크 완료' : '가사 있음') + '"></span>'
        : v.noLyrics
          ? '<span class="wpl-dot none" title="가사 없는 곡"></span>'
          : '';
      return '<li>' +
        '<a class="wpl-item' + (vid === st.videoId ? ' current' : '') + '" href="#/watch/' + vid + '?list=' + ctx.id + '">' +
        '<span class="wpl-num">' + (n + 1) + '</span>' +
        '<img class="wpl-thumb" loading="lazy" src="https://i.ytimg.com/vi/' + vid + '/default.jpg" alt="">' +
        '<span class="wpl-name">' + MS.esc(v.title || vid) + '</span>' + dot +
        '</a></li>';
    }).join('');
    const row = els.wplItems.querySelector('.wpl-item.current');
    if (row) {
      const li = row.parentElement;
      els.wplItems.scrollTop = Math.max(0, li.offsetTop - els.wplItems.clientHeight / 2 + li.offsetHeight / 2);
    }
  }

  function nav(delta) {
    const ctx = MS.store.listContext(st.listId);
    if (!ctx) return;
    const next = ctx.videoIds[ctx.videoIds.indexOf(st.videoId) + delta];
    if (next) location.hash = '#/watch/' + next + '?list=' + st.listId;
  }

  // ---------- 플레이어 이벤트 ----------

  function onPlayerReady() {
    st.ready = true;
    syncMeta();
  }

  function onPlayerState(e) {
    if (e.data === YT.PlayerState.PLAYING) {
      syncMeta();
      const v = curVideo();
      if (v && v.errorCode) { v.errorCode = null; MS.store.save(); }
      els.error.hidden = true;
    }
    if (e.data === YT.PlayerState.ENDED && st.mode === 'view') nav(1);
    els.playpause.textContent = e.data === YT.PlayerState.PLAYING ? '일시정지' : '재생';
  }

  // 플레이어가 아는 제목/채널명을 저장 데이터에 반영
  function syncMeta() {
    const d = st.player && st.player.getVideoData ? st.player.getVideoData() : null;
    if (!d || !d.title || d.video_id !== st.videoId) return;
    const v = MS.store.ensureVideo(st.videoId);
    if (v.title !== d.title || v.channel !== (d.author || '')) {
      v.title = d.title;
      v.channel = d.author || '';
      MS.store.save();
      renderHeader();
    }
  }

  function onPlayerError(e) {
    MS.store.updateVideo(st.videoId, { errorCode: e.data });
    const msg =
      (e.data === 101 || e.data === 150)
        ? '이 영상은 외부 사이트 재생(임베드)이 허용되지 않습니다. 멤버 전용 영상일 수 있습니다.'
        : e.data === 100
          ? '영상을 찾을 수 없습니다 (삭제되었거나 비공개).'
          : '영상을 재생할 수 없습니다 (오류 코드 ' + e.data + ').';
    els.error.innerHTML = '<p>' + msg + '</p>' +
      '<a href="https://www.youtube.com/watch?v=' + st.videoId + '" target="_blank" rel="noopener">유튜브에서 보기 ↗</a>';
    els.error.hidden = false;
  }

  // ---------- 모드 전환 ----------

  function setMode(mode) {
    st.mode = mode;
    els.tabs.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    els.paneView.hidden = mode !== 'view';
    els.paneEdit.hidden = mode !== 'edit';
    els.paneSync.hidden = mode !== 'sync';
    els.overlay.hidden = mode !== 'sync';
    if (mode === 'view') {
      st.lastActive = -2;
      renderViewPane();
    }
    if (mode === 'sync') {
      const lines = curLines();
      const first = lines.findIndex(l => l.t == null);
      st.target = first === -1 ? 0 : first;
      renderSyncPane();
    }
  }

  // ---------- 자막 보기 ----------

  function renderViewPane() {
    const lines = curLines();
    if (!lines.length) {
      const v = curVideo();
      els.paneView.innerHTML = v && v.noLyrics
        ? '<p class="empty">가사가 없는 곡입니다.</p>'
        : '<p class="empty">아직 가사가 없습니다. <b>가사 입력</b> 탭에서 나무위키 가사를 붙여넣어 시작하세요.</p>';
      return;
    }
    els.paneView.innerHTML = '<ol class="lyrics">' + lines.map((l, i) =>
      '<li class="lyric' + (l.t == null ? ' nosync' : '') + '" data-i="' + i + '"' +
      ' title="' + (l.t == null ? '싱크 없음' : fmt(l.t)) + '">' +
      (l.pron ? '<span class="pron">' + MS.esc(l.pron) + '</span>' : '') +
      '<span class="orig">' + MS.esc(l.orig) + '</span>' +
      (l.trans ? '<span class="trans">' + MS.esc(l.trans) + '</span>' : '') +
      '</li>').join('') + '</ol>';
  }

  // 재생 위치에 맞춰 현재 줄 강조 + 자동 스크롤
  function tick() {
    if (!st || st.mode !== 'view' || !playerReady()) return;
    const lines = curLines();
    if (!lines.length) return;
    const t = st.player.getCurrentTime();
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t != null && lines[i].t <= t + 0.05) idx = i;
    }
    if (idx === st.lastActive) return;
    st.lastActive = idx;
    els.paneView.querySelectorAll('.lyric.active').forEach(n => n.classList.remove('active'));
    if (idx < 0) return;
    const row = els.paneView.querySelector('.lyric[data-i="' + idx + '"]');
    if (!row) return;
    row.classList.add('active');
    if (Date.now() - st.userScrollAt > 4000) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // ---------- 가사 입력 ----------

  function prefillEdit() {
    const lines = curLines();
    els.editText.value = lines.length
      ? lines.map(l => [l.orig, l.pron, l.trans].filter(Boolean).join('\n')).join('\n\n')
      : '';
    els.editPattern.value = 'auto';
    els.editStatus.textContent = '';
    refreshNoLyricsBtn();
    renderPreview();
  }

  // "가사 없는 곡" 토글 — 저장된 가사가 없을 때만 의미가 있으므로 그때만 노출
  function refreshNoLyricsBtn() {
    const v = curVideo();
    els.noLyricsBtn.hidden = curLines().length > 0;
    els.noLyricsBtn.textContent = v && v.noLyrics ? '가사 없음 표시 해제' : '가사 없는 곡으로 표시';
  }

  function toggleNoLyrics() {
    const v = MS.store.ensureVideo(st.videoId);
    MS.store.updateVideo(st.videoId, { noLyrics: !v.noLyrics });
    refreshNoLyricsBtn();
    renderViewPane();
    renderHeader(); // 재생목록 패널의 상태 점 갱신
    els.editStatus.textContent = v.noLyrics
      ? '"가사 없는 곡" 표시를 설정했습니다.'
      : '"가사 없는 곡" 표시를 해제했습니다.';
  }

  // 나무위키 루비(한자 위 후리가나)는 복사하면 본문 옆에 붙어 들어온다.
  // 붙여넣기의 HTML 서식에서 <rt>(후리가나)를 제거해 순수 가사만 넣는다.
  function onEditPaste(e) {
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html || !/<rt[\s>]/i.test(html)) return; // 루비가 없으면 기본 붙여넣기 유지
    e.preventDefault();
    const text = htmlToPlainText(html).replace(/\n{3,}/g, '\n\n').trim();
    const ta = els.editText;
    const start = ta.selectionStart;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    renderPreview();
    els.editStatus.textContent = '후리가나(루비)를 제거하고 붙여넣었습니다.';
  }

  const BLOCK_TAGS = /^(P|DIV|LI|TR|TABLE|UL|OL|BLOCKQUOTE|H[1-6]|SECTION|ARTICLE|PRE)$/;

  function htmlToPlainText(html) {
    // DOMParser 문서는 비활성 — 스크립트 실행/리소스 로드 없음
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('rt, rp, style, script').forEach(n => n.remove());
    return nodeText(doc.body);
  }

  function nodeText(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue.replace(/[\r\n\t]+/g, ' ');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === 'BR') { out += '\n'; continue; }
        const block = BLOCK_TAGS.test(child.tagName);
        if (block && out && !out.endsWith('\n')) out += '\n';
        out += nodeText(child);
        if (block && !out.endsWith('\n')) out += '\n';
      }
    }
    return out;
  }

  function renderPreview() {
    const text = els.editText.value;
    st.preview = text.trim() ? MS.parser.parse(text, els.editPattern.value) : [];
    drawPreview();
  }

  function drawPreview() {
    if (!st.preview || !st.preview.length) {
      els.editPreview.innerHTML = '';
      return;
    }
    els.editPreview.innerHTML =
      '<tr><th>#</th><th>원문</th><th>발음</th><th>해석</th></tr>' +
      st.preview.map((l, i) =>
        '<tr><td>' + (i + 1) + '</td><td>' + MS.esc(l.orig) + '</td><td>' +
        MS.esc(l.pron) + '</td><td>' + MS.esc(l.trans) + '</td></tr>').join('');
  }

  function swapFields(a, b) {
    if (!st.preview) return;
    st.preview.forEach(l => { const tmp = l[a]; l[a] = l[b]; l[b] = tmp; });
    drawPreview();
  }

  function saveLines() {
    if (!st.preview || !st.preview.length) {
      els.editStatus.textContent = '저장할 가사가 없습니다.';
      return;
    }
    const old = curLines();
    const hadSync = old.some(l => l.t != null);
    const kept = old.length === st.preview.length;
    if (kept) st.preview.forEach((l, i) => { l.t = old[i].t; });
    MS.store.setLines(st.videoId, st.preview.map(l => ({ ...l })));
    refreshNoLyricsBtn();
    els.editStatus.textContent = st.preview.length + '줄 저장됨' +
      (hadSync ? (kept ? ' (기존 싱크 유지)' : ' — 줄 수가 달라져 기존 싱크가 초기화되었습니다') : '');
  }

  // ---------- 싱크 편집 ----------

  function renderSyncPane() {
    const lines = curLines();
    if (!lines.length) {
      const v = curVideo();
      els.syncLines.innerHTML = v && v.noLyrics
        ? '<p class="empty">가사가 없는 곡입니다.</p>'
        : '<p class="empty">먼저 <b>가사 입력</b> 탭에서 가사를 저장하세요.</p>';
      return;
    }
    const field = els.syncField.value;
    els.syncLines.innerHTML = lines.map((l, i) => {
      const warn = l.t != null && i > 0 && lines[i - 1].t != null && l.t < lines[i - 1].t;
      return '<li class="sync-line' + (i === st.target ? ' target' : '') + '" data-i="' + i + '">' +
        '<button type="button" class="time-badge" data-act="edit-time" title="클릭해서 직접 수정">' + fmt(l.t) + '</button>' +
        '<span class="sync-text" title="클릭하면 이 시간부터 재생">' + MS.esc(l[field] || l.orig) + '</span>' +
        (warn ? '<span class="warn" title="앞 줄보다 시간이 빠릅니다">⚠</span>' : '') +
        '<span class="sync-tools">' +
        '<button type="button" data-act="minus" title="0.1초 당기기">−.1</button>' +
        '<button type="button" data-act="plus" title="0.1초 밀기">+.1</button>' +
        '<button type="button" data-act="clear" title="지우기">✕</button>' +
        '</span></li>';
    }).join('');
    const target = els.syncLines.querySelector('.sync-line.target');
    if (target && Date.now() - st.userScrollAt > 4000) {
      target.scrollIntoView({ block: 'center' });
    }
  }

  function stamp() {
    const lines = curLines();
    if (!lines.length || !playerReady()) return;
    if (st.target == null || st.target >= lines.length) return;
    lines[st.target].t = round1(st.player.getCurrentTime());
    MS.store.save();
    st.target = st.target + 1 < lines.length ? st.target + 1 : null; // null = 모든 줄 완료
    renderSyncPane();
  }

  function togglePlay() {
    if (!playerReady()) return;
    if (st.player.getPlayerState() === YT.PlayerState.PLAYING) st.player.pauseVideo();
    else st.player.playVideo();
  }

  function seekBy(sec) {
    if (!playerReady()) return;
    st.player.seekTo(Math.max(0, st.player.getCurrentTime() + sec), true);
  }

  function offsetAll(d) {
    const lines = curLines();
    lines.forEach(l => {
      if (l.t != null) l.t = round1(l.t + d);
    });
    MS.store.save();
    renderSyncPane();
  }

  function onSyncListClick(e) {
    if (e.target.tagName === 'INPUT') return; // 시간 직접 편집 중
    const row = e.target.closest('.sync-line');
    if (!row) return;
    const i = Number(row.dataset.i);
    const lines = curLines();
    const act = e.target.dataset.act;
    st.userScrollAt = Date.now(); // 클릭 직후 자동 스크롤로 화면이 튀지 않게
    if (act === 'edit-time') {
      st.target = i;
      startTimeEdit(row, i);
      return; // 재렌더링하면 입력창이 사라지므로 커밋 시점에 렌더링
    }
    if (act === 'minus' || act === 'plus') {
      if (lines[i].t != null) {
        lines[i].t = round1(lines[i].t + (act === 'minus' ? -0.1 : 0.1));
        MS.store.save();
        // 바뀐 시간부터 바로 재생해 보정 결과를 즉시 확인
        if (playerReady()) {
          st.player.seekTo(lines[i].t, true);
          st.player.playVideo();
        }
      }
    } else if (act === 'clear') {
      lines[i].t = null;
      MS.store.save();
      st.target = i;
    } else {
      // 가사(행) 클릭 = 대상 줄 선택 + 그 시간부터 재생
      st.target = i;
      if (lines[i].t != null && playerReady()) {
        st.player.seekTo(lines[i].t, true);
        st.player.playVideo();
      }
    }
    if (e.target.tagName === 'BUTTON') e.target.blur();
    renderSyncPane();
  }

  // 시간 배지 클릭 → 인라인 입력으로 직접 수정 ("1:23.4" 또는 초 단위 "83.4")
  function startTimeEdit(row, i) {
    const lines = curLines();
    const badge = row.querySelector('.time-badge');
    const inp = document.createElement('input');
    inp.className = 'time-edit';
    inp.value = lines[i].t == null ? '' : fmt(lines[i].t);
    badge.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      if (commit) {
        const sec = parseTimeInput(inp.value);
        if (sec != null) {
          lines[i].t = round1(sec);
          MS.store.save();
        }
      }
      renderSyncPane();
    };
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') finish(false);
    });
  }

  // "1:23.4" / "83.4" → 초. 인식 불가·빈 값은 null (변경 없음)
  function parseTimeInput(str) {
    const m = str.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
  }

  function onKeydown(e) {
    if (!st || st.mode !== 'sync') return;
    if (document.getElementById('view-watch').hidden) return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      stamp();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      seekBy(e.code === 'ArrowLeft' ? -3 : 3);
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      const lines = curLines();
      if (!lines.length) return;
      const cur = st.target == null ? lines.length : st.target;
      st.target = Math.min(lines.length - 1, Math.max(0, cur + (e.code === 'ArrowUp' ? -1 : 1)));
      st.userScrollAt = 0; // 대상 이동은 따라가도록
      renderSyncPane();
    }
  }

  // ---------- 요소 캐시 + 정적 바인딩 ----------

  function cacheEls() {
    if (els.cached) return;
    Object.assign(els, {
      cached: true,
      host: $('player-host'), overlay: $('player-overlay'), error: $('player-error'),
      title: $('watch-title'), channel: $('watch-channel'), ytLink: $('watch-youtube-link'),
      prev: $('btn-prev-video'), next: $('btn-next-video'),
      tabs: Array.from(document.querySelectorAll('.mode-tabs button')),
      paneView: $('pane-view'), paneEdit: $('pane-edit'), paneSync: $('pane-sync'),
      editText: $('edit-text'), editPattern: $('edit-pattern'),
      editPreview: $('edit-preview'), editStatus: $('edit-status'),
      noLyricsBtn: $('btn-no-lyrics'),
      syncLines: $('sync-lines'), playpause: $('sync-playpause'),
      wpl: $('watch-playlist'), wplTitle: $('wpl-title'), wplItems: $('wpl-items'),
      wsItems: $('ws-items'), syncField: $('sync-field'),
    });
    els.syncField.value = localStorage.getItem('music-subtitle:sync-field') || 'orig';
    els.syncField.addEventListener('change', () => {
      localStorage.setItem('music-subtitle:sync-field', els.syncField.value);
      renderSyncPane();
    });

    els.tabs.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    els.prev.addEventListener('click', () => nav(-1));
    els.next.addEventListener('click', () => nav(1));

    els.paneView.addEventListener('click', e => {
      const row = e.target.closest('.lyric');
      if (!row) return;
      const line = curLines()[Number(row.dataset.i)];
      if (line && line.t != null && playerReady()) {
        st.player.seekTo(line.t, true);
        st.player.playVideo();
      }
    });
    window.addEventListener('wheel', () => { if (st) st.userScrollAt = Date.now(); }, { passive: true });
    window.addEventListener('touchmove', () => { if (st) st.userScrollAt = Date.now(); }, { passive: true });

    els.editText.addEventListener('paste', onEditPaste);
    els.editText.addEventListener('input', renderPreview);
    els.editPattern.addEventListener('change', renderPreview);
    $('btn-swap-orig-pron').addEventListener('click', () => swapFields('orig', 'pron'));
    $('btn-swap-pron-trans').addEventListener('click', () => swapFields('pron', 'trans'));
    els.noLyricsBtn.addEventListener('click', toggleNoLyrics);
    $('btn-save-lines').addEventListener('click', saveLines);

    els.overlay.addEventListener('click', togglePlay);
    $('sync-back5').addEventListener('click', () => seekBy(-5));
    $('sync-fwd5').addEventListener('click', () => seekBy(5));
    els.playpause.addEventListener('click', togglePlay);
    $('sync-speed').addEventListener('change', e => {
      if (playerReady()) st.player.setPlaybackRate(parseFloat(e.target.value));
    });
    $('btn-stamp').addEventListener('click', e => { stamp(); e.target.blur(); });
    $('sync-offset-minus').addEventListener('click', () => offsetAll(-0.1));
    $('sync-offset-plus').addEventListener('click', () => offsetAll(0.1));
    $('sync-clear-all').addEventListener('click', e => MS.ui.armButton(e.target, () => {
      curLines().forEach(l => { l.t = null; });
      MS.store.save();
      st.target = 0;
      renderSyncPane();
    }));
    els.syncLines.addEventListener('click', onSyncListClick);
    document.addEventListener('keydown', onKeydown);
  }

  return {
    open, close,
    player: () => (st ? st.player : null),
    refreshChrome: () => { if (st) renderHeader(); }, // 제목 등 표시 정보 갱신용
  };
})();
