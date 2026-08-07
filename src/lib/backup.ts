// ---------------------------------------------------------------------------
// 데이터 백업/복원 — 파일 내보내기/가져오기
//
// 계정 로그인(cloud.ts)이 주 경로이고, 이 파일은 로그인 없이 쓰는 안전망이다:
// 기록·설정 전체를 JSON 으로 내려받아 두거나 다른 기기에서 불러온다.
// collectBackup/applyBackup 은 클라우드 백업(cloud.ts)도 같이 쓴다.
// ---------------------------------------------------------------------------

/** 백업에 포함되는 localStorage 키 (스키마 키는 버전 접미사 포함) */
const KEYS = [
  'run-app-settings-v1',
  'run-app-saved-v1',
  'run-app-routes-v1',
  'run-app-shoes-v1',
  'run-app-strava-token-v1',
] as const;

export interface BackupFile {
  app: 'runcourse';
  version: 1;
  exportedAt: string;
  data: Record<string, unknown>;
}

export function collectBackup(): BackupFile {
  const data: Record<string, unknown> = {};
  for (const k of KEYS) {
    try {
      const raw = localStorage.getItem(k);
      if (raw != null) data[k] = JSON.parse(raw);
    } catch {
      /* 손상된 항목은 건너뜀 */
    }
  }
  return { app: 'runcourse', version: 1, exportedAt: new Date().toISOString(), data };
}

export function exportBackupFile(): void {
  const backup = collectBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `runcourse-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 백업 객체를 localStorage 에 적용. 성공 시 항목 수 반환. */
export function applyBackup(obj: unknown): number {
  const b = obj as Partial<BackupFile> | null;
  if (!b || b.app !== 'runcourse' || typeof b.data !== 'object' || b.data === null) {
    throw new Error('런코스 백업 파일이 아니에요.');
  }
  let applied = 0;
  for (const k of KEYS) {
    if (k in b.data) {
      localStorage.setItem(k, JSON.stringify((b.data as Record<string, unknown>)[k]));
      applied++;
    }
  }
  if (applied === 0) throw new Error('가져올 데이터가 비어 있어요.');
  return applied;
}

export async function importBackupFile(file: File): Promise<number> {
  const text = await file.text();
  return applyBackup(JSON.parse(text));
}
