// ---------------------------------------------------------------------------
// 오늘의 러닝 컨디션 — 날씨 + 미세먼지 + 러닝 적합도 + 복장 추천
// Open-Meteo (키 불필요) 사용, 실패 시 샘플로 폴백.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

export type AqiLevel = 'good' | 'moderate' | 'bad' | 'verybad';

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
  },
  source: 'live' | 'sample',
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
  };
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
    },
    'sample',
  );
}

export async function getConditions(loc: LatLng): Promise<RunConditions> {
  const [lat, lng] = loc;
  try {
    const wxUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation`;
    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}` +
      `&current=pm2_5,pm10`;

    // 응답이 오래 걸리면 기다리지 말고 샘플로 넘어간다 (첫 화면이 비어 보이지 않도록)
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const [wxRes, aqRes] = await Promise.all([
      fetch(wxUrl, { signal: ac.signal }),
      fetch(aqUrl, { signal: ac.signal }),
    ]).finally(() => clearTimeout(timer));
    if (!wxRes.ok) throw new Error('weather fetch failed');
    const wx = await wxRes.json();
    const aq = aqRes.ok ? await aqRes.json() : { current: {} };
    const cw = wx.current ?? {};
    const ca = aq.current ?? {};
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
      },
      'live',
    );
  } catch {
    return sampleConditions();
  }
}
