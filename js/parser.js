window.MS = window.MS || {};

// 붙여넣은 가사 텍스트를 [{t, orig, pron, trans}] 배열로 변환
MS.parser = (() => {
  function mk(orig, pron, trans) {
    return { t: null, orig: orig || '', pron: pron || '', trans: trans || '' };
  }

  function toBlocks(text) {
    const blocks = [];
    let cur = [];
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (line === '') {
        if (cur.length) { blocks.push(cur); cur = []; }
      } else {
        cur.push(line);
      }
    }
    if (cur.length) blocks.push(cur);
    return blocks;
  }

  // 블록 대다수가 2~3줄이면 "블록 = 가사 한 줄" 구조로 판단
  function detect(blocks) {
    if (blocks.length > 1 && blocks.every(b => b.length <= 3)) {
      const grouped = blocks.filter(b => b.length >= 2).length;
      if (grouped >= blocks.length / 2) return 'block';
    }
    const total = blocks.reduce((n, b) => n + b.length, 0);
    if (total % 3 === 0) return '3';
    if (total % 2 === 0) return '2';
    return '1';
  }

  function blockToLine(b) {
    if (b.length >= 3) return mk(b[0], b[1], b.slice(2).join(' '));
    if (b.length === 2) return mk(b[0], '', b[1]);
    return mk(b[0]);
  }

  function parse(text, mode = 'auto') {
    const blocks = toBlocks(text);
    if (!blocks.length) return [];
    const resolved = mode === 'auto' ? detect(blocks) : mode;

    if (resolved === 'block') return blocks.map(blockToLine);

    const flat = blocks.flat();
    const n = Number(resolved);
    const out = [];
    for (let i = 0; i < flat.length; i += n) {
      const g = flat.slice(i, i + n);
      if (n === 3) out.push(mk(g[0], g[1], g[2]));
      else if (n === 2) out.push(mk(g[0], '', g[1]));
      else out.push(mk(g[0]));
    }
    return out;
  }

  // LRC 형식("[mm:ss.xx] 가사")을 [{t, text}]로. 한 줄에 타임태그가 여러 개면 각각 항목 생성
  function parseLrc(text) {
    const out = [];
    for (const raw of text.split('\n')) {
      const m = raw.match(/^((?:\[\d+:\d+(?:\.\d+)?\])+)\s*(.*)$/);
      if (!m || !m[2].trim()) continue;
      for (const tag of m[1].match(/\[\d+:\d+(?:\.\d+)?\]/g)) {
        const t = tag.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
        out.push({ t: Number(t[1]) * 60 + Number(t[2]), text: m[2].trim() });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // 가사 줄 비교용 정규화: 공백·문장부호 제거, 전각/반각 통일
  function normalizeLyric(s) {
    return s.normalize('NFKC').toLowerCase()
      .replace(/[\s、。！？!?.,…‥「」『』()（）〔〕[\]{}~〜・:;"'’”“-]/g, '');
  }

  return { parse, detect, parseLrc, normalizeLyric };
})();
