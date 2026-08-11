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

/**
 * 파일로 내려받을 때는 빼는 키.
 *
 * Strava 토큰은 액세스·리프레시 자격증명이다. 계정 백업(cloud.ts)은 본인
 * 계정으로 인증된 자리에 들어가지만, 파일은 메일로 보내고 클라우드 드라이브에
 * 올리고 남에게 넘기기도 하는 물건이다 — 그 안에 남의 계정에 접근할 수 있는
 * 토큰이 평문으로 들어 있으면 안 된다. 파일로 복원한 뒤에는 Strava 연결만
 * 한 번 다시 눌러주면 된다.
 */
const FILE_EXCLUDED_KEYS: readonly string[] = ['run-app-strava-token-v1'];

export function exportBackupFile(): void {
  const backup = collectBackup();
  for (const k of FILE_EXCLUDED_KEYS) delete backup.data[k];
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
  const failed: string[] = [];
  for (const k of KEYS) {
    if (!(k in b.data)) continue;
    try {
      localStorage.setItem(k, JSON.stringify((b.data as Record<string, unknown>)[k]));
      applied++;
    } catch {
      // 저장 공간이 가득 차면 setItem 이 던진다. 그대로 두면 브라우저 원문
      // 오류(QuotaExceededError)가 사용자에게 그대로 뜨고, 무엇이 들어오고
      // 무엇이 빠졌는지 알 수 없다. 나머지 키는 계속 시도하고 마지막에
      // 무엇이 실패했는지 우리말로 알려준다.
      failed.push(k);
    }
  }
  if (applied === 0) {
    throw new Error(
      failed.length
        ? '저장 공간이 부족해 복원하지 못했어요. 마이 → 내 코스에서 오래된 기록을 지운 뒤 다시 시도해 주세요.'
        : '가져올 데이터가 비어 있어요.',
    );
  }
  if (failed.length) {
    throw new Error(
      `저장 공간이 부족해 일부(${failed.length}개)를 복원하지 못했어요. 오래된 기록을 지운 뒤 다시 시도해 주세요.`,
    );
  }
  return applied;
}

export async function importBackupFile(file: File): Promise<number> {
  const text = await file.text();
  return applyBackup(JSON.parse(text));
}
