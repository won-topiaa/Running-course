// ---------------------------------------------------------------------------
// GPX 1.1 생성 + 파일 다운로드
// 기록/생성한 코스를 GPX 로 내보내면 Strava·가민 커넥트·나이키 등 어디든 업로드 가능.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

export interface GpxOptions {
  name: string;
  coords: LatLng[];
  elevations?: number[];
  /** 각 좌표의 시각(epoch ms) — 기록한 러닝에만 */
  times?: number[];
  /**
   * 고도가 실제로 잰 값인지. false 면 <ele> 를 아예 안 쓴다.
   *
   * 고도를 못 받은 코스는 elevations 가 전부 0 이거나 한 값으로 채워져 있다.
   * 그대로 내보내면 '해발 0m 를 계속 달렸다'는 기록이 Strava·가민에 영구로
   * 남는다 — 우리가 잰 적 없는 값이다. GPX 1.1 에서 <ele> 는 선택 항목이라
   * 빼면 받는 쪽이 자기 지형 데이터로 채운다. 그게 지어낸 값보다 정확하다.
   */
  elevationKnown?: boolean;
}

export function buildGpx({
  name,
  coords,
  elevations,
  times,
  elevationKnown = true,
}: GpxOptions): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const pts = coords
    .map(([lat, lng], i) => {
      const ele =
        elevationKnown && elevations?.[i] != null
          ? `<ele>${elevations[i].toFixed(1)}</ele>`
          : '';
      // NaN 은 != null 을 통과하는데 toISOString 이 RangeError 를 던진다 —
      // 손상된 백업에서 온 시각 하나가 내보내기 전체를 죽이면 안 된다
      const time = Number.isFinite(times?.[i])
        ? `<time>${new Date(times![i]).toISOString()}</time>`
        : '';
      return `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">${ele}${time}</trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="런코스" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><time>${new Date().toISOString()}</time></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

export function downloadGpx(filename: string, gpx: string): void {
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.gpx') ? filename : `${filename}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
