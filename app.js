// 單字資料從 words.json 載入，格式見 CLAUDE.md
let W = [];
// 網站版本：改 app.js 或 style.css 時，這裡和 index.html 的 ?v= 要一起更新
const APP_VERSION = "v11（2026-11-21）";
const POS = { adj: "形容詞", v: "動詞", n: "名詞" };
const $ = s => document.querySelector(s);
const find = k => W.find(x => x.word === k);

// 進度存在 localStorage 的 "vocabQ"（不要改名，否則舊紀錄會消失）
// m：錯題本 {單字: 錯題次數}，ok：答對題數，tot：總題數，seen：練過的字 {單字: 1}
let S = { m: {}, ok: 0, tot: 0, seen: {} }, cur = null, last = "", tab = "quiz", armed = false;
try { const r = localStorage.getItem("vocabQ"); if (r) S = Object.assign(S, JSON.parse(r)); } catch (e) {}
// 舊紀錄沒有 seen：至少把錯題本裡的字算成「練過」（答錯過一定練過）
if (!S.seen || typeof S.seen !== "object") S.seen = {};
Object.keys(S.m).forEach(k => { S.seen[k] = 1; });
// 一輪 20 題的計分：round 本輪進度 {n: 已答題數, ok: 答對題數, miss: 答錯的字}，best 最高分，rounds 完成幾輪
const newRound = () => ({ n: 0, ok: 0, miss: [] });
if (!S.round || typeof S.round.n !== "number" || !Array.isArray(S.round.miss)) S.round = newRound();
if (typeof S.best !== "number") S.best = 0;
if (typeof S.rounds !== "number") S.rounds = 0;
const save = () => { try { localStorage.setItem("vocabQ", JSON.stringify(S)); } catch (e) {} };
// 「只練易混淆字」設定：另外用一個 key 存，不動到 vocabQ 的進度
let nearOnly = false;
try { nearOnly = localStorage.getItem("vocabNearOnly") === "1"; } catch (e) {}
const shuf = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
// 錯題本裡、但目前單字表中有的字（舊版的字暫時不在表上，紀錄保留但不顯示）
const bookKeys = () => Object.keys(S.m).filter(find);

// 朗讀：挑一個英文語音。優先 en-US，其次任何英文（en-GB 等）
// 語音清單是非同步載入的，所以要等 voiceschanged 事件
let enVoice = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices();
  enVoice = vs.find(v => v.lang.replace("_", "-") === "en-US") || vs.find(v => /^en/i.test(v.lang)) || null;
}
pickVoice();
if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", pickVoice);

function say(t) {
  if (!("speechSynthesis" in window)) return voiceHelp("這個瀏覽器不支援朗讀功能，請改用 Chrome 或 Edge。");
  pickVoice();
  if (!enVoice) return voiceHelp("這台裝置沒有安裝英文語音，所以無法朗讀。請在 Windows「設定 → 時間與語言 → 語音」新增「英文（美國）」，或改用 Edge 瀏覽器開啟。");
  const u = new SpeechSynthesisUtterance(t);
  u.voice = enVoice; u.lang = enVoice.lang; u.rate = .9;
  // Chrome 的小毛病：cancel() 之後立刻 speak() 有時會被吞掉，所以等一下下再講
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(u), 80);
  } else speechSynthesis.speak(u);
}

// 無法朗讀時，在畫面上方顯示一次提示（不用 alert，免得打斷答題）
function voiceHelp(msg) {
  let el = $("#voice-help");
  if (!el) {
    el = document.createElement("p");
    el.id = "voice-help";
    el.setAttribute("role", "status");
    $("#stat").after(el);
  }
  el.textContent = "🔇 " + msg;
}

// 錯題本填充題：錯題本有字時，每一題約有 25% 機會換成填充題
const CLOZE_RATE = 0.25;
// 優先出沒練過的字：還有沒練過的字時，每題約 70% 機會從中抽
const NEW_RATE = 0.7;
// 一輪幾題；幾分以上出現表揚畫面
const ROUND = 20;
const PRAISE = 90;

// 依權重抽一個字：權重 = 1 + 4 × 錯題次數
function weighted(list) {
  const ws = list.map(w => 1 + 4 * (S.m[w.word] || 0));
  let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
  while (i < ws.length - 1 && r >= ws[i]) { r -= ws[i]; i++; }
  return list[i];
}

// 挑一句例句，避免連續兩題是同一句
function pickSentence(pool) {
  const ss = pool.filter(s => s.en !== last);
  const s = ss[Math.floor(Math.random() * ss.length)];
  last = s.en;
  return s;
}

function next() {
  // 這一輪 20 題答完了 → 先看成績
  if (S.round.n >= ROUND) return finishRound();
  // 勾選「只練易混淆字」時，只從有 near 的單字出題
  const nearWords = W.filter(w => w.near);
  const pool0 = nearOnly && nearWords.length ? nearWords : W;

  // 錯題本填充題：從錯題本（且在目前出題範圍內）的字隨機抽，用 extra 例句
  const bookWords = pool0.filter(w => S.m[w.word]);
  if (bookWords.length && Math.random() < CLOZE_RATE) {
    const w = weighted(bookWords);
    cur = { type: "cloze", w, s: pickSentence(w.extra), done: false, typed: "", good: false };
    return render();
  }

  // 一般選擇題：
  // 還有沒練過的字時，NEW_RATE 的機會從沒練過的字裡隨機抽；其餘照權重抽（錯越多越常出）
  const unseen = pool0.filter(w => !S.seen[w.word]);
  const w = unseen.length && Math.random() < NEW_RATE
    ? unseen[Math.floor(Math.random() * unseen.length)]
    : weighted(pool0);
  // 在錯題本中的字改用 extra 例句
  const s = pickSentence(S.m[w.word] ? w.extra : w.hp);
  // 干擾選項：
  // 有 near（易混淆字）的單字 → 用中文意思相近、但文法或搭配不合這句的字
  // 沒有的 → 從單字表隨機挑，優先挑同詞性
  const d = w.near ? shuf(w.near).slice(0, 3)
    : shuf(W.filter(x => x !== w && x.pos === w.pos))
      .concat(shuf(W.filter(x => x !== w && x.pos !== w.pos))).slice(0, 3);
  cur = { type: "choice", w, s, opts: shuf([w].concat(d)), done: false, pick: -1 };
  render();
}

// 計分：答對 −1、答錯 +1（上限 5），減到 0 就移出錯題本
function grade(k, good) {
  S.tot++;
  S.seen[k] = 1; // 記下這個字練過了
  // 本輪計分
  S.round.n++;
  if (good) S.round.ok++;
  else if (!S.round.miss.includes(k)) S.round.miss.push(k);
  if (good) { S.ok++; if (S.m[k]) { S.m[k]--; if (!S.m[k]) delete S.m[k]; } }
  else S.m[k] = Math.min(5, (S.m[k] || 0) + 1);
  save();
}

// 選擇題作答
function pick(i) {
  if (cur.done || cur.type !== "choice") return;
  cur.pick = i; cur.done = true;
  grade(cur.w.word, cur.opts[i] === cur.w);
  render(); say(cur.s.en);
}

// 填充題作答：不分大小寫，前後空白不算
function submitCloze() {
  if (cur.done || cur.type !== "cloze") return;
  const box = $("#cloze"), typed = box ? box.value.trim() : "";
  if (!typed) { if (box) box.focus(); return; }
  cur.typed = typed;
  cur.good = typed.toLowerCase() === cur.w.word.toLowerCase();
  cur.done = true;
  grade(cur.w.word, cur.good);
  render(); say(cur.s.en);
}

// 學生打的字要先轉成純文字再放進畫面，避免被當成 HTML
const esc = t => t.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// 朗讀題目：作答前把空格念成 "blank"，不會念出答案
function readQuestion() {
  const re = new RegExp("\\b" + cur.w.word + "\\b", "i");
  say(cur.done ? cur.s.en : cur.s.en.replace(re, "blank"));
}

function render() {
  // 已練／未練：只算目前題庫裡有的字
  const seenN = W.filter(w => S.seen[w.word]).length;
  $("#stat").innerHTML = "答對 " + S.ok + " / " + S.tot + "，錯題本 " + bookKeys().length + " 個單字<br>" +
    "題庫 " + W.length + " 字：已練 " + seenN + " 字、未練 " + (W.length - seenN) + " 字" +
    (S.rounds ? "・最高分 " + S.best + " 分" : "");
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  if (tab === "book") return book();
  if (!cur) return next();
  if (cur.type === "result") return renderResult();
  const c = cur, k = c.w.word, re = new RegExp("\\b" + k + "\\b", "i");
  const cloze = c.type === "cloze", near = !cloze && !!c.w.near;
  const nNear = W.filter(w => w.near).length;

  // 空格：選擇題用底線；填充題顯示第一個字母和字數，例如 a _ _ _ _ _ _
  const blank = cloze ? '<span class="blank">' + k[0] + ' ' + Array(k.length - 1).fill("_").join(" ") + '</span>' : "＿＿＿＿＿";
  const q = c.done ? c.s.en.replace(re, '<span class="hl">' + k + '</span>') : c.s.en.replace(re, blank);

  let h = '<label class="mode"><input type="checkbox" id="nearOnly"' + (nearOnly ? ' checked' : '') + '> 只練易混淆字（' + nNear + ' 個字）</label>';
  // 本輪進度：作答前是「正在答第幾題」，答完後就是已答題數
  const qNo = S.round.n + (c.done ? 0 : 1);
  h += '<div class="card"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + ROUND + '" aria-valuenow="' + S.round.n + '">' +
    '<i style="width:' + (S.round.n / ROUND * 100) + '%"></i></div>' +
    '<div class="qhead"><span class="prog">第 ' + qNo + ' / ' + ROUND + ' 題</span>';
  if (cloze) h += '<span class="tag">錯題複習・填充題</span>';
  else if (near) h += '<span class="tag">易混淆字</span>';
  if (!c.done) h += '<button class="btn sm" data-a="readq" aria-label="朗讀題目">🔊 朗讀題目</button>';
  h += '</div><p class="sent">' + q + '</p>';

  if (cloze) {
    if (!c.done) {
      h += '<p class="mut">提示：第一個字母是 ' + k[0] + '，共 ' + k.length + ' 個字母</p>' +
        '<div class="cloze"><input id="cloze" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="填入單字">' +
        '<button class="btn pri" data-a="submit">送出</button></div>';
    } else {
      h += c.good ? '<p class="res ok">✓ 答對了！</p>'
        : '<p class="res bad">✗ 你填的是「' + esc(c.typed) + '」，正確答案是 <b>' + k + '</b></p>';
    }
  } else {
    h += '<div class="opts">';
    c.opts.forEach((o, i) => {
      let cls = "opt";
      if (c.done) { if (o === c.w) cls += " ok"; else if (i === c.pick) cls += " bad"; }
      h += '<button class="' + cls + '" data-i="' + i + '">' + o.word;
      if (c.done) {
        h += '<span class="zh">' + o.zh + (near ? '・第 ' + o.level + ' 級' : '') + '</span>';
        // 易混淆字題：每個選項都顯示適合的情境
        if (near) h += '<span class="fit">' + (o === c.w ? '✓ ' : '') + o.fit + '</span>';
      }
      h += '</button>';
    });
    h += '</div>';
  }

  if (c.done) {
    h += '<div class="fb"><p>' + c.s.zh + '</p><p class="mut">' + k + "（" + POS[c.w.pos] + "）" + c.w.zh + '</p>' +
      '<div class="row"><button class="btn" data-a="say">再聽一次</button><button class="btn pri" data-a="next">' + (S.round.n >= ROUND ? "看成績" : "下一題") + '</button></div></div>';
  }
  $("#main").innerHTML = h + '</div>';
  // 填充題：自動把游標放進輸入框
  if (cloze && !c.done) $("#cloze").focus();
}

// 一輪結束：算分數（每題 5 分）、更新最高分，然後開始新的一輪
function finishRound() {
  const r = S.round, score = Math.round(r.ok / r.n * 100);
  const newBest = score > S.best;
  if (newBest) S.best = score;
  S.rounds++;
  cur = { type: "result", score, ok: r.ok, n: r.n, miss: r.miss.slice(), newBest };
  S.round = newRound();
  save(); render();
}

// 表揚用的彩帶：40 條小紙片，位置、顏色、速度隨機
const CONFETTI = ["#f2b134", "#e4572e", "#1f6f6b", "#5fc2b8", "#7b61ff", "#ff8fab"];
function confetti() {
  let s = "";
  for (let i = 0; i < 40; i++) {
    s += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + CONFETTI[i % CONFETTI.length] +
      ';animation-delay:' + (Math.random() * 1.2).toFixed(2) + 's;animation-duration:' + (2.4 + Math.random() * 1.8).toFixed(2) + 's"></i>';
  }
  return s;
}

// 成績畫面：90 分以上表揚；70–85 分鼓勵；70 分以下提醒複習
function renderResult() {
  const c = cur, great = c.score >= PRAISE;
  let icon, head, msg;
  if (c.score === 100) { icon = "🏆"; head = "滿分！太完美了！"; msg = ROUND + " 題全對，你是單字大師！"; }
  else if (great) { icon = "🏆"; head = "太厲害了！"; msg = "這一輪表現非常出色，繼續保持！"; }
  else if (c.score >= 70) { icon = "👍"; head = "做得好！"; msg = "再多練幾輪，下次挑戰 " + PRAISE + " 分以上！"; }
  else { icon = "💪"; head = "再接再厲！"; msg = "把下面答錯的字多聽幾次，下一輪會更好。"; }

  let h = '<div class="card result' + (great ? ' great' : '') + '">';
  if (great) h += '<div class="confetti" aria-hidden="true">' + confetti() + '</div>';
  h += '<div class="trophy" aria-hidden="true">' + icon + '</div><h2>' + head + '</h2>' +
    '<p class="score"><b>' + c.score + '</b> 分</p>' +
    '<p class="mut">本輪答對 ' + c.ok + ' / ' + c.n + ' 題・最高分 ' + S.best + ' 分</p>';
  if (c.newBest) h += '<p class="newbest">🎉 新紀錄！</p>';
  h += '<p>' + msg + '</p>';
  if (c.miss.length) {
    h += '<div class="miss"><p class="mut">這一輪答錯的字</p>';
    c.miss.forEach(k => {
      const w = find(k); if (!w) return;
      h += '<div class="item"><span class="w">' + k + '</span><span class="n mut">' + w.zh + '</span><button class="btn sm" data-w="' + k + '" aria-label="朗讀 ' + k + '">朗讀</button></div>';
    });
    h += '</div>';
  }
  h += '<div class="row"><button class="btn pri" data-a="next">再來一輪</button>' +
    (bookKeys().length ? '<button class="btn" data-t="book">看錯題本</button>' : '') + '</div></div>';
  $("#main").innerHTML = h;
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
  else if (a === "readq") readQuestion();
  else if (a === "submit") submitCloze();
  else if (a === "go") { tab = "quiz"; next(); }
  else if (a === "reset") {
    if (!armed) { armed = true; render(); return; }
    S = { m: {}, ok: 0, tot: 0, seen: {}, round: newRound(), best: 0, rounds: 0 }; armed = false; save(); cur = null; render();
  }
});

// 填充題輸入框：按 Enter 送出
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "cloze") { e.preventDefault(); submitCloze(); }
});

// 勾選框：切換「只練易混淆字」
document.addEventListener("change", e => {
  if (e.target.id !== "nearOnly") return;
  nearOnly = e.target.checked;
  try { localStorage.setItem("vocabNearOnly", nearOnly ? "1" : "0"); } catch (err) {}
  // 剛勾選、而目前這題不是易混淆字題 → 馬上換一題；取消勾選則保留目前這題
  if (nearOnly && !(cur && cur.w.near)) next(); else render();
});

// 頁尾顯示目前載入的程式版本
if ($("#ver")) $("#ver").textContent = "版本 " + APP_VERSION;

// 讀取 words.json。直接雙擊 html 開啟時瀏覽器會擋下讀檔，要用本機伺服器
// cache: "no-cache" = 每次都向伺服器確認檔案有沒有更新，新增單字後不用強制重新整理
fetch("words.json", { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(data => { W = data; render(); })
  .catch(() => {
    $("#main").innerHTML = '<div class="card"><p>讀不到 words.json。請在專案資料夾執行 <code>npx serve</code> 或 <code>python -m http.server</code>，再用瀏覽器開啟網址。</p></div>';
  });
