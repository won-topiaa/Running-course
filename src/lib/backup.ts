// ---------------------------------------------------------------------------
// 데이터 백업/복원 + 기기 동기화
//
// 이 앱은 서버 없이 모든 데이터를 localStorage 에 둔다. 기기를 바꿔도 데이터가
// 따라가도록 두 가지 경로를 제공한다:
//   1) 파일 내보내기/가져오기 — 항상 동작 (JSON 다운로드 → 새 기기에서 불러오기)
//   2) 동기화 코드 — server/sync-worker 배포 시. 코드 하나로 올리고 내려받는다.
// ---------------------------------------------------------------------------

/** 백업에 포함되는 localStorage 키 (스키마 키는 버전 접미사 포함) */
const KEYS = [
  'run-app-settings-v1',
  'run-app-saved-v1',
  'run-app-routes-v1',
  'run-app-shoes-v1',
  'run-app-strava-token-v1',
  'run-app-sync-code-v1', // 코드도 백업에 포함 — 복원한 기기가 곧바로 자동 백업을 이어간다
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

// --- 동기화 코드 (sync-worker 필요) ------------------------------------------

const SYNC_CODE_KEY = 'run-app-sync-code-v1';

/** 저장된 동기화 코드 — 있으면 자동 백업이 켜진 상태다 */
export function loadSyncCode(): string | null {
  try {
    const raw = localStorage.getItem(SYNC_CODE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* 무시 */
  }
  return null;
}

export function saveSyncCode(code: string | null): void {
  try {
    if (code) localStorage.setItem(SYNC_CODE_KEY, JSON.stringify(code));
    else localStorage.removeItem(SYNC_CODE_KEY);
  } catch {
    /* 무시 */
  }
}

const trim = (u: string) => u.replace(/\/+$/, '');

/** 사람이 옮겨 적기 쉬운 코드 (혼동 글자 제외, 10자) */
export function makeSyncCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export async function pushSync(workerUrl: string, code: string): Promise<void> {
  const res = await fetch(`${trim(workerUrl)}/sync/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectBackup()),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `업로드 실패 (${res.status})`);
  }
}

export async function pullSync(workerUrl: string, code: string): Promise<number> {
  const res = await fetch(`${trim(workerUrl)}/sync/${encodeURIComponent(code)}`);
  if (res.status === 404) throw new Error('그 코드로 올라간 데이터가 없어요.');
  if (!res.ok) throw new Error(`가져오기 실패 (${res.status})`);
  return applyBackup(await res.json());
}
