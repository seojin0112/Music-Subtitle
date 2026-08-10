window.MS = window.MS || {};

MS.yt = (() => {
  let apiPromise = null;

  function ready() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) { resolve(); return; }
      window.onYouTubeIframeAPIReady = () => resolve();
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('유튜브 플레이어 API를 불러오지 못했습니다 (인터넷 연결 확인)'));
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  // API 키 없이 플레이리스트의 영상 ID 목록을 얻는다:
  // 숨김 플레이어에 재생목록을 큐잉하면 getPlaylist()로 ID를 읽을 수 있다 (최대 200개)
  async function fetchPlaylistIds(listId) {
    await ready();
    return new Promise((resolve, reject) => {
      const host = document.createElement('div');
      document.getElementById('hidden-players').appendChild(host);
      let player = null;
      let done = false;

      function finish(err, ids) {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timer);
        if (player && player.destroy) {
          try { player.destroy(); } catch (e) { console.warn('숨김 플레이어 정리 실패:', e); }
        }
        host.remove();
        if (err) reject(err); else resolve(ids);
      }

      player = new YT.Player(host, {
        width: 1, height: 1,
        playerVars: { listType: 'playlist', list: listId },
        events: {
          onError: e => finish(new Error('플레이리스트를 불러오지 못했습니다 (오류 코드 ' + e.data + ')')),
        },
      });

      const poll = setInterval(() => {
        if (typeof player.getPlaylist !== 'function') return;
        const ids = player.getPlaylist();
        if (ids && ids.length) finish(null, ids.slice());
      }, 300);

      const timer = setTimeout(
        () => finish(new Error('플레이리스트 로딩 시간 초과 — 비공개이거나 잘못된 ID일 수 있습니다')),
        15000);
    });
  }

  // 제목/채널명: noembed.com (CORS 지원 oEmbed 프록시). 실패해도 치명적이지 않음 —
  // 영상을 한 번 재생하면 플레이어에서 제목을 받아 채워진다.
  async function fetchMeta(videoId) {
    try {
      const url = 'https://noembed.com/embed?url=' +
        encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
      const res = await fetch(url);
      if (!res.ok) return null;
      const j = await res.json();
      if (j.error || !j.title) return null;
      return { title: j.title, channel: j.author_name || '' };
    } catch (err) {
      console.warn('영상 제목 조회 실패:', videoId, err);
      return null;
    }
  }

  async function fetchMetas(ids, onEach) {
    const queue = ids.slice();
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        const meta = await fetchMeta(id);
        if (meta) onEach(id, meta);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  }

  // 플레이리스트 제목: 유튜브 RSS 피드(CORS 미지원)를 공개 프록시로 우회해서 읽는다.
  // 프록시가 모두 죽으면 null — 기본 이름으로 표시되고 수동 변경 가능.
  async function fetchPlaylistTitle(listId) {
    const feed = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + listId;
    const proxies = [
      u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
      u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    ];
    for (const wrap of proxies) {
      try {
        const res = await fetch(wrap(feed), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
        const t = xml.querySelector('feed > title');
        if (t && t.textContent.trim()) return t.textContent.trim();
      } catch (err) {
        console.warn('플레이리스트 제목 조회 실패:', wrap(feed), err);
      }
    }
    return null;
  }

  function parsePlaylistInput(str) {
    str = str.trim();
    try {
      const u = new URL(str);
      const list = u.searchParams.get('list');
      if (list) return list;
    } catch (err) { /* URL이 아니면 ID로 취급 */ }
    if (/^[A-Za-z0-9_-]{10,}$/.test(str)) return str;
    return null;
  }

  function parseVideoInput(str) {
    str = str.trim();
    try {
      const u = new URL(str);
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts\/|embed\/|live\/)?([A-Za-z0-9_-]{11})$/);
      if (m) return m[1];
    } catch (err) { /* URL이 아니면 ID로 취급 */ }
    if (/^[A-Za-z0-9_-]{11}$/.test(str)) return str;
    return null;
  }

  return { ready, fetchPlaylistIds, fetchPlaylistTitle, fetchMeta, fetchMetas, parsePlaylistInput, parseVideoInput };
})();
