// ---------------------------------------------------------------------------
// 내가 만든/기록한 코스 저장소 (localStorage) + 공유 링크 코덱
// ---------------------------------------------------------------------------

import {
  decodePolyline,
  decodeShare,
  downsample,
  encodePolyline,
  encodeShare,
  type SharePayload,
} from './polyline';
import { buildResult, type RouteResult } from './routing';
import { RUN_STYLES, type RunStyle } from './routeStyle';
import type { LatLng } from './types';

const KEY = 'run-app-routes-v1';
const TRASH_KEY = 'run-app-routes-trash-v1';

export interface SavedRoute {
  id: string;
  name: string;
  createdAt: number;
  kind: 'built' | 'recorded';
  style?: RunStyle;
  distanceKm: number;
  ascentM: number;
  maxGradePct: number;
  source: 'ors' | 'osrm' | 'offline' | 'gps';
  coords: LatLng[];
  elevations: number[];
  durationSec?: number; // 기록한 러닝에만
  /**
   * 고도를 실제로 받았는지. false 면 elevations 는 전부 0 인 '모름' 이다.
   *
   * 이걸 안 실으면 저장했다 다시 열 때 '모름'이 '상승 0m·최대 0%' 라는
   * 사실 선언으로 둔갑한다. 예전 기록에는 이 칸이 없는데(undefined),
   * 그때는 지금까지처럼 '안다'로 본다 — 없던 값을 소급해 의심하지 않는다.
   */
  elevKnown?: boolean;
}

/**
 * 저장 전 부피 줄이기.
 *
 * GPS 원본은 좌표를 소수점 15자리까지 들고 있는데 실제 GPS 정확도는 ±5m 라
 * 5자리(약 1.1m)면 충분하다. 고도도 0.1m 면 넘친다. 포인트 수도 상한을 둔다
 * — 거리·고도 같은 수치는 이미 계산해서 따로 들고 있으므로 솎아내도 안 틀린다.
 *
 * 이걸 안 하면 10km 기록 1건이 약 108KB, localStorage 5MB 한도에 47건이면 꽉 찬다.
 * 주 3회 뛰는 사람은 넉 달이면 도달한다.
 */
const MAX_POINTS = 1500; // 10km 기준 약 7m 간격 — 지도·차트에 차이가 안 보인다

export function compactRoute(r: SavedRoute): SavedRoute {
  const coords = downsample(r.coords, MAX_POINTS).map(
    ([la, ln]) => [Math.round(la * 1e5) / 1e5, Math.round(ln * 1e5) / 1e5] as LatLng,
  );
  const elevations = downsample(r.elevations, MAX_POINTS).map((e) => Math.round(e * 10) / 10);
  return { ...r, coords, elevations };
}

/**
 * 저장된 값이 정말 SavedRoute 인지 확인한다.
 *
 * 이게 없으면 localStorage 가 한 번 깨졌을 때(다른 탭의 옛 버전, 백업 복원 실패,
 * 용량 초과로 잘린 문자열) 앱이 렌더 중에 터지고, 그 값은 계속 남아 있으므로
 * 새로고침해도 매번 같은 자리에서 터진다 — 사용자는 앱에서 손쓸 방법이 없다.
 * 이상한 항목만 조용히 버리면 나머지 기록은 살아남는다.
 */
function isRoute(v: unknown): v is SavedRoute {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.createdAt === 'number' &&
    Number.isFinite(r.createdAt) &&
    (r.kind === 'built' || r.kind === 'recorded') &&
    typeof r.distanceKm === 'number' &&
    Number.isFinite(r.distanceKm) &&
    Array.isArray(r.coords) &&
    // 점이 2개는 있어야 '경로'다. 빈 배열도 Array.isArray 는 통과하는데,
    // 그런 항목이 목록에 남으면 열었을 때 지도 center 가 undefined 가 되어
    // center[0] 을 읽는 순간 시트가 통째로 터진다(백업 복원·저장소 손상으로
    // 실제로 들어올 수 있는 모양이다). 통계에도 의미가 없으니 여기서 버린다.
    r.coords.length >= 2 &&
    Array.isArray(r.elevations) &&
    r.coords.every(
      (c) =>
        Array.isArray(c) &&
        c.length === 2 &&
        typeof c[0] === 'number' &&
        typeof c[1] === 'number' &&
        Number.isFinite(c[0]) &&
        Number.isFinite(c[1]),
    )
  );
}

/** 숫자 칸 보정 — 목록·통계가 NaN 을 그대로 그리지 않게 */
function fixNumbers<T extends SavedRoute>(r: T): T {
  return {
    ...r,
    ascentM: Number.isFinite(r.ascentM) ? r.ascentM : 0,
    maxGradePct: Number.isFinite(r.maxGradePct) ? r.maxGradePct : 0,
    durationSec:
      typeof r.durationSec === 'number' && Number.isFinite(r.durationSec)
        ? r.durationSec
        : undefined,
  };
}

/** 손상된 항목을 걸러낸 목록. 통계·지도가 이 배열을 그대로 믿고 쓴다. */
export function sanitizeRoutes(v: unknown): SavedRoute[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRoute).map(fixNumbers);
}

export function loadRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeRoutes(JSON.parse(raw));
  } catch {
    /* 무시 */
  }
  return [];
}

/** 오래된 기록을 더 거칠게 다시 압축한다 (지도 선만 성겨질 뿐 수치는 그대로) */
function shrinkOldest(routes: SavedRoute[], maxPoints: number): SavedRoute[] {
  // 오래된 것부터 절반만 손대 최근 기록의 화질은 지킨다
  const order = [...routes].sort((a, b) => a.createdAt - b.createdAt);
  const targets = new Set(order.slice(0, Math.ceil(order.length / 2)).map((r) => r.id));
  return routes.map((r) =>
    targets.has(r.id) && r.coords.length > maxPoints
      ? {
          ...r,
          coords: downsample(r.coords, maxPoints),
          elevations: downsample(r.elevations, maxPoints),
        }
      : r,
  );
}

/**
 * 저장. 용량이 꽉 차면 오래된 기록의 지도 해상도를 단계적으로 낮춰 자리를
 * 만들어 본다 — 거리·시간·고도 같은 수치는 별도 필드라 통계는 그대로다.
 * 그래도 안 되면 false. 조용히 삼키면 방금 뛴 기록이 사라진 걸 나중에야 안다.
 *
 * 반환: 저장 성공 여부와, 정리 과정에서 실제로 바뀐 배열(있으면 호출측이 반영)
 */
export function persistRoutes(routes: SavedRoute[]): { ok: boolean; compacted?: SavedRoute[] } {
  try {
    localStorage.setItem(KEY, JSON.stringify(routes));
    return { ok: true };
  } catch {
    /* 아래에서 단계적으로 줄여 재시도 */
  }
  for (const maxPoints of [600, 250, 100]) {
    const shrunk = shrinkOldest(routes, maxPoints);
    try {
      localStorage.setItem(KEY, JSON.stringify(shrunk));
      return { ok: true, compacted: shrunk };
    } catch {
      routes = shrunk; // 다음 단계는 이미 줄인 것에서 더 줄인다
    }
  }
  return { ok: false };
}

// --- 휴지통 ----------------------------------------------------------------
//
// 삭제는 한 번의 탭으로 끝나고 되돌릴 방법이 없었다. 시트에서 '내 코스에 저장'
// 이 있던 바로 그 자리가 저장 직후 '삭제'로 바뀌기 때문에, 저장하려고 한 번 더
// 누르면 방금 뛴 기록이 확인도 없이 지워지고 시트까지 닫혔다 — 사용자가 보기엔
// '보관 버튼을 눌렀더니 코스가 사라진' 것이다.
//
// 지운 코스는 곧바로 없애지 않고 여기서 30일 머문다. 저장한 코스 화면에서 다시
// 꺼낼 수 있고, 지운 직후에는 되돌리기 띠가 뜬다.

/** 휴지통 보관 기간 */
export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;
/** 휴지통 최대 건수 — 기록 본체가 쓸 저장 공간을 잠식하지 않게 */
const TRASH_MAX = 10;

export interface TrashedRoute extends SavedRoute {
  /** 지운 시각(epoch ms) */
  deletedAt: number;
}

function isTrashed(v: unknown): v is TrashedRoute {
  if (!isRoute(v)) return false;
  const t = (v as TrashedRoute).deletedAt;
  return typeof t === 'number' && Number.isFinite(t);
}

/** 손상된 항목과 기간이 지난 항목을 걸러낸 휴지통 */
export function sanitizeTrash(v: unknown, now: number = Date.now()): TrashedRoute[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isTrashed)
    .filter((t) => now - t.deletedAt < TRASH_DAYS * DAY_MS)
    .map(fixNumbers)
    .slice(0, TRASH_MAX);
}

/** 휴지통에 넣기 — 최근 것이 앞, 기간·건수 상한을 지킨다 */
export function addToTrash(
  trash: TrashedRoute[],
  r: SavedRoute,
  now: number = Date.now(),
): TrashedRoute[] {
  const next: TrashedRoute[] = [{ ...r, deletedAt: now }, ...trash.filter((t) => t.id !== r.id)];
  return next.filter((t) => now - t.deletedAt < TRASH_DAYS * DAY_MS).slice(0, TRASH_MAX);
}

/** 휴지통 항목 → 되살릴 기록 (deletedAt 을 뗀다) */
export function restoredFromTrash(t: TrashedRoute): SavedRoute {
  const { deletedAt: _deletedAt, ...route } = t;
  return route;
}

export function loadTrash(now: number = Date.now()): TrashedRoute[] {
  try {
    const raw = localStorage.getItem(TRASH_KEY);
    if (raw) return sanitizeTrash(JSON.parse(raw), now);
  } catch {
    /* 무시 */
  }
  return [];
}

/**
 * 휴지통 저장. 실제로 저장된 배열을 돌려준다.
 *
 * 이건 '되면 좋은' 데이터다. 기록 본체(persistRoutes)가 쓸 자리를 뺏으면
 * 안 되므로, 용량이 모자라면 오래된 것부터 버리며 재시도한다.
 */
export function persistTrash(trash: TrashedRoute[]): TrashedRoute[] {
  let cur = trash;
  for (;;) {
    try {
      localStorage.setItem(TRASH_KEY, JSON.stringify(cur));
      return cur;
    } catch {
      if (cur.length === 0) return cur; // 빈 배열도 못 쓰면 더 줄일 것이 없다
      cur = cur.slice(0, -1);
    }
  }
}

const rid = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** RouteView(만든/기록한/공유된 경로) → 저장 레코드 */
export function savedFromView(v: {
  name: string;
  route: RouteResult;
  kind: SavedRoute['kind'];
  style?: RunStyle;
  source: string;
  durationSec?: number;
}): SavedRoute {
  const src: SavedRoute['source'] = v.source === 'ors' || v.source === 'osrm' || v.source === 'gps' ? v.source : 'offline';
  return compactRoute({
    id: rid(),
    name: v.name,
    createdAt: Date.now(),
    kind: v.kind,
    style: v.style,
    distanceKm: v.route.distanceKm,
    ascentM: v.route.ascentM,
    maxGradePct: v.route.maxGradePct,
    source: v.kind === 'recorded' ? 'gps' : src,
    coords: v.route.coords,
    elevations: v.route.elevations,
    durationSec: v.durationSec,
    // 모르는 건 모른다고 실어 보낸다 (아는 경우엔 칸을 안 만들어 용량을 아낀다)
    elevKnown: v.route.elevationKnown === false ? false : undefined,
  });
}

/** SavedRoute 를 지도/차트에서 쓰는 RouteResult 로 복원 */
export function toRouteResult(s: SavedRoute): RouteResult {
  const src = s.source === 'gps' ? 'offline' : s.source;
  const r = buildResult(s.coords, s.elevations, src, [s.coords[0]]);
  // 요약 수치(거리·상승·최대 경사)는 저장해 둔 값을 그대로 쓴다.
  //
  // buildResult 는 좌표·고도를 다시 훑어 계산하는데, 저장된 좌표는 원본이
  // 아니다. compactRoute 가 1500점으로 솎고, 용량이 꽉 차면 shrinkOldest 가
  // 100점까지 더 줄인다. 그래서 다시 계산하면 목록과 상세가 어긋난다 —
  //   · 거리: 기록 좌표는 게이트를 지난 점들이라 코너를 직선으로 가로지른다.
  //           도심 지그재그에서 목록 3.2km / 열면 2.34km (26.9% 차이).
  //   · 상승: 솎을수록 오르내림이 뭉개진다. 언덕 11km 를 100점까지 줄이면
  //           목록 377m / 열면 322m (14.6% 차이).
  // 저장값은 원본 해상도에서(거리는 도플러 적분으로) 낸 값이라 그쪽이 맞다.
  // 좌표·고도 배열은 지도 선과 고도 그래프를 그리는 용도로만 쓴다.
  return {
    ...r,
    distanceKm: s.distanceKm > 0 ? s.distanceKm : r.distanceKm,
    ascentM: s.ascentM > 0 ? s.ascentM : r.ascentM,
    maxGradePct: s.maxGradePct > 0 ? s.maxGradePct : r.maxGradePct,
    // 저장할 때 '모름'이었으면 열어서도 '모름'이다
    ...(s.elevKnown === false ? { elevationKnown: false } : {}),
  };
}

// --- 공유 ------------------------------------------------------------------

export function buildShareToken(s: {
  name: string;
  style?: RunStyle;
  distanceKm: number;
  ascentM: number;
  maxGradePct: number;
  source: string;
  coords: LatLng[];
  elevations: number[];
  /** 고도를 실제로 받았는지 — false 면 받는 사람에게도 '모름'으로 전한다 */
  elevKnown?: boolean;
}): string {
  const coords = downsample(s.coords, 100);
  const elev = downsample(s.elevations, 60).map((e) => Math.round(e));
  const payload: SharePayload = {
    n: s.name,
    s: s.style,
    d: Math.round(s.distanceKm * 100) / 100,
    a: s.ascentM,
    g: s.maxGradePct,
    src: s.source,
    p: encodePolyline(coords),
    e: elev,
    ...(s.elevKnown === false ? { k: 0 as const } : {}),
  };
  return encodeShare(payload);
}

export function shareUrl(token: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#course=${token}`;
}

export interface SharedRoute {
  name: string;
  style?: string;
  distanceKm: number;
  ascentM: number;
  maxGradePct: number;
  source: string;
  route: RouteResult;
}

/** URL 해시(#course=...) 에서 공유된 코스 복원 */
export function parseSharedFromHash(hash: string): SharedRoute | null {
  const m = /[#&]course=([^&]+)/.exec(hash);
  if (!m) return null;
  // 여기 들어오는 문자열은 남이 보낸 링크다 — 잘리거나 손대진 값이 올 수 있다.
  // decodeURIComponent 는 '%' 하나만 어긋나도 던지고, payload 필드가 비면
  // 아래 계산이 터진다. 앱을 열자마자 오류 화면이 뜨느니 조용히 무시한다.
  let payload;
  try {
    payload = decodeShare(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
  if (!payload || !Array.isArray(payload.e)) return null;
  const coords = decodePolyline(payload.p);
  if (coords.length < 2) return null;
  // 고도 배열 길이를 좌표 수에 맞춰 선형 보간
  const elev = resample(
    payload.e.filter((n) => typeof n === 'number' && Number.isFinite(n)),
    coords.length,
  );
  // 링크에는 좌표를 100개로, 고도를 60개로 솎아 담는다(URL 길이 때문). 그걸로
  // 거리·상승을 다시 계산하면 보낸 사람이 본 값과 달라진다 — 코너를 훨씬 크게
  // 가로지르기 때문이다. 링크에 실려 온 수치가 원본이므로 그쪽을 쓴다.
  // (좌표는 지도에 선을 그리는 용도로만 쓴다)
  const r = buildResult(coords, elev, 'offline', [coords[0]]);
  const route: RouteResult = {
    ...r,
    distanceKm: payload.d > 0 ? payload.d : r.distanceKm,
    ascentM: Number.isFinite(payload.a) ? payload.a : r.ascentM,
    maxGradePct: Number.isFinite(payload.g) ? payload.g : r.maxGradePct,
    // 보낸 사람이 '모름'으로 만들었으면 받는 사람에게도 모름이다
    ...(payload.k === 0 ? { elevationKnown: false } : {}),
  };
  return {
    // 이름·스타일·출처는 '남이 보낸 링크'에서 온 값이다. JSON 이라 어떤 타입도
    // 들어올 수 있는데, 예전엔 그대로 내보냈다:
    //   · 이름이 객체면 React 가 렌더 중 던져 앱이 오류 화면으로 넘어간다
    //     (Objects are not valid as a React child) — 링크 하나로 앱이 죽는다
    //   · 이름이 10만 자여도 통과해 화면이 깨지고, 저장하면 그대로 쌓인다
    // 타입과 길이를 여기서 확정한다. 이 함수 밖으로는 늘 안전한 값만 나간다.
    name: safeName(payload.n),
    style: RUN_STYLES.some((s) => s.id === payload.s) ? payload.s : undefined,
    distanceKm: route.distanceKm,
    ascentM: route.ascentM,
    maxGradePct: route.maxGradePct,
    source: typeof payload.src === 'string' ? payload.src : 'offline',
    route,
  };
}

/** 코스 이름 한도 — 저장 목록·시트 제목이 한 줄로 읽히는 길이 */
const MAX_NAME_LEN = 60;

function safeName(v: unknown): string {
  if (typeof v !== 'string') return '공유받은 코스';
  const t = v.trim();
  if (!t) return '공유받은 코스';
  return t.length > MAX_NAME_LEN ? `${t.slice(0, MAX_NAME_LEN)}…` : t;
}

function resample(values: number[], n: number): number[] {
  if (values.length === 0) return new Array(n).fill(0);
  if (n === 1) return [values[0]];
  if (values.length === n) return values.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(values.length - 1, lo + 1);
    out.push(values[lo] + (values[hi] - values[lo]) * (t - lo));
  }
  return out;
}
