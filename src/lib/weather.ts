// ---------------------------------------------------------------------------
// 오늘의 러닝 컨디션 — 날씨 + 미세먼지 + 러닝 적합도 + 복장 추천
// Open-Meteo (키 불필요) 사용, 실패 시 샘플로 폴백.
// ---------------------------------------------------------------------------

import { fetchWithTimeout } from './fetchTimeout';
import type { LatLng } from './types';

export type AqiLevel = 'good' | 'moderate' | 'bad' | 'verybad';

/**
 * 더위 위험도. 한국 여름은 습도가 높아 기온보다 체감이 훨씬 세다 —
 * 체감온도(apparent_temperature)와 자외선을 같이 본다.
 */
export type HeatRisk = 'none' | 'caution' | 'danger';

/** 앞으로 몇 시간 안에 '지금보다 확실히 나은' 시간대 */
export interface BetterHour {
  /** 24시간제 (로컬) */
  hour: number;
  feelsC: number;
  uvIndex: number;
  rainPct: number;
  /** 몇 시간 뒤인지 */
  inHours: number;
}

export interface RunConditions {
  tempC: number;
  feelsC: number;
  humidity: number;
  windKmh: number;
  precipMm: number;
  condition: string;
  emoji: string;
  pm25: number;
  pm10: number;
  aqiLevel: AqiLevel;
  aqiLabel: string;
  runScore: number; // 0~100 러닝 적합도
  headline: string;
  outfit: string;
  source: 'live' | 'sample';
  /** 자외선 지수 (0~11+). 폴백이면 추정치 */
  uvIndex: number;
  heatRisk: HeatRisk;
  /** 더울 때 '몇 시에 뛰는 게 낫다' — 없으면 지금이 괜찮다는 뜻 */
  betterHour: BetterHour | null;
  /** 컨디션 한 줄 조언 (더위·자외선 중심) */
  advice: string | null;
}

// WMO weather code → 라벨/이모지
function wmo(code: number): { label: string; emoji: string; rainy: boolean } {
  if (code === 0) return { label: '맑음', emoji: '☀️', rainy: false };
  if (code <= 2) return { label: '대체로 맑음', emoji: '🌤️', rainy: false };
  if (code === 3) return { label: '흐림', emoji: '☁️', rainy: false };
  if (code >= 45 && code <= 48) return { label: '안개', emoji: '🌫️', rainy: false };
  if (code >= 51 && code <= 67) return { label: '비', emoji: '🌧️', rainy: true };
  if (code >= 71 && code <= 77) return { label: '눈', emoji: '🌨️', rainy: true };
  if (code >= 80 && code <= 82) return { label: '소나기', emoji: '🌦️', rainy: true };
  if (code >= 95) return { label: '뇌우', emoji: '⛈️', rainy: true };
  return { label: '흐림', emoji: '☁️', rainy: false };
}

function aqiFromPm25(pm25: number): { level: AqiLevel; label: string } {
  // 한국 기준(㎍/㎥) 근사
  if (pm25 <= 15) return { level: 'good', label: '좋음' };
  if (pm25 <= 35) return { level: 'moderate', label: '보통' };
  if (pm25 <= 75) return { level: 'bad', label: '나쁨' };
  return { level: 'verybad', label: '매우 나쁨' };
}

function outfitFor(tempC: number, rainy: boolean): string {
  let base: string;
  if (tempC >= 26) base = '민소매·반바지, 자외선/수분 주의';
  else if (tempC >= 18) base = '반팔·반바지가 딱 좋아요';
  else if (tempC >= 10) base = '긴팔 티에 반바지 또는 얇은 타이츠';
  else if (tempC >= 3) base = '긴팔·긴바지, 얇은 바람막이';
  else base = '방한 레이어·장갑·비니 권장';
  return rainy ? `${base} · 방수 자켓 챙기기` : base;
}

function scoreConditions(c: {
  tempC: number;
  windKmh: number;
  precipMm: number;
  rainy: boolean;
  aqi: AqiLevel;
}): number {
  // 기온: 12°C 부근이 러닝 최적
  const tempPenalty = Math.min(40, Math.abs(c.tempC - 12) * 1.6);
  const windPenalty = Math.min(20, Math.max(0, c.windKmh - 15) * 1.2);
  const rainPenalty = c.rainy ? Math.min(30, 12 + c.precipMm * 6) : 0;
  const aqiPenalty = { good: 0, moderate: 12, bad: 30, verybad: 55 }[c.aqi];
  return Math.round(Math.max(0, 100 - tempPenalty - windPenalty - rainPenalty - aqiPenalty));
}

function headlineFor(score: number, aqi: AqiLevel, rainy: boolean): string {
  if (aqi === 'verybad') return '미세먼지 매우 나쁨 — 오늘은 실내 러닝을 권해요';
  if (aqi === 'bad') return '미세먼지 나쁨 — 짧게 뛰거나 마스크를 챙기세요';
  if (rainy) return '비 소식 있어요 — 방수 챙기고 미끄럼 주의';
  if (score >= 80) return '오늘은 달리기 딱 좋은 날이에요 🌿';
  if (score >= 60) return '무난하게 뛰기 좋은 컨디션이에요';
  return '컨디션이 아주 좋진 않아요 — 무리하지 마세요';
}

function assemble(
  raw: {
    tempC: number;
    feelsC: number;
    humidity: number;
    windKmh: number;
    precipMm: number;
    code: number;
    pm25: number;
    pm10: number;
    uvIndex: number;
  },
  source: 'live' | 'sample',
  hourly?: HourlyPoint[],
): RunConditions {
  const w = wmo(raw.code);
  const aqi = aqiFromPm25(raw.pm25);
  const runScore = scoreConditions({
    tempC: raw.tempC,
    windKmh: raw.windKmh,
    precipMm: raw.precipMm,
    rainy: w.rainy,
    aqi: aqi.level,
  });
  const heatRisk = heatRiskOf(raw.feelsC, raw.uvIndex);
  const betterHour = heatRisk === 'none' ? null : findBetterHour(raw.feelsC, hourly);
  return {
    tempC: Math.round(raw.tempC),
    feelsC: Math.round(raw.feelsC),
    humidity: Math.round(raw.humidity),
    windKmh: Math.round(raw.windKmh),
    precipMm: raw.precipMm,
    condition: w.label,
    emoji: w.emoji,
    pm25: Math.round(raw.pm25),
    pm10: Math.round(raw.pm10),
    aqiLevel: aqi.level,
    aqiLabel: aqi.label,
    runScore,
    headline: headlineFor(runScore, aqi.level, w.rainy),
    outfit: outfitFor(raw.tempC, w.rainy),
    source,
    uvIndex: Math.round(raw.uvIndex * 10) / 10,
    heatRisk,
    betterHour,
    advice: adviceFor(heatRisk, raw.feelsC, raw.uvIndex, betterHour),
  };
}

// --- 더위·자외선 ------------------------------------------------------------

export interface HourlyPoint {
  hour: number; //   로컬 24시간제
  inHours: number; // 지금부터 몇 시간 뒤
  feelsC: number;
  uvIndex: number;
  rainPct: number;
}

/**
 * 체감온도 기준. 기상청 폭염주의보(체감 33℃)·경보(35℃)를 기준선으로 잡되,
 * 러닝은 가만히 있는 것보다 체감이 더 오르므로 한 칸 낮춰 본다.
 * 자외선은 8 이상이면 그 자체로 주의 대상(WHO 매우 높음 8~10).
 */
function heatRiskOf(feelsC: number, uv: number): HeatRisk {
  if (feelsC >= 33 || uv >= 9) return 'danger';
  if (feelsC >= 29 || uv >= 7) return 'caution';
  return 'none';
}

/**
 * 지금보다 확실히 나은 시간대를 앞으로 12시간 안에서 찾는다.
 * '확실히'의 기준은 체감 2℃ 이상 낮고 비 올 확률이 크지 않은 때 —
 * 0.5℃ 차이로 '두 시간 뒤에 뛰세요'라고 하면 조언이 아니라 잡음이다.
 */
function findBetterHour(nowFeelsC: number, hourly?: HourlyPoint[]): BetterHour | null {
  if (!hourly || hourly.length === 0) return null;
  const candidates = hourly.filter(
    (h) => h.inHours >= 1 && h.inHours <= 12 && h.feelsC <= nowFeelsC - 2 && h.rainPct < 50,
  );
  if (candidates.length === 0) return null;
  // 가장 시원한 때, 같으면 더 이른 때
  candidates.sort((a, b) => a.feelsC - b.feelsC || a.inHours - b.inHours);
  const best = candidates[0];
  return {
    hour: best.hour,
    feelsC: Math.round(best.feelsC),
    uvIndex: Math.round(best.uvIndex * 10) / 10,
    rainPct: Math.round(best.rainPct),
    inHours: best.inHours,
  };
}

function adviceFor(
  risk: HeatRisk,
  feelsC: number,
  uv: number,
  better: BetterHour | null,
): string | null {
  if (risk === 'none') return null;
  // 짧게 쓴다. 첫 화면 맨 위에 뜨는 줄이라 두 줄이 되면 그 높이가 그대로
  // 지도에서 빠진다 — 실측에서 두 줄을 먹고 지도를 눌렀다.
  const when = better ? ` · ${better.hour}시 ${better.feelsC}°` : '';
  const uvPart = uv >= 7 ? ` · 자외선 ${uv.toFixed(0)}` : '';
  const head = `체감 ${Math.round(feelsC)}°${uvPart}${when}`;
  return risk === 'danger'
    ? `${head} — 무리 말고 그늘로 짧게`
    : `${head} — 천천히, 물 챙기기`;
}

/** 네트워크/키 없이도 화면이 채워지도록 하는 샘플 컨디션 (선선한 가을 저녁) */
export function sampleConditions(): RunConditions {
  return assemble(
    {
      tempC: 13,
      feelsC: 12,
      humidity: 58,
      windKmh: 9,
      precipMm: 0,
      code: 1,
      pm25: 12,
      pm10: 24,
      uvIndex: 2,
    },
    'sample',
  );
}

/**
 * Open-Meteo hourly 블록 → 지금 이후 시간대 목록.
 *
 * time 은 'YYYY-MM-DDTHH:mm' 로 타임존이 없다. 그대로 new Date 에 넣으면
 * '기기의' 로컬 시각으로 해석되는데, timezone=auto 로 받은 값은 '그 지역의'
 * 로컬 시각이다. 둘이 다르면(해외에서 서울 코스를 볼 때) 몇 시간이 통째로
 * 어긋난다. 응답의 utc_offset_seconds 로 절대 시각을 복원해서 쓴다.
 */
function parseHourly(h: unknown, utcOffsetSec = 0): HourlyPoint[] {
  const o = h as
    | {
        time?: string[];
        apparent_temperature?: number[];
        uv_index?: number[];
        precipitation_probability?: number[];
      }
    | undefined;
  if (!o?.time || !Array.isArray(o.time)) return [];
  const now = Date.now();
  const out: HourlyPoint[] = [];
  o.time.forEach((t, i) => {
    // 지역 로컬 시각 문자열 → UTC 로 읽은 뒤 오프셋만큼 되돌려 절대 시각으로
    // 'YYYY-MM-DDTHH:mm' → 'YYYY-MM-DDTHH:mm:00Z' 로 UTC 로 못박아 읽고 오프셋을 뺀다
    const at = Date.parse(t.length === 16 ? `${t}:00Z` : `${t}Z`) - utcOffsetSec * 1000;
    if (!Number.isFinite(at)) return;
    const inHours = Math.round((at - now) / 3_600_000);
    const feels = o.apparent_temperature?.[i];
    if (typeof feels !== 'number') return;
    out.push({
      // 표시용 시각은 '그 지역의' 시(時) — 문자열에서 그대로 읽는다
      hour: Number(t.slice(11, 13)),
      inHours,
      feelsC: feels,
      uvIndex: o.uv_index?.[i] ?? 0,
      rainPct: o.precipitation_probability?.[i] ?? 0,
    });
  });
  return out;
}

export async function getConditions(loc: LatLng): Promise<RunConditions> {
  const [lat, lng] = loc;
  try {
    const wxUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,uv_index` +
      // 앞으로 13시간 — '지금 말고 몇 시에 뛰는 게 나은지' 를 여기서 찾는다.
      // timezone=auto 라 hourly.time 이 로컬 시각으로 온다.
      `&hourly=apparent_temperature,uv_index,precipitation_probability&forecast_hours=13&timezone=auto`;
    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}` +
      `&current=pm2_5,pm10`;

    // 날씨(필수)와 대기질(선택)을 따로 받는다. 예전엔 하나의 AbortController 로
    // 묶어 Promise.all 로 기다렸는데, 대기질 서버(다른 호스트)가 느리거나 죽으면
    // 멀쩡히 받아온 날씨까지 통째로 '예시'로 떨어졌다 — 화면의 기온·미세먼지가
    // 전부 가짜가 됐다. 대기질은 미리 띄워 병렬로 받되 실패하면 그 항목만 비운다.
    // (응답이 오래 걸리면 샘플로 넘어가 첫 화면이 비어 보이지 않게 한다)
    const COND_TIMEOUT_MS = 2500;
    const aqP = fetchWithTimeout(aqUrl, {}, COND_TIMEOUT_MS)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const wxRes = await fetchWithTimeout(wxUrl, {}, COND_TIMEOUT_MS);
    if (!wxRes.ok) throw new Error('weather fetch failed');
    const wx = await wxRes.json();
    const aq = await aqP;
    const cw = wx.current ?? {};
    const ca = aq?.current ?? {};
    return assemble(
      {
        tempC: cw.temperature_2m ?? 13,
        feelsC: cw.apparent_temperature ?? cw.temperature_2m ?? 13,
        humidity: cw.relative_humidity_2m ?? 55,
        windKmh: cw.wind_speed_10m ?? 8,
        precipMm: cw.precipitation ?? 0,
        code: cw.weather_code ?? 1,
        pm25: ca.pm2_5 ?? 12,
        pm10: ca.pm10 ?? 24,
        uvIndex: cw.uv_index ?? 0,
      },
      'live',
      parseHourly(wx.hourly, wx.utc_offset_seconds ?? 0),
    );
  } catch {
    return sampleConditions();
  }
}
