// 무료 공공 API에서 유가·환율을 수집해 data.json으로 저장한다.
// GitHub Actions(서버)에서 실행되므로 브라우저 CORS 제한을 받지 않는다.
// 사용: node scripts/collect.mjs <출력경로>
import { writeFile } from 'node:fs/promises';

const OUT = process.argv[2] || 'site/data.json';
const KEY = {
  opinet: process.env.OPINET_KEY,
  eia: process.env.EIA_KEY,
  fred: process.env.FRED_KEY,
  ecos: process.env.ECOS_KEY,
  exim: process.env.EXIM_KEY,
};
const PREV_URL = process.env.PREV_URL; // 직전 배포본 — 수집 실패 시 마지막 성공값 유지

const L_PER_GAL = 3.785411784;

// 한국시간 기준 날짜 (YYYYMMDD), offset일 전
function kstDate(offset = 0) {
  const d = new Date(Date.now() + 9 * 3600e3 - offset * 86400e3);
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}
const dash = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);
const num = (v) => {
  const n = Number(String(v ?? '').replaceAll(',', '').trim());
  return Number.isFinite(n) && String(v).trim() !== '' && v !== '.' ? n : null;
};
const mask = (s) => {
  let t = String(s);
  for (const k of Object.values(KEY)) if (k) t = t.replaceAll(k, '***');
  return t;
};

async function getJson(url, { timeout = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'oil-price-demo/1.0' } });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`JSON 아님: ${text.slice(0, 160)}`);
    }
  } catch (e) {
    throw new Error(mask(e.name === 'AbortError' ? `응답 없음(${timeout / 1000}초 초과)` : e.cause?.code || e.message));
  } finally {
    clearTimeout(timer);
  }
}

// ── 오피넷: 전국 평균, 시도별 평균, 최근 7일 추이 ──
const OPINET = 'https://www.opinet.co.kr/api';
const PROD = { gasoline: 'B027', diesel: 'D047' };

async function opinet() {
  if (!KEY.opinet) throw new Error('OPINET_KEY 없음');
  const q = `out=json&code=${KEY.opinet}`;
  const all = await getJson(`${OPINET}/avgAllPrice.do?${q}`);
  const rows = all?.RESULT?.OIL;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`응답 형식 오류: ${JSON.stringify(all).slice(0, 160)}`);
  const out = { date: null, national: {}, sido: {}, recent: {} };
  for (const [k, cd] of Object.entries(PROD)) {
    const r = rows.find((x) => x.PRODCD === cd);
    if (r) out.national[k] = { price: num(r.PRICE), diff: num(r.DIFF), name: r.PRODNM };
    out.date ||= dash(r?.TRADE_DT);
  }
  for (const [k, cd] of Object.entries(PROD)) {
    try {
      const s = await getJson(`${OPINET}/avgSidoPrice.do?${q}&prodcd=${cd}`);
      out.sido[k] = (s?.RESULT?.OIL || []).map((x) => ({ code: x.SIDOCD, name: x.SIDONM, price: num(x.PRICE), diff: num(x.DIFF) }));
    } catch (e) {
      console.warn(`  오피넷 시도별(${k}) 실패: ${e.message}`);
    }
    try {
      const r = await getJson(`${OPINET}/avgRecentPrice.do?${q}&prodcd=${cd}`);
      out.recent[k] = (r?.RESULT?.OIL || [])
        .map((x) => ({ date: dash(x.DATE), price: num(x.PRICE) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) {
      console.warn(`  오피넷 7일추이(${k}) 실패: ${e.message}`);
    }
  }
  return out;
}

// ── 국제가격: EIA(주), FRED(보조 + 두바이) ──
const EIA_SERIES = {
  brent: 'RBRTE',
  wti: 'RWTC',
  diesel: 'EER_EPD2DXL0_PF4_Y35NY_DPG', // 뉴욕항 초저유황경유 USD/gal
  gasoline: 'EER_EPMRU_PF4_Y35NY_DPG', // 뉴욕항 일반휘발유 USD/gal
};
const FRED_SERIES = {
  brent: 'DCOILBRENTEU',
  wti: 'DCOILWTICO',
  diesel: 'DDFUELNYH',
  gasoline: 'DGASNYH',
  dubai: 'POILDUBUSDM', // 월간
};
const UNIT = { brent: 'USD/배럴', wti: 'USD/배럴', dubai: 'USD/배럴', diesel: 'USD/갤런', gasoline: 'USD/갤런' };

async function eia() {
  if (!KEY.eia) throw new Error('EIA_KEY 없음');
  const p = new URLSearchParams({ api_key: KEY.eia, frequency: 'daily', 'data[0]': 'value', 'sort[0][column]': 'period', 'sort[0][direction]': 'desc', length: '200' });
  for (const s of Object.values(EIA_SERIES)) p.append('facets[series][]', s);
  const j = await getJson(`https://api.eia.gov/v2/petroleum/pri/spt/data/?${p}`);
  const rows = j?.response?.data;
  if (!Array.isArray(rows)) throw new Error(`응답 형식 오류: ${JSON.stringify(j).slice(0, 160)}`);
  const out = {};
  for (const [k, id] of Object.entries(EIA_SERIES)) {
    const r = rows.filter((x) => x.series === id && num(x.value) !== null);
    if (r.length) out[k] = { value: num(r[0].value), date: r[0].period, unit: UNIT[k], source: 'EIA', history: r.slice(0, 10).map((x) => ({ date: x.period, value: num(x.value) })).reverse() };
  }
  return out;
}

async function fredOne(id) {
  const j = await getJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${KEY.fred}&file_type=json&sort_order=desc&limit=15`);
  const obs = (j?.observations || []).filter((o) => num(o.value) !== null);
  if (!obs.length) throw new Error(`${id} 값 없음`);
  return { value: num(obs[0].value), date: obs[0].date, history: obs.slice(0, 10).map((o) => ({ date: o.date, value: num(o.value) })).reverse() };
}

async function fred() {
  if (!KEY.fred) throw new Error('FRED_KEY 없음');
  const out = {};
  const errs = [];
  for (const [k, id] of Object.entries(FRED_SERIES)) {
    try {
      out[k] = { ...(await fredOne(id)), unit: UNIT[k], source: 'FRED' };
    } catch (e) {
      errs.push(`${k}: ${e.message}`);
    }
  }
  if (!Object.keys(out).length) throw new Error(errs.join(' / '));
  return out;
}

// ── 환율: 한국은행 ECOS(주), 수출입은행(보조) ──
async function ecos() {
  if (!KEY.ecos) throw new Error('ECOS_KEY 없음');
  const j = await getJson(`https://ecos.bok.or.kr/api/StatisticSearch/${KEY.ecos}/json/kr/1/30/731Y001/D/${kstDate(20)}/${kstDate(0)}/0000001`);
  const rows = j?.StatisticSearch?.row;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`응답 형식 오류: ${JSON.stringify(j).slice(0, 160)}`);
  const last = rows[rows.length - 1];
  return { value: num(last.DATA_VALUE), date: dash(last.TIME), source: '한국은행 ECOS', label: '원/달러 매매기준율' };
}

async function exim() {
  if (!KEY.exim) throw new Error('EXIM_KEY 없음');
  for (let i = 0; i < 8; i++) {
    const d = kstDate(i);
    let j;
    try {
      j = await getJson(`https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${KEY.exim}&searchdate=${d}&data=AP01`);
    } catch {
      j = await getJson(`https://www.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${KEY.exim}&searchdate=${d}&data=AP01`);
    }
    const usd = Array.isArray(j) ? j.find((x) => x.cur_unit === 'USD') : null;
    if (usd && num(usd.deal_bas_r)) return { value: num(usd.deal_bas_r), date: dash(d), source: '한국수출입은행', label: '원/달러 매매기준율' };
  }
  throw new Error('최근 8일 USD 환율 없음');
}

// ── 실행 ──
async function attempt(name, fn) {
  const t = Date.now();
  try {
    const data = await fn();
    console.log(`✔ ${name} (${Date.now() - t}ms)`);
    return { ok: true, data };
  } catch (e) {
    console.log(`✘ ${name}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

const now = new Date();
const status = [];
const mark = (name, r, extra = '') => status.push({ name, ok: r.ok, message: r.ok ? extra || '정상' : r.error, at: now.toISOString() });

let prev = null;
if (PREV_URL) {
  try {
    prev = await getJson(`${PREV_URL}?t=${Date.now()}`, { timeout: 15000 });
  } catch {
    prev = null;
  }
}

const rOp = await attempt('오피넷', opinet);
const rEia = await attempt('EIA', eia);
const rFred = await attempt('FRED', fred);
const rEcos = await attempt('한국은행 ECOS', ecos);
const rExim = await attempt('한국수출입은행', exim);
mark('오피넷', rOp, rOp.ok ? `기준일 ${rOp.data.date}` : '');
mark('EIA', rEia);
mark('FRED', rFred);
mark('한국은행 ECOS', rEcos, rEcos.ok ? `기준일 ${rEcos.data.date}` : '');
mark('한국수출입은행', rExim, rExim.ok ? `기준일 ${rExim.data.date}` : '');

// 국제가격: 항목별로 EIA 우선, 없으면 FRED. 더 최신 날짜를 고른다.
const intl = {};
for (const k of ['brent', 'wti', 'dubai', 'diesel', 'gasoline']) {
  const a = rEia.ok ? rEia.data[k] : null;
  const b = rFred.ok ? rFred.data[k] : null;
  const pick = a && b ? (b.date > a.date ? b : a) : a || b;
  if (pick) intl[k] = pick;
  else if (prev?.intl?.[k]) intl[k] = { ...prev.intl[k], stale: true };
}

let fx = rEcos.ok && rEcos.data.value ? rEcos.data : null;
if (rExim.ok && (!fx || rExim.data.date > fx.date)) fx = rExim.data;
if (!fx && prev?.fx) fx = { ...prev.fx, stale: true };

let op = rOp.ok ? rOp.data : prev?.opinet ? { ...prev.opinet, stale: true } : null;

const kst = new Date(now.getTime() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
const data = {
  updatedAt: now.toISOString(),
  updatedAtKst: kst,
  opinet: op,
  intl,
  fx,
  conv: { litersPerGallon: L_PER_GAL, litersPerDrum: 200 },
  status,
};

await writeFile(OUT, JSON.stringify(data, null, 1));
console.log(`\n저장: ${OUT} (${kst} KST)`);
console.log(JSON.stringify({ opinet: op && { date: op.date, national: op.national, stale: op.stale }, fx, intl: Object.fromEntries(Object.entries(intl).map(([k, v]) => [k, `${v.value} ${v.unit} ${v.date} ${v.source}${v.stale ? ' (이전값)' : ''}`])) }, null, 1));
