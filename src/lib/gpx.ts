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
}

export function buildGpx({ name, coords, elevations, times }: GpxOptions): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const pts = coords
    .map(([lat, lng], i) => {
      const ele = elevations?.[i] != null ? `<ele>${elevations[i].toFixed(1)}</ele>` : '';
      const time = times?.[i] != null ? `<time>${new Date(times[i]).toISOString()}</time>` : '';
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
