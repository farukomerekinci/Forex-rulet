/* ================= Forex Rulet - oyun motoru ================= */
(function () {
'use strict';

/* ---------------- ayarlar ---------------- */
const START_EUR   = 100;   // baslangic sermayesi (euro)
const PEEKS       = 3;     // oyun basina kur kontrolu hakki
const WHEEL_SLOTS = 10;    // ruletteki dilim sayisi
const BLIND_STEP  = 4;     // kac turda bir masa ucreti ikiye katlanir
const MAX_ROUNDS  = 150;   // guvenlik siniri: masa bu turda kapanir
const MAX_SCORES  = 15;

const LS = { scores: 'fr_scores_v2', players: 'fr_players_v2', sound: 'fr_sound_v2', mode: 'fr_mode_v2' };

/* ---------------- kisa yollar ---------------- */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function store(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

/* Box-Muller: standart normal dagilim */
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------------- sayi bicimlendirme ---------------- */
function decimalsOf(cur) {
  if (cur.d != null) return cur.d;
  if (cur.r >= 100) return 0;
  return 2;
}
function fmt(amount, cur) {
  const d = decimalsOf(cur);
  if (!isFinite(amount)) return '∞';
  if (Math.abs(amount) >= 1e15) {
    return new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 2 }).format(amount);
  }
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(amount);
}
function fmtEur(v) {
  const d = Math.abs(v) >= 1000 ? 0 : 2;
  if (Math.abs(v) >= 1e12) return new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 2 }).format(v) + ' €';
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + ' €';
}
/** " ≈ 12,34 €" eki; zaten euro tutuluyorsa bos doner. */
function eurTag(amount, cur) {
  return cur.c === 'EUR' ? '' : ' ≈ ' + fmtEur(amount / cur.r);
}
function roundTo(amount, cur) {
  const p = Math.pow(10, decimalsOf(cur));
  return Math.round(amount * p) / p;
}

/* ---------------- ses ---------------- */
const Sound = {
  on: store(LS.sound, true),
  ctx: null,
  wake() {
    if (!this.on) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.on = false; return null; }
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  blip(freq, dur, type, vol) {
    const ctx = this.wake();
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(vol == null ? 0.05 : vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  },
  tick() { this.blip(880 + Math.random() * 120, 0.035, 'square', 0.035); },
  good() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'triangle', 0.07), i * 80)); },
  bad()  { [392, 330, 262].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'sawtooth', 0.055), i * 110)); },
  flat() { this.blip(440, 0.12, 'triangle', 0.05); },
  bust() { [330, 294, 247, 196, 147].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'sawtooth', 0.06), i * 150)); }
};

/* ---------------- ekran yonetimi ---------------- */
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ================= RULET ================= */
const Wheel = {
  canvas: null, ctx: null, list: [], rot: 0, spinning: false,
  restAngle() { return -Math.PI / 2 - Math.PI / WHEEL_SLOTS; },
  init() {
    this.canvas = $('#wheel');
    this.ctx = this.canvas.getContext('2d');
    this.rot = this.restAngle();
    this.list = sampleCurrencies(WHEEL_SLOTS, null, 1);
    this.draw();
  },
  tierFill(t, i) {
    const base = { 1: [24, 62, 48], 2: [22, 48, 78], 3: [72, 58, 22], 4: [80, 30, 34] }[t] || [30, 40, 52];
    const k = i % 2 ? 1 : 0.68;
    return `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
  },
  tierInk(t) { return { 1: '#7ef0bd', 2: '#8ec9f5', 3: '#f3d68c', 4: '#ff9d9d' }[t] || '#c8d6e6'; },
  draw() {
    const ctx = this.ctx, W = this.canvas.width, C = W / 2, R = C - 6;
    const n = this.list.length, step = (Math.PI * 2) / n;
    ctx.clearRect(0, 0, W, W);

    for (let i = 0; i < n; i++) {
      const cur = this.list[i];
      const a0 = this.rot + i * step, a1 = a0 + step;
      ctx.beginPath();
      ctx.moveTo(C, C);
      ctx.arc(C, C, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = this.tierFill(cur.t, i);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // etiket: sol yarida bas asagi durmasin diye 180° cevrilir
      const mid = a0 + step / 2;
      const flip = Math.cos(mid) < 0;
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(flip ? mid + Math.PI : mid);
      ctx.textAlign = flip ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.tierInk(cur.t);
      ctx.font = 'bold 34px ui-monospace, Menlo, monospace';
      ctx.fillText(cur.c, flip ? -(R - 22) : R - 22, 0);
      ctx.restore();
    }
    // dis cember
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#e8c15a';
    ctx.lineWidth = 5;
    ctx.stroke();
  },
  /** pointer (tepe) altindaki dilim indeksi */
  indexAtPointer() {
    const n = this.list.length, step = (Math.PI * 2) / n;
    let a = (-Math.PI / 2 - this.rot) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return Math.floor(a / step) % n;
  },
  /** verilen indekse yumusak inisle don */
  spinTo(index, done) {
    if (this.spinning) return;
    this.spinning = true;
    const n = this.list.length, step = (Math.PI * 2) / n;
    const target = -Math.PI / 2 - (index + 0.5) * step;
    const from = this.rot;
    // en az 5 tam tur ileri gitsin
    let delta = target - from;
    delta -= Math.floor(delta / (Math.PI * 2)) * (Math.PI * 2); // 0..2π
    delta += Math.PI * 2 * (5 + Math.floor(Math.random() * 2));
    const dur = 3200 + Math.random() * 500;
    const t0 = performance.now();
    let lastIdx = this.indexAtPointer();

    const frame = (now) => {
      const p = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 4);          // easeOutQuart
      this.rot = from + delta * e;
      this.draw();
      const idx = this.indexAtPointer();
      if (idx !== lastIdx) { lastIdx = idx; Sound.tick(); }
      if (p < 1) requestAnimationFrame(frame);
      else { this.rot = target; this.draw(); this.spinning = false; done && done(); }
    };
    requestAnimationFrame(frame);
  }
};

/* ================= para birimi secimi ================= */
/** Tur ilerledikce egzotik para birimlerinin agirligi artar. */
function tierWeight(t, round) {
  switch (t) {
    case 1: return Math.max(0.8, 6 - round * 0.30);
    case 2: return Math.max(1.2, 4.5 - round * 0.10);
    case 3: return 2.2 + round * 0.16;
    case 4: return 0.5 + round * 0.26;
    default: return 1;
  }
}
function weightedPick(pool, round) {
  let total = 0;
  for (const c of pool) total += tierWeight(c.t, round);
  let r = Math.random() * total;
  for (const c of pool) {
    r -= tierWeight(c.t, round);
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}
/** n adet farkli para birimi ornekle (exclude kodunu disla). */
function sampleCurrencies(n, excludeCode, round) {
  const pool = CURRENCIES.filter((c) => c.c !== excludeCode);
  const out = [];
  const used = new Set();
  let guard = 0;
  while (out.length < n && guard++ < n * 60) {
    const c = weightedPick(pool, round);
    if (used.has(c.c)) continue;
    used.add(c.c);
    out.push(c);
  }
  return out;
}

/* ================= teklif uretimi ================= */
const RUMOR_GOOD = [
  'Kambiyocunun eli titriyor.',
  'Komisyoncu bu takası pek istemiyor gibi.',
  'Arka masadan onaylayan bir fısıltı geldi.',
  'Adam teklifi söylerken boğazını temizledi.'
];
const RUMOR_BAD = [
  'Kambiyocu fazla istekli.',
  'Komisyoncu gülümsüyor. Hiç iyiye işaret değil.',
  'Arka masada birileri kahkahayı bastırdı.',
  'Teklif ağzından çok rahat çıktı.'
];
const RUMOR_ACCURACY = 0.68;

function makeOffer(target, eurValue) {
  const info = TIER_INFO[target.t];
  const z = clamp(gauss(), -2.6, 2.6);
  // log-normal: medyan kademeye gore biraz kurun altinda, kuyruklar egzotiklestikce genisler
  const m = info.med * Math.exp(info.spread * z);
  const fair = eurValue * target.r;
  const receive = Math.max(roundTo(fair * m, target), 0);

  // Kulis: %68 dogru, %32 yaniltici bir sinyal
  let hintsGood = m >= 1;
  if (Math.random() > RUMOR_ACCURACY) hintsGood = !hintsGood;
  const bag = hintsGood ? RUMOR_GOOD : RUMOR_BAD;
  const rumor = bag[Math.floor(Math.random() * bag.length)];

  return { target: target, m: m, fair: fair, receive: receive, rumor: rumor };
}

const VERDICTS = [
  { min: 1.35, tag: 'KELEPİR!',    cls: 'v-steal', txt: 'Piyasa kurunun epey üstünde bir kâğıt.' },
  { min: 1.10, tag: 'İYİ TEKLİF',  cls: 'v-good',  txt: 'Kurun bir tık üzerinde, kârlı bir takas.' },
  { min: 0.93, tag: 'PİYASA KURU', cls: 'v-fair',  txt: 'Neredeyse tam kurundan. Ne kâr ne zarar.' },
  { min: 0.78, tag: 'KÖTÜ TEKLİF', cls: 'v-bad',   txt: 'Kurun altında. Bu takasta bir miktar erirsin.' },
  { min: -1,   tag: 'KAZIK!',      cls: 'v-scam',  txt: 'Düz kazık. Paranın ciddi bir kısmı buharlaşır.' }
];
function verdictOf(m) { return VERDICTS.find((v) => m >= v.min); }

/* ================= masa ucreti ================= */
function anteEur(round, mode, eurValue) {
  const level = Math.floor((round - 1) / BLIND_STEP);
  const mult = Math.pow(2, level);
  if (mode === 'rake') return eurValue * 0.01 * mult;
  return 1 * mult;
}

/* ================= oyun durumu ================= */
const App = {
  players: store(LS.players, []),
  mode: store(LS.mode, 'blind'),
  queue: [],
  results: [],
  g: null       // aktif oyun
};

function newGame(name) {
  return {
    name: name,
    mode: App.mode,
    cur: EUR,
    amt: START_EUR,
    round: 0,
    peeks: PEEKS,
    trades: 0,
    bestTrade: 1,
    exotic: 0,
    peak: { eur: START_EUR, code: EUR.c, amount: START_EUR, cur: EUR, round: 0 },
    log: [],
    offer: null,
    phase: 'idle'
  };
}
function eurValue(g) { return g.amt / g.cur.r; }
function touchPeak(g) {
  const v = eurValue(g);
  if (v > g.peak.eur) g.peak = { eur: v, code: g.cur.c, amount: g.amt, cur: g.cur, round: g.round };
}

/* ---------------- log ---------------- */
function pushLog(g, round, cls, text, eur) {
  g.log.push({ round: round, cls: cls, text: text, eur: eur });
  renderLog();
}
function renderLog() {
  const ul = $('#log');
  const g = App.g;
  ul.innerHTML = '';
  if (!g || !g.log.length) { ul.appendChild(el('li', 'log-empty', 'Henüz hamle yok.')); return; }
  for (let i = g.log.length - 1; i >= 0; i--) {
    const e = g.log[i];
    const li = el('li');
    li.appendChild(el('span', 't', 'T' + e.round));
    li.appendChild(el('span', e.cls, e.text));
    ul.appendChild(li);
  }
}

/* ================= HUD ================= */
function renderHud(flash) {
  const g = App.g;
  $('#hud-player').textContent = g.name;
  $('#hud-round').textContent = 'Tur ' + Math.max(1, g.round);
  $('#wallet-amount').textContent = fmt(g.amt, g.cur);
  $('#wallet-cur').textContent = g.cur.f + ' ' + g.cur.c + ' · ' + g.cur.n;

  const wEur = $('#wallet-eur');
  wEur.textContent = '≈ ' + fmtEur(eurValue(g));
  wEur.classList.toggle('ghost', g.cur.c === 'EUR');   // yer korunur, tekrar gorunmez

  const anteE = anteEur(g.round + 1, g.mode, eurValue(g));
  const ante = anteE * g.cur.r;
  $('#hud-ante').textContent = 'Ücret: ' + fmt(ante, g.cur) + ' ' + g.cur.c + eurTag(ante, g.cur);
  $('#hud-peeks').textContent = 'Kur kontrolü: ' + g.peeks;

  const w = document.querySelector('.wallet');
  w.classList.remove('flash-up', 'flash-down');
  if (flash) { void w.offsetWidth; w.classList.add(flash === 'up' ? 'flash-up' : 'flash-down'); }
}

/* ================= tur akisi ================= */
function startRound() {
  const g = App.g;
  g.round += 1;
  g.offer = null;

  if (g.round > MAX_ROUNDS) {
    pushLog(g, g.round - 1, 'neutral', 'masa kapandı');
    return gameOver('Masa kapandı, kasa ışığı söndürdü');
  }

  const ante = anteEur(g.round, g.mode, eurValue(g));
  const anteCur = roundTo(ante * g.cur.r, g.cur);

  if (anteCur >= g.amt) {
    pushLog(g, g.round, 'down', 'masa ücretini ödeyemedin');
    return gameOver('Masa ücretini ödeyemedin');
  }
  g.amt = roundTo(g.amt - anteCur, g.cur);
  pushLog(g, g.round, 'down',
    'masa ücreti −' + fmt(anteCur, g.cur) + ' ' + g.cur.c + eurTag(anteCur, g.cur));

  if (eurValue(g) < 1) {
    return gameOver('Cebinde 1 euro bile kalmadı');
  }

  g.phase = 'ready';
  renderHud('down');

  document.querySelector('.wheel-wrap').classList.remove('compact');
  Wheel.list = sampleCurrencies(WHEEL_SLOTS, g.cur.c, g.round);
  Wheel.draw();

  const hub = $('#wheel-hub');
  hub.textContent = 'ÇEVİR';
  hub.className = 'wheel-hub';

  $('#stage').innerHTML = '';
  const s = el('div', 'verdict');
  s.appendChild(el('p', 'verdict-tag v-fair', 'TUR ' + g.round));
  s.appendChild(el('p', 'verdict-text', 'Ruleti çevir, sana bir takas teklifi gelsin.'));
  $('#stage').appendChild(s);

  const acts = $('#actions');
  acts.innerHTML = '';
  const b = el('button', 'btn btn-primary btn-xl', 'RULETİ ÇEVİR');
  b.addEventListener('click', doSpin);
  acts.appendChild(b);
}

function doSpin() {
  const g = App.g;
  if (g.phase !== 'ready' || Wheel.spinning) return;
  g.phase = 'spinning';
  Sound.wake();

  const winner = weightedPick(Wheel.list, g.round);
  const idx = Wheel.list.findIndex((c) => c.c === winner.c);

  const hub = $('#wheel-hub');
  hub.textContent = '···';
  hub.className = 'wheel-hub spinning';
  $('#actions').innerHTML = '';
  $('#stage').innerHTML = '';

  Wheel.spinTo(idx, () => {
    const target = Wheel.list[Wheel.indexAtPointer()];
    g.offer = makeOffer(target, eurValue(g));
    g.phase = 'offer';
    hub.textContent = target.c;
    hub.className = 'wheel-hub locked';
    document.querySelector('.wheel-wrap').classList.add('compact');
    renderOffer();
    requestAnimationFrame(() => {
      const card = document.querySelector('#stage .offer');
      if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  });
}

function renderOffer(peeked) {
  const g = App.g, o = g.offer, t = o.target, info = TIER_INFO[t.t];
  const stage = $('#stage');
  stage.innerHTML = '';

  const card = el('div', 'offer');
  card.appendChild(el('p', 'offer-kicker', 'Takas teklifi'));
  card.appendChild(el('div', 'offer-flag', t.f));
  const cur = el('div', 'offer-cur', t.c);
  cur.appendChild(el('small', null, t.n));
  card.appendChild(cur);
  card.appendChild(el('div', 'offer-amount', fmt(o.receive, t)));
  card.appendChild(el('div', 'offer-vs',
    'karşılığında: ' + fmt(g.amt, g.cur) + ' ' + g.cur.c + eurTag(g.amt, g.cur)));
  card.appendChild(el('span', 'risk ' + info.cls, info.label));

  const rum = el('div', 'rumor');
  rum.appendChild(el('span', 'rumor-tag', 'KULİS'));
  rum.appendChild(el('span', null, o.rumor));
  card.appendChild(rum);

  if (peeked) {
    const p = el('div', 'peek');
    const diff = o.receive / t.r - eurValue(g);
    p.innerHTML =
      'Teklifin değeri: <b>' + fmtEur(o.receive / t.r) + '</b><br>' +
      'Elindekine göre: <b>' + (diff >= 0 ? '+' : '−') + fmtEur(Math.abs(diff)) + '</b><br>' +
      'Piyasa kuru: 1 € = ' + fmt(t.r, t) + ' ' + t.c;
    card.appendChild(p);
  }
  stage.appendChild(card);

  const acts = $('#actions');
  acts.innerHTML = '';
  const duo = el('div', 'duo');
  const yes = el('button', 'btn btn-yes', 'KABUL');
  const no = el('button', 'btn btn-no', 'PAS');
  yes.addEventListener('click', () => decide(true));
  no.addEventListener('click', () => decide(false));
  duo.appendChild(yes); duo.appendChild(no);
  acts.appendChild(duo);

  if (!peeked && g.peeks > 0) {
    const pk = el('button', 'btn btn-ghost', 'Kur kontrolü yap (' + g.peeks + ' hak)');
    pk.addEventListener('click', () => {
      if (App.g.peeks <= 0) return;
      App.g.peeks -= 1;
      Sound.flat();
      renderHud();
      renderOffer(true);
    });
    acts.appendChild(pk);
  }
}

function decide(accept) {
  const g = App.g;
  if (g.phase !== 'offer') return;
  g.phase = 'resolved';
  const o = g.offer, t = o.target, v = verdictOf(o.m);
  const from = g.cur;

  if (accept) {
    g.cur = t;
    g.amt = o.receive;
    g.trades += 1;
    if (o.m > g.bestTrade) g.bestTrade = o.m;
    if (t.t >= 4) g.exotic += 1;
    touchPeak(g);
    const up = o.m >= 1;
    pushLog(g, g.round, up ? 'up' : 'down',
      from.c + ' → ' + t.c + '  ' + v.tag.replace('!', '') + '  · ' + fmtEur(eurValue(g)));
    renderHud(up ? 'up' : 'down');
    if (o.m >= 1.10) Sound.good(); else if (o.m < 0.93) Sound.bad(); else Sound.flat();
  } else {
    pushLog(g, g.round, 'neutral', 'pas · ' + t.c + '  (' + v.tag.replace('!', '') + ')');
    Sound.flat();
    renderHud();
  }

  // sonuc karti
  const stage = $('#stage');
  stage.innerHTML = '';
  const card = el('div', 'verdict');
  card.appendChild(el('p', 'verdict-tag ' + v.cls, v.tag));
  const lead = accept
    ? 'Paran artık ' + t.f + ' ' + t.c + '. '
    : 'Pas geçtin, ' + from.f + ' ' + from.c + ' elinde kaldı. ';
  card.appendChild(el('p', 'verdict-text', lead + v.txt));
  stage.appendChild(card);

  const acts = $('#actions');
  acts.innerHTML = '';
  const next = el('button', 'btn btn-primary btn-xl', 'SONRAKİ TUR');
  next.addEventListener('click', startRound);
  acts.appendChild(next);
}

/* ================= oyun sonu ================= */
function gameOver(reason) {
  const g = App.g;
  Sound.bust();

  const rec = {
    name: g.name,
    eur: g.peak.eur,
    code: g.peak.code,
    amount: g.peak.amount,
    cur: g.peak.cur,
    rounds: g.round,
    trades: g.trades,
    mode: g.mode,
    date: Date.now()
  };
  App.results.push(rec);
  saveScore(rec);

  $('#over-reason').textContent = reason;
  $('#over-name').textContent = g.name;
  $('#over-peak-amount').textContent = fmt(g.peak.amount, g.peak.cur);
  $('#over-peak-cur').textContent = g.peak.cur.f + ' ' + g.peak.code + ' · ' + g.peak.cur.n;
  $('#over-peak-eur').textContent = '≈ ' + fmtEur(g.peak.eur);

  const badges = $('#over-badges');
  badges.innerHTML = '';
  const add = (txt, hot) => badges.appendChild(el('span', 'badge' + (hot ? ' hot' : ''), txt));
  add(g.round + ' tur dayandın');
  add(g.trades + ' takas');
  if (g.bestTrade > 1.01) add('En iyi takas ×' + g.bestTrade.toFixed(2), g.bestTrade >= 1.5);
  if (g.exotic > 0) add(g.exotic + ' çılgın kâğıt', true);
  add(g.mode === 'rake' ? 'Komisyon masası' : 'Körleme masası');

  const gain = g.peak.eur / START_EUR;
  $('#over-note').textContent =
    gain >= 3 ? 'Efsanevi. Sermayeni ' + gain.toFixed(1) + ' katına çıkardın.' :
    gain >= 1.5 ? 'İyi iş. Sermayeni ' + gain.toFixed(2) + ' katına çıkardın.' :
    gain > 1.0 ? 'Ucu ucuna kâr ettin: ×' + gain.toFixed(2) + '.' :
    '100 euronun üstüne hiç çıkamadın. Kurları çalışmanın vakti geldi.';

  // karne
  const ul = $('#over-log');
  ul.innerHTML = '';
  for (const e of g.log) {
    const li = el('li');
    li.appendChild(el('span', 't', 'T' + e.round));
    li.appendChild(el('span', e.cls, e.text));
    ul.appendChild(li);
  }
  const peakLi = el('li');
  peakLi.appendChild(el('span', 't', '★'));
  peakLi.appendChild(el('span', 'peak', 'zirve: ' + fmt(g.peak.amount, g.peak.cur) + ' ' + g.peak.code + '  ≈ ' + fmtEur(g.peak.eur)));
  ul.appendChild(peakLi);

  const more = App.queue.length > 0;
  $('#btn-over-next').textContent = more ? 'SIRADAKİ OYUNCU' : (App.results.length > 1 ? 'TURNUVA SONUCU' : 'BİTİR');
  show('screen-over');
}

/* ================= skor tablosu ================= */
function saveScore(rec) {
  const list = store(LS.scores, []);
  list.push({ name: rec.name, eur: rec.eur, code: rec.code, amount: rec.amount, rounds: rec.rounds, mode: rec.mode, date: rec.date });
  list.sort((a, b) => (b.eur - a.eur) || (b.rounds - a.rounds));
  save(LS.scores, list.slice(0, MAX_SCORES));
  renderScoreboard();
}
function renderScoreboard() {
  const list = store(LS.scores, []);
  const ol = $('#scoreboard');
  ol.innerHTML = '';
  $('#scoreboard-empty').style.display = list.length ? 'none' : 'block';
  for (const s of list) {
    const cur = CUR_BY_CODE[s.code] || EUR;
    const li = el('li');
    const main = el('div', 'sb-main');
    main.appendChild(el('div', 'sb-name', s.name));
    main.appendChild(el('div', 'sb-sub', cur.f + ' ' + fmt(s.amount, cur) + ' ' + s.code + ' · ' + s.rounds + ' tur'));
    li.appendChild(main);
    li.appendChild(el('div', 'sb-eur', fmtEur(s.eur)));
    ol.appendChild(li);
  }
}

/* ================= turnuva ================= */
function renderTournament() {
  const ol = $('#tournament-list');
  ol.innerHTML = '';
  const sorted = App.results.slice().sort((a, b) => (b.eur - a.eur) || (b.rounds - a.rounds));
  for (const r of sorted) {
    const li = el('li');
    const main = el('div', 'sb-main');
    main.appendChild(el('div', 'sb-name', r.name));
    main.appendChild(el('div', 'sb-sub', r.cur.f + ' ' + fmt(r.amount, r.cur) + ' ' + r.code + ' · ' + r.rounds + ' tur'));
    li.appendChild(main);
    li.appendChild(el('div', 'sb-eur', fmtEur(r.eur)));
    ol.appendChild(li);
  }
  show('screen-tournament');
}

/* ================= oyuncu yonetimi ================= */
function renderPlayers() {
  const ul = $('#player-list');
  ul.innerHTML = '';
  $('#player-empty').style.display = App.players.length ? 'none' : 'block';
  App.players.forEach((name, i) => {
    const li = el('li', null, name);
    const x = el('button', 'x', '×');
    x.setAttribute('aria-label', name + ' oyuncusunu sil');
    x.addEventListener('click', () => {
      App.players.splice(i, 1);
      save(LS.players, App.players);
      renderPlayers();
    });
    li.appendChild(x);
    ul.appendChild(li);
  });
  $('#btn-start').disabled = App.players.length === 0;
  $('#btn-start').textContent = App.players.length > 1 ? 'TURNUVAYI BAŞLAT' : 'MASAYA OTUR';
}

function addPlayer(raw) {
  const name = (raw || '').trim().replace(/\s+/g, ' ').slice(0, 14);
  if (!name) return false;
  if (App.players.length >= 8) return false;
  if (App.players.some((p) => p.toLowerCase() === name.toLowerCase())) return false;
  App.players.push(name);
  save(LS.players, App.players);
  renderPlayers();
  return true;
}

/* ================= akis ================= */
function startSession() {
  App.queue = App.players.slice();
  App.results = [];
  nextPlayer();
}
function nextPlayer() {
  if (!App.queue.length) {
    if (App.results.length > 1) renderTournament(); else show('screen-home');
    return;
  }
  const name = App.queue.shift();
  App.g = newGame(name);
  if (App.players.length > 1) {
    $('#pass-name').textContent = name;
    const idx = App.players.indexOf(name) + 1;
    $('#pass-sub').textContent = 'Telefonu ' + name + ' oyuncusuna ver · ' + idx + '/' + App.players.length;
    show('screen-pass');
  } else {
    beginRun();
  }
}
function beginRun() {
  renderHud();
  renderLog();
  Wheel.rot = Wheel.restAngle();
  show('screen-game');
  startRound();
}

/* ================= baglantilar ================= */
function bind() {
  $('#player-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#player-input');
    if (addPlayer(input.value)) input.value = '';
    input.focus();
  });

  document.querySelectorAll('#mode-picker .mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      App.mode = btn.dataset.mode;
      save(LS.mode, App.mode);
      document.querySelectorAll('#mode-picker .mode').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      });
    });
  });

  $('#btn-start').addEventListener('click', () => { Sound.wake(); startSession(); });
  $('#btn-pass-go').addEventListener('click', beginRun);
  $('#wheel-hub').addEventListener('click', () => { if (App.g && App.g.phase === 'ready') doSpin(); });

  $('#btn-over-next').addEventListener('click', nextPlayer);
  $('#btn-over-home').addEventListener('click', () => { App.queue = []; App.results = []; show('screen-home'); });
  $('#btn-tour-again').addEventListener('click', startSession);
  $('#btn-tour-home').addEventListener('click', () => show('screen-home'));

  $('#btn-clear-scores').addEventListener('click', () => {
    if (!store(LS.scores, []).length) return;
    if (confirm('Tüm rekorlar silinsin mi?')) { save(LS.scores, []); renderScoreboard(); }
  });

  const sb = $('#btn-sound');
  const paintSound = () => {
    sb.textContent = 'Ses: ' + (Sound.on ? 'açık' : 'kapalı');
    sb.setAttribute('aria-pressed', String(Sound.on));
  };
  sb.addEventListener('click', () => { Sound.on = !Sound.on; save(LS.sound, Sound.on); paintSound(); if (Sound.on) Sound.flat(); });
  paintSound();
}

/* ================= baslat ================= */
function init() {
  Wheel.init();
  bind();
  renderPlayers();
  renderScoreboard();
  document.querySelectorAll('#mode-picker .mode').forEach((b) => {
    const on = b.dataset.mode === App.mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
}
document.addEventListener('DOMContentLoaded', init);

})();
