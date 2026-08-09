// ---------------------------------------------------------------------------
// 길 성격 — ORS 가 같이 돌려주는 waytype / surface 를 러너 말로 옮긴다.
//
// 왜 필요한가: 한국에서 "어디를 뛸까"의 절반은 경사가 아니라 '차도냐 산책로냐'
// 다. 한강·천변·공원길은 신호등이 없어 끊기지 않고, 가로수가 있어 여름에 덜
// 뜨겁고, 노면도 발에 낫다. 반대로 대로변은 5분마다 횡단보도에 걸린다.
// 고도만 보고 코스를 고르면 이 차이가 안 보인다.
//
// 데이터는 공짜다 — ORS 요청에 extra_info 를 얹으면 같은 응답에 실려 온다.
// 별도 호출도, 지연도 없다. (green/noise 지수도 요청은 되지만 공개 서버는
// 값을 안 채워 준다 — 전 구간 같은 값이 온다. 실측하고 뺐다.)
//
// OSRM·오프라인 폴백에는 이 정보가 없다. 그때는 undefined 로 두고 UI 에서
// 아예 표시하지 않는다 — 모르는 걸 0% 로 보여주면 거짓말이 된다.
// ---------------------------------------------------------------------------

/** ORS waytype 코드 (문서 값) */
const WAY = {
  UNKNOWN: 0,
  STATE_ROAD: 1,
  ROAD: 2,
  STREET: 3,
  PATH: 4,
  TRACK: 5,
  CYCLEWAY: 6,
  FOOTWAY: 7,
  STEPS: 8,
  FERRY: 9,
  CONSTRUCTION: 10,
} as const;

/** ORS surface 코드 중 '흙·자갈' 계열 (무릎에 부드럽고 대개 공원·숲길) */
const SOFT_SURFACE = new Set([
  8, // Compacted Gravel
  9, // Fine Gravel
  10, // Gravel
  11, // Dirt
  12, // Ground
  15, // Sand
  16, // Woodchips
  17, // Grass
  18, // Grass Paver
]);

export interface WayMix {
  /** 보행자 전용(산책로·공원길·자전거길) 비율 % */
  trailPct: number;
  /** 차도(대로·일반도로·시내도로) 비율 % */
  roadPct: number;
  /** 흙·자갈 등 부드러운 노면 비율 % */
  softPct: number;
  /** 계단 길이(m) — 뛰다 끊기는 구간이라 따로 알린다 */
  stepsM: number;
}

interface OrsExtraSummary {
  value: number;
  distance: number;
  amount: number;
}

function sumAmount(summary: OrsExtraSummary[], codes: Set<number>): number {
  return summary.reduce((s, e) => (codes.has(e.value) ? s + e.amount : s), 0);
}

/**
 * ORS geojson 의 properties.extras 를 WayMix 로 옮긴다.
 * 값이 없거나 형태가 다르면 null — 호출측은 '모름'으로 다룬다.
 */
export function parseWayMix(extras: unknown): WayMix | null {
  if (!extras || typeof extras !== 'object') return null;
  const e = extras as Record<string, { summary?: OrsExtraSummary[] }>;
  const way = e.waytype?.summary;
  if (!Array.isArray(way) || way.length === 0) return null;

  const trail = new Set<number>([WAY.PATH, WAY.TRACK, WAY.CYCLEWAY, WAY.FOOTWAY]);
  const road = new Set<number>([WAY.STATE_ROAD, WAY.ROAD, WAY.STREET]);
  const surface = e.surface?.summary;

  return {
    trailPct: Math.round(sumAmount(way, trail)),
    roadPct: Math.round(sumAmount(way, road)),
    softPct: Array.isArray(surface) ? Math.round(sumAmount(surface, SOFT_SURFACE)) : 0,
    stepsM: Math.round(way.find((w) => w.value === WAY.STEPS)?.distance ?? 0),
  };
}

/** 사람이 읽을 한 줄 — 카드·상세에 그대로 쓴다 */
export function wayMixLabel(mix: WayMix): string {
  const parts: string[] = [];
  if (mix.trailPct >= 60) parts.push(`산책로 위주 ${mix.trailPct}%`);
  else if (mix.trailPct >= 30) parts.push(`산책로 ${mix.trailPct}%`);
  else parts.push(`차도 옆 ${mix.roadPct}%`);
  if (mix.softPct >= 20) parts.push(`흙길 ${mix.softPct}%`);
  if (mix.stepsM >= 30) parts.push(`계단 ${mix.stepsM}m`);
  return parts.join(' · ');
}
