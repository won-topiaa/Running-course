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

/** 점에서 선분까지의 최단 거리(m). 국소 평면 근사 — 서울 규모에서 충분하다. */
export function pointToSegmentMeters(pt: LatLng, a: LatLng, b: LatLng): number {
  const latRad = (pt[0] * Math.PI) / 180;
  const mx = 111_320 * Math.cos(latRad);
  const my = 110_574;
  const px = (pt[1] - a[1]) * mx;
  const py = (pt[0] - a[0]) * my;
  const bx = (b[1] - a[1]) * mx;
  const by = (b[0] - a[0]) * my;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - bx * t, py - by * t);
}

/** 점에서 좌표열 [from..to] 구간까지의 최단 거리(m) */
function distToPolyline(pt: LatLng, coords: LatLng[], from: number, to: number): number {
  let best = Infinity;
  for (let i = from; i < to; i++) {
    const d = pointToSegmentMeters(pt, coords[i], coords[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 되돌아 나오는 곁가지를 걷어내고 남길 좌표의 인덱스를 고른다.
 *
 * 거리 모드는 시작점 둘레에 고리 정점을 기하학적으로 찍어(generateLoop) 그
 * 점들을 반드시 지나게 경로를 만든다. 정점이 막다른 골목이나 진행 방향과
 * 어긋난 길에 스냅되면 라우터는 거기 들어갔다 그대로 되돌아 나온다 —
 * 지도에서 선이 삐쭉 튀어나온 돌기로 보이고, 그만큼 거리도 부풀려진다.
 *
 * 판별은 두 가지를 본다.
 *
 * 1) 되짚기인가 — 어느 지점에서 출발해 rejoinM 안으로 되돌아왔고, 나가는 쪽
 *    좌표가 하나같이 들어오는 쪽 선에 붙어 있으면(widthM 이내) 같은 길을
 *    되짚은 것이다. 예전엔 '길이가 최대 이탈의 두 배에 가까운가'로 봤는데,
 *    그러면 막다른 길 끝의 회차 공간을 한 바퀴 돌거나 곁가지가 중간에 꺾이면
 *    길이가 늘어나 판정에서 빠졌다 — 실제로 돌기가 남던 주된 이유다.
 *    폭으로 보면 모양과 무관하게 잡히고, 블록을 한 바퀴 도는 구간은 폭이
 *    넓어 그대로 남는다.
 *
 * 2) 본선에서 벗어난 것인가 — 왕복 코스의 반환점도 되짚기라 1)만으로는
 *    구분되지 않는다. 곁가지 앞 THROUGH_M 지점과 뒤 THROUGH_M 지점이 서로
 *    멀면 본선이 계속 이어지는 것이고(→ 돌기), 가까우면 왔던 길을 그대로
 *    되돌아가는 것이다(→ 반환점, 남긴다). 예전엔 앞뒤 '방위'를 비교했는데
 *    모퉁이에서 생긴 돌기가 방위 차 때문에 빠져나갔다.
 *
 * protect 에 준 지점(사용자가 찍은 핀) 근처의 곁가지는 의도된 것이므로 남긴다.
 * 막다른 길에 핀을 찍었으면 거기 들어갔다 나오는 게 맞다.
 *
 * 곁가지를 걷어내면 그 옆에 가려져 있던 곁가지가 드러나므로, 더 걷어낼 것이
 * 없을 때까지(최대 4회) 되풀이한다.
 */
export function spurKeptIndices(
  coords: LatLng[],
  opts: { maxSpurM?: number; rejoinM?: number; protect?: LatLng[]; protectM?: number } = {},
): number[] {
  let idx = coords.map((_, i) => i);
  for (let pass = 0; pass < 4; pass++) {
    const cur = idx.map((i) => coords[i]);
    const kept = spurPass(cur, opts);
    if (kept.length === cur.length) break;
    idx = kept.map((k) => idx[k]);
  }
  return idx;
}

function spurPass(
  coords: LatLng[],
  opts: { maxSpurM?: number; rejoinM?: number; protect?: LatLng[]; protectM?: number },
): number[] {
  const maxSpurM = opts.maxSpurM ?? 200; // 곁가지 편도 최대 길이
  const rejoinM = opts.rejoinM ?? 25; //    되돌아온 지점이 출발 지점과 이 안이면 복귀로 본다
  const protect = opts.protect ?? [];
  const protectM = opts.protectM ?? 30;
  const MIN_SPUR_M = 25; //   이보다 짧으면 좌표 잡음이라 건드리지 않는다
  const WIDTH_M = 30; //      나가는 쪽이 들어오는 쪽 선에서 이 안이면 '같은 길'
  const THROUGH_M = 120; //   본선이 이어지는지 보려고 앞뒤로 재는 거리
  const THROUGH_MIN_M = 40; //앞뒤로 최소 이만큼은 있어야 판단한다
  const RETRACE_NEAR_M = 25; //뒤쪽 경로가 앞쪽 경로에서 이 안이면 '겹친다'
  const RETRACE_FRAC = 0.5; // 겹치는 비율이 이 이상이면 왔던 길을 되돌아가는 것

  const n = coords.length;
  if (n < 4) return coords.map((_, i) => i);

  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + haversineMeters(coords[i - 1], coords[i]);

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
      if (tip <= i + 1 || tip >= j - 1) continue; // 나가는/들어오는 쪽이 없다

      // 1) 나가는 쪽이 들어오는 쪽 선에 붙어 있는가 (같은 길 되짚기)
      let width = 0;
      for (let k = i + 1; k < tip && width <= WIDTH_M; k++) {
        width = Math.max(width, distToPolyline(coords[k], coords, tip, j));
      }
      if (width > WIDTH_M) continue; // 폭이 넓다 — 고리지 곁가지가 아니다

      // 2) 곁가지 앞뒤로 본선이 계속 이어지는가
      let a = i;
      while (a > 0 && cum[i] - cum[a] < THROUGH_M) a--;
      let b = j;
      while (b < n - 1 && cum[b] - cum[j] < THROUGH_M) b++;
      if (cum[i] - cum[a] < THROUGH_MIN_M || cum[b] - cum[j] < THROUGH_MIN_M) continue;
      // 뒤쪽 구간이 앞쪽 구간과 얼마나 겹치는가. 앞뒤 '점 하나씩'을 비교하면
      // 근처에 다른 돌기가 하나만 있어도 그 점이 밀려 판정이 뒤집힌다 —
      // 실제로 복귀 구간에 돌기가 붙은 왕복 코스에서 반환점째로 잘려 나갔다.
      // 구간 전체에서 겹치는 점의 비율로 보면 국소적인 흔들림에 흔들리지 않는다.
      let near = 0;
      let total = 0;
      for (let k = j + 1; k <= b; k++) {
        total++;
        if (distToPolyline(coords[k], coords, a, i) <= RETRACE_NEAR_M) near++;
      }
      if (total === 0 || near / total >= RETRACE_FRAC) {
        continue; // 왔던 길을 그대로 되돌아간다 — 왕복 반환점이지 돌기가 아니다
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

/**
 * 같은 길을 두 번 지나는 구간을 표시한다. 구간 i(coords[i]→coords[i+1])가
 * 경로의 다른 곳에서 한 번 더 지나가면 true.
 *
 * 왕복 코스나 막다른 길을 다녀오는 구간은 선이 정확히 겹쳐 그려져서, 지도만
 * 봐서는 한 번 지나는 길인지 갔다 오는 길인지 알 수 없다. 나중에 그린 선이
 * 앞선 선을 그대로 덮기 때문이다.
 *
 * 경로를 따라 minGapM 이상 떨어진 두 구간이 공간적으로 tolM 안에 겹치면
 * 같은 길로 본다. 바로 옆 구간끼리는 원래 이어져 있으니 제외해야 한다.
 * 중점끼리가 아니라 '중점에서 상대 구간까지'를 양쪽으로 재서, 두 방향이
 * 좌표를 다르게 쪼개 놓아도 잡히게 한다.
 *
 * 방향도 함께 본다 — 같은 길을 되짚으면 두 구간이 나란하거나(같은 방향으로
 * 두 번) 정반대인데(갔다 옴), 모퉁이에서 만나는 두 구간은 수직에 가깝다.
 * 방향을 안 보면 순환로가 닫히는 모퉁이가 겹침으로 잡힌다.
 */
export function retracedSegmentMask(
  coords: LatLng[],
  opts: { tolM?: number; minGapM?: number } = {},
): boolean[] {
  const tolM = opts.tolM ?? 18;
  const minGapM = opts.minGapM ?? 60;
  const PARALLEL_TOL_DEG = 35; // 0도·180도에서 이만큼 벗어나면 같은 길이 아니다
  const segCount = Math.max(0, coords.length - 1);
  const mask = new Array<boolean>(segCount).fill(false);
  if (segCount < 2) return mask;

  const cum = new Array<number>(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) {
    cum[i] = cum[i - 1] + haversineMeters(coords[i - 1], coords[i]);
  }
  // 구간별 진행 방위(도) — 나란한지 보려고 미리 구해 둔다
  const dir = new Array<number>(segCount).fill(0);
  for (let i = 0; i < segCount; i++) {
    const dy = coords[i + 1][0] - coords[i][0];
    const dx =
      (coords[i + 1][1] - coords[i][1]) *
      Math.cos((((coords[i][0] + coords[i + 1][0]) / 2) * Math.PI) / 180);
    dir[i] = (Math.atan2(dx, dy) * 180) / Math.PI;
  }
  // 0도(같은 방향)나 180도(반대 방향)에 얼마나 가까운가
  const offAxis = (a: number, b: number): number => {
    const d = Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);
    return Math.min(d, 180 - d);
  };

  const mid = (i: number): LatLng => [
    (coords[i][0] + coords[i + 1][0]) / 2,
    (coords[i][1] + coords[i + 1][1]) / 2,
  ];
  const along = (i: number) => (cum[i] + cum[i + 1]) / 2;

  // 중점을 격자에 담아 이웃 칸만 비교한다 — 전부 대 전부로 보면 좌표가
  // 수천 개인 경로에서 눈에 띄게 느려진다.
  const origin = coords[0];
  const mx = 111_320 * Math.cos((origin[0] * Math.PI) / 180);
  const my = 110_574;
  const cell = Math.max(1, tolM);
  const grid = new Map<string, number[]>();
  const cellOf = (p: LatLng): [number, number] => [
    Math.floor(((p[1] - origin[1]) * mx) / cell),
    Math.floor(((p[0] - origin[0]) * my) / cell),
  ];
  for (let i = 0; i < segCount; i++) {
    const [cx, cy] = cellOf(mid(i));
    const key = `${cx},${cy}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  for (let i = 0; i < segCount; i++) {
    if (mask[i]) continue;
    const mi = mid(i);
    const [cx, cy] = cellOf(mi);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j <= i) continue;
          if (Math.abs(along(j) - along(i)) < minGapM) continue;
          if (offAxis(dir[i], dir[j]) > PARALLEL_TOL_DEG) continue; // 모퉁이에서 만난 것
          if (pointToSegmentMeters(mi, coords[j], coords[j + 1]) > tolM) continue;
          if (pointToSegmentMeters(mid(j), coords[i], coords[i + 1]) > tolM) continue;
          mask[i] = true;
          mask[j] = true;
        }
      }
    }
  }
  return mask;
}

/**
 * 겹쳐 그려지는 구간을 진행 방향 오른쪽으로 조금 밀어, 갔다 오는 두 방향이
 * 나란한 두 선으로 보이게 한다(실제 좌표가 아니라 '그리기용' 좌표다).
 *
 * 두 방향 모두 자기 진행 방향의 오른쪽으로 밀리므로 서로 반대쪽에 놓인다 —
 * 왕복 2차선 도로처럼 보인다. 겹치지 않는 구간은 그대로 두고, 꼭짓점에서는
 * 앞뒤 구간의 밀린 양을 평균 내 선이 끊겨 보이지 않게 잇는다.
 *
 * 밀어내는 양은 미터 단위라 확대하면 두 선이 벌어져 보이고, 축소하면 한 선으로
 * 합쳐진다 — 멀리서 볼 때 지저분해지지 않는다.
 */
export function separateRetraced(
  coords: LatLng[],
  mask: boolean[],
  offsetM = 7,
): LatLng[] {
  if (coords.length < 2 || !mask.some(Boolean)) return coords;
  const mx = 111_320 * Math.cos((coords[0][0] * Math.PI) / 180);
  const my = 110_574;

  // 구간별로 '오른쪽 법선 × offsetM' (겹치지 않으면 0)
  const segOff: Array<[number, number]> = [];
  for (let i = 0; i < coords.length - 1; i++) {
    if (!mask[i]) {
      segOff.push([0, 0]);
      continue;
    }
    const ex = (coords[i + 1][1] - coords[i][1]) * mx;
    const ey = (coords[i + 1][0] - coords[i][0]) * my;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) {
      segOff.push([0, 0]);
      continue;
    }
    segOff.push([(ey / len) * offsetM, (-ex / len) * offsetM]); // 오른쪽 법선
  }

  return coords.map((pt, i) => {
    const a = segOff[i - 1];
    const b = segOff[i];
    const parts = [a, b].filter(Boolean) as Array<[number, number]>;
    if (!parts.length) return pt;
    const ox = parts.reduce((s, v) => s + v[0], 0) / parts.length;
    const oy = parts.reduce((s, v) => s + v[1], 0) / parts.length;
    if (ox === 0 && oy === 0) return pt;
    return [pt[0] + oy / my, pt[1] + ox / mx] as LatLng;
  });
}
