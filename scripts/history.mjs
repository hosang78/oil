// 날짜별 가격 이력(최근 30일) 병합·정리·직렬화.
// 같은 날짜의 값은 새 값으로 덮어쓰고, 30일이 지난 값은 지운다.

export const KEEP_DAYS = 30;

export const SERIES = {
  oil_diesel: { label: '주유소 경유 전국 평균', unit: '원/L' },
  oil_gasoline: { label: '주유소 휘발유 전국 평균', unit: '원/L' },
  fx: { label: '원/달러 환율(매매기준율)', unit: '원' },
  brent: { label: '브렌트유', unit: 'USD/배럴' },
  wti: { label: 'WTI', unit: 'USD/배럴' },
  ny_diesel: { label: '뉴욕항 경유 현물', unit: 'USD/갤런' },
  ny_gasoline: { label: '뉴욕항 휘발유 현물', unit: 'USD/갤런' },
};

export function emptyHistory() {
  return { updatedAt: null, keepDays: KEEP_DAYS, series: {} };
}

const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

// 'YYYY-MM-DD'에서 n일 뺀 날짜
export function minusDays(dateStr, n) {
  const t = Date.parse(`${dateStr}T00:00:00Z`) - n * 86400e3;
  return new Date(t).toISOString().slice(0, 10);
}

// additions: { 시리즈키: [[날짜, 값], ...] }
// todayStr: 기준일(한국시간 'YYYY-MM-DD'). 반환: { hist, changed }
export function mergeHistory(prev, additions, todayStr, nowIso = new Date().toISOString()) {
  const before = serializeSeries(prev);
  const hist = {
    updatedAt: prev?.updatedAt ?? null,
    keepDays: KEEP_DAYS,
    series: structuredClone(prev?.series ?? {}),
  };
  const cutoff = minusDays(todayStr, KEEP_DAYS);

  for (const [key, pts] of Object.entries(additions)) {
    if (!SERIES[key]) continue;
    const s = (hist.series[key] ||= { ...SERIES[key], points: [] });
    const m = new Map(s.points);
    for (const [d, v] of pts) if (isDate(d) && Number.isFinite(v)) m.set(d, Math.round(v * 1e4) / 1e4);
    s.points = [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  for (const s of Object.values(hist.series)) s.points = s.points.filter(([d]) => d >= cutoff);

  const changed = before !== serializeSeries(hist);
  if (changed) hist.updatedAt = nowIso;
  return { hist, changed };
}

function serializeSeries(h) {
  return JSON.stringify(h?.series ?? {});
}

// 시리즈마다 한 줄 → 커밋 diff가 읽기 쉽다
export function serializeHistory(h) {
  const lines = Object.entries(h.series).map(([k, s]) => ` ${JSON.stringify(k)}:${JSON.stringify(s)}`);
  return `{\n"updatedAt":${JSON.stringify(h.updatedAt)},\n"keepDays":${h.keepDays},\n"series":{\n${lines.join(',\n')}\n}\n}\n`;
}
