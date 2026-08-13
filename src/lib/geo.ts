// ---------------------------------------------------------------------------
// 지리 계산 헬퍼
// 좌표 규약: 앱 전체에서 [위도(lat), 경도(lng)] 순서를 사용한다 (Leaflet 규약).
// OpenRouteService 는 [lng, lat] 를 쓰므로 provider 내부에서만 뒤집는다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

const R_EARTH = 6371008.8; // 지구 평균 반지름(m)
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** 두 좌표 사이 거리(m) — 하버사인 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 경로 전체 길이(m) */
export function pathLengthMeters(path: LatLng[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += haversineMeters(path[i - 1], path[i]);
  return sum;
}

/** 시작점에서 방위각(도)·거리(m)만큼 이동한 좌표 */
export function destinationPoint(
  origin: LatLng,
  bearingDeg: number,
  distanceMeters: number,
): LatLng {
  const δ = distanceMeters / R_EARTH;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin[0]);
  const λ1 = toRad(origin[1]);
  const sinφ2 =
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return [toDeg(φ2), ((toDeg(λ2) + 540) % 360) - 180];
}

/** 두 점 사이를 stepMeters 간격으로 촘촘히 채운 좌표열 (offline 라우팅용) */
export function densifySegment(
  a: LatLng,
  b: LatLng,
  stepMeters = 60,
): LatLng[] {
  const dist = haversineMeters(a, b);
  const n = Math.max(1, Math.round(dist / stepMeters));
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** 여러 지점을 직선으로 연결하며 촘촘히 채운다 (offline 라우팅용) */
export function densifyPath(points: LatLng[], stepMeters = 60): LatLng[] {
  if (points.length === 0) return [];
  const out: LatLng[] = [];
  for (let i = 1; i < points.length; i++) {
    out.push(...densifySegment(points[i - 1], points[i], stepMeters));
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * 최근접 이웃(Nearest-Neighbor) 순서로 경유지를 재배열한다.
 * 첫 지점은 고정하고 이후 가장 가까운 지점을 차례로 잇는다. (핀 순서 최적화 후보용)
 */
export function nearestNeighborOrder(points: LatLng[]): LatLng[] {
  if (points.length <= 2) return [...points];
  const remaining = points.slice(1);
  const ordered: LatLng[] = [points[0]];
  let current = points[0];
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(current, remaining[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    current = remaining.splice(best, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

/**
 * 경유지를 최대 개수 이하로 솎는다. 첫 점과 끝 점은 반드시 남기고 나머지는
 * 균등 간격으로 고른다.
 *
 * 라우팅 제공자마다 한 번에 받는 경유지 수에 상한이 있다(ORS 무료 50개).
 * 코스 경로점을 촘촘하게 만들면 왕복 코스는 되돌아오는 몫까지 더해져
 * 이 상한을 쉽게 넘고, 그러면 경로 요청 자체가 실패한다 — 촘촘함이
 * 오히려 '경로를 못 만들었습니다'로 돌아오는 셈이다. 상한 안에서는
 * 원본을 그대로 두고, 넘을 때만 솎아 통로 모양을 유지한다.
 */
export function thinWaypoints(points: LatLng[], max: number): LatLng[] {
  if (max < 2 || points.length <= max) return points;
  const out: LatLng[] = [];
  for (let i = 0; i < max - 1; i++) {
    out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * 되돌아 나오는 짧은 곁가지를 걷어내고 남길 좌표의 인덱스를 고른다.
 *
 * 거리 모드는 시작점 둘레에 고리 정점을 기하학적으로 찍어(generateLoop) 그
 * 점들을 반드시 지나게 경로를 만든다. 정점이 막다른 골목이나 진행 방향과
 * 어긋난 길에 스냅되면 라우터는 거기 들어갔다 그대로 되돌아 나온다 —
 * 지도에서 선이 삐쭉 튀어나온 돌기로 보이고, 그만큼 거리도 부풀려진다.
 *
 * 판별: 어느 지점에서 출발해 rejoinM 안으로 되돌아왔고, 그 사이 경로 길이가
 * '최대 이탈 거리의 두 배'에 가까우면(되짚기) 곁가지다. 고리는 같은 조건에서
 * 길이가 훨씬 길어(원이면 π배) 걸러진다 — 블록을 한 바퀴 도는 구간은 남는다.
 *
 * 왕복 코스의 반환점도 국소적으로는 똑같은 되짚기라, 되짚기 판정만으로는
 * 구분되지 않는다. 차이는 전역적이다 — 돌기는 '본선에서 벗어났다 본선으로
 * 돌아오는' 것이라 앞뒤 진행 방향이 같지만, 반환점은 진행 방향이 뒤집힌다.
 * 그래서 곁가지 앞뒤 본선의 방위가 비슷할 때만 걷어낸다.
 *
 * protect 에 준 지점(사용자가 찍은 핀) 근처의 곁가지는 의도된 것이므로 남긴다.
 * 막다른 길에 핀을 찍었으면 거기 들어갔다 나오는 게 맞다.
 */
export function spurKeptIndices(
  coords: LatLng[],
  opts: { maxSpurM?: number; rejoinM?: number; protect?: LatLng[]; protectM?: number } = {},
): number[] {
  const maxSpurM = opts.maxSpurM ?? 120;
  const rejoinM = opts.rejoinM ?? 20;
  const protect = opts.protect ?? [];
  const protectM = opts.protectM ?? 30;
  const MIN_SPUR_M = 25; //  이보다 짧으면 좌표 잡음이라 건드리지 않는다
  const RETRACE_MAX = 1.25; // 되짚기 판정 상한 (1.0 이 완벽한 왕복)
  const TREND_M = 15; //     본선 방위를 재는 구간 길이
  const TREND_TOL_DEG = 60; // 앞뒤 본선이 '같은 방향'이라고 볼 각도 차

  const n = coords.length;
  const all = () => coords.map((_, i) => i);
  if (n < 4) return all();

  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + haversineMeters(coords[i - 1], coords[i]);

  // 두 좌표 사이 진행 방위(도). 서울 규모에서는 국소 평면 근사로 충분하다.
  const bearing = (a: LatLng, b: LatLng): number => {
    const dy = b[0] - a[0];
    const dx = (b[1] - a[1]) * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
    return (Math.atan2(dx, dy) * 180) / Math.PI;
  };
  const angleGap = (p: number, q: number): number =>
    Math.abs((((p - q + 180) % 360) + 360) % 360 - 180);

  const keep = [0];
  let i = 0;
  while (i < n - 1) {
    // 멀리 있는 j 부터 본다 — 곁가지를 조각내지 않고 한 번에 걷어내기 위해
    let jMax = i + 1;
    while (jMax + 1 < n && cum[jMax + 1] - cum[i] <= 2 * maxSpurM) jMax++;
    let cut = -1;
    for (let j = jMax; j >= i + 2; j--) {
      if (cum[j] - cum[i] < MIN_SPUR_M) break; // j 가 줄면 길이도 준다
      if (haversineMeters(coords[i], coords[j]) > rejoinM) continue;
      let maxDist = 0;
      let tip = i;
      for (let k = i + 1; k < j; k++) {
        const d = haversineMeters(coords[i], coords[k]);
        if (d > maxDist) {
          maxDist = d;
          tip = k;
        }
      }
      if (maxDist < 1 || maxDist > maxSpurM) continue;
      if (cum[j] - cum[i] > 2 * maxDist * RETRACE_MAX) continue; // 고리다 — 남긴다
      // 앞뒤로 본선이 이어지고, 그 방향이 같아야 '본선에서 벗어난 돌기'다.
      // 경로 끝에 붙은 되짚기는 판단할 근거가 없으므로 건드리지 않는다.
      let a = i;
      while (a > 0 && cum[i] - cum[a] < TREND_M) a--;
      let b = j;
      while (b < n - 1 && cum[b] - cum[j] < TREND_M) b++;
      if (cum[i] - cum[a] < TREND_M || cum[b] - cum[j] < TREND_M) continue;
      if (angleGap(bearing(coords[a], coords[i]), bearing(coords[j], coords[b])) > TREND_TOL_DEG) {
        continue; // 진행 방향이 뒤집혔다 — 왕복 반환점이지 돌기가 아니다
      }
      if (protect.some((pt) => haversineMeters(pt, coords[tip]) <= protectM)) continue;
      cut = j;
      break;
    }
    i = cut > 0 ? cut : i + 1;
    keep.push(i);
  }
  return keep;
}
