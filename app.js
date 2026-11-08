// 單字資料從 words.json 載入，格式見 CLAUDE.md
let W = [];
const POS = { adj: "形容詞", v: "動詞", n: "名詞" };
const $ = s => document.querySelector(s);
const find = k => W.find(x => x.word === k);

// 進度存在 localStorage 的 "vocabQ"（不要改名，否則舊紀錄會消失）
// m：錯題本 {單字: 錯題次數}，ok：答對題數，tot：總題數
let S = { m: {}, ok: 0, tot: 0 }, cur = null, last = "", tab = "quiz", armed = false;
try { const r = localStorage.getItem("vocabQ"); if (r) S = Object.assign(S, JSON.parse(r)); } catch (e) {}
const save = () => { try { localStorage.setItem("vocabQ", JSON.stringify(S)); } catch (e) {} };
const shuf = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
// 錯題本裡、但目前單字表中有的字（舊版的字暫時不在表上，紀錄保留但不顯示）
const bookKeys = () => Object.keys(S.m).filter(find);

function say(t) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "en-US"; u.rate = .9;
    speechSynthesis.speak(u);
  } catch (e) {}
}

function next() {
  // 抽題權重 = 1 + 4 × 錯題次數
  const ws = W.map(w => 1 + 4 * (S.m[w.word] || 0));
  let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
  while (i < ws.length - 1 && r >= ws[i]) { r -= ws[i]; i++; }
  const w = W[i];
  // 在錯題本中的字改用 extra 例句
  const pool = S.m[w.word] ? w.extra : w.hp;
  const ss = pool.filter(s => s.en !== last);
  const s = ss[Math.floor(Math.random() * ss.length)];
  last = s.en;
  // 干擾選項：優先挑同詞性的字
  const d = shuf(W.filter(x => x !== w && x.pos === w.pos))
    .concat(shuf(W.filter(x => x !== w && x.pos !== w.pos))).slice(0, 3);
  cur = { w, s, opts: shuf([w].concat(d)), done: false, pick: -1 };
  render();
}

function pick(i) {
  if (cur.done) return;
  const c = cur, k = c.w.word, good = c.opts[i] === c.w;
  S.tot++;
  if (good) { S.ok++; if (S.m[k]) { S.m[k]--; if (!S.m[k]) delete S.m[k]; } }
  else S.m[k] = Math.min(5, (S.m[k] || 0) + 1);
  c.done = true; c.pick = i; save(); render(); say(c.s.en);
}

function render() {
  $("#stat").textContent = "答對 " + S.ok + " / " + S.tot + "，錯題本 " + bookKeys().length + " 個單字";
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  if (tab === "book") return book();
  if (!cur) return next();
  const c = cur, k = c.w.word, re = new RegExp("\\b" + k + "\\b", "i");
  const q = c.done ? c.s.en.replace(re, '<span class="hl">' + k + '</span>') : c.s.en.replace(re, "＿＿＿＿＿");
  let h = '<div class="card"><p class="sent">' + q + '</p><div class="opts">';
  c.opts.forEach((o, i) => {
    let cls = "opt";
    if (c.done) { if (o === c.w) cls += " ok"; else if (i === c.pick) cls += " bad"; }
    h += '<button class="' + cls + '" data-i="' + i + '">' + o.word + (c.done ? '<span class="zh">' + o.zh + '</span>' : '') + '</button>';
  });
  h += '</div>';
  if (c.done) {
    h += '<div class="fb"><p>' + c.s.zh + '</p><p class="mut">' + k + "（" + POS[c.w.pos] + "）" + c.w.zh + '</p>' +
      '<div class="row"><button class="btn" data-a="say">再聽一次</button><button class="btn pri" data-a="next">下一題</button></div></div>';
  }
  $("#main").innerHTML = h + '</div>';
}

function book() {
  const ks = bookKeys().sort((a, b) => S.m[b] - S.m[a]);
  let h = '<div class="card">';
  if (!ks.length) h += '<p>目前沒有錯題。到「練習」答題，答錯的單字會出現在這裡，並且更常出題。</p>';
  ks.forEach(k => {
    const w = find(k), re = new RegExp("\\b" + k + "\\b", "i");
    h += '<div class="wb"><div class="item"><span class="w">' + k + '</span><span class="n mut">' + w.zh + '</span><span class="cnt">' + S.m[k] + '</span><button class="btn" data-w="' + k + '" aria-label="朗讀 ' + k + '">朗讀</button></div>';
    w.extra.forEach((s, n) => {
      h += '<div class="ex"><div><p class="en">' + s.en.replace(re, '<span class="hl">' + k + '</span>') + '</p><p class="mut">' + s.zh + '</p></div><button class="btn" data-x="' + k + '|' + n + '" aria-label="朗讀例句">朗讀</button></div>';
    });
    h += '</div>';
  });
  if (ks.length) h += '<div class="row"><button class="btn pri" data-a="go">練習錯題</button></div>';
  h += '<div class="row"><button class="btn" data-a="reset">' + (armed ? "再按一次確認清除" : "清除全部紀錄") + '</button></div></div>';
  $("#main").innerHTML = h;
}

document.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t || !W.length) return;
  if (t.dataset.t) { tab = t.dataset.t; armed = false; render(); return; }
  if (t.dataset.i !== undefined) return pick(+t.dataset.i);
  if (t.dataset.w) return say(t.dataset.w);
  if (t.dataset.x) { const p = t.dataset.x.split("|"); return say(find(p[0]).extra[+p[1]].en); }
  const a = t.dataset.a;
  if (a === "next") next();
  else if (a === "say") say(cur.s.en);
  else if (a === "go") { tab = "quiz"; next(); }
  else if (a === "reset") {
    if (!armed) { armed = true; render(); return; }
    S = { m: {}, ok: 0, tot: 0 }; armed = false; save(); cur = null; render();
  }
});

// 讀取 words.json。直接雙擊 html 開啟時瀏覽器會擋下讀檔，要用本機伺服器
fetch("words.json")
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(data => { W = data; render(); })
  .catch(() => {
    $("#main").innerHTML = '<div class="card"><p>讀不到 words.json。請在專案資料夾執行 <code>npx serve</code> 或 <code>python -m http.server</code>，再用瀏覽器開啟網址。</p></div>';
  });
