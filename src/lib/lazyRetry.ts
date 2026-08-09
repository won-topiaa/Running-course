// ---------------------------------------------------------------------------
// 배포 스큐에 견디는 lazy()
//
// 화면들을 지연 로딩으로 쪼갠 뒤 생긴 위험: 사용자가 앱(PWA)을 열어둔 채로
// 새 버전을 배포하면, 열려 있던 옛 index.html 은 옛 해시 이름의 청크를
// 찾는데 서버에는 이미 없다(GitHub Pages 는 옛 파일을 지운다). 그 상태에서
// 아직 안 가 본 탭을 누르면 import 가 404 로 터지고 오류 화면이 뜬다.
//
// 새로고침 한 번이면 새 index 와 새 청크로 정합이 돌아오므로, 청크 로드
// 실패 시 자동으로 한 번 새로고침한다. sessionStorage 표시로 무한 새로고침을
// 막는다 — 두 번째도 실패하면 진짜 문제이니 ErrorBoundary 로 올린다.
//
// 기록 중 새로고침 걱정은 없다: 기록 화면이 떠 있는 동안에는 하단 네비가
// 가려져 새 청크를 요청할 일이 없고, 이미 로드된 청크는 실패하지 않는다.
// ---------------------------------------------------------------------------

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const KEY = 'run-app-chunk-reloaded-v1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem(KEY);
      return mod;
    } catch (e) {
      let alreadyReloaded = false;
      try {
        alreadyReloaded = !!sessionStorage.getItem(KEY);
        if (!alreadyReloaded) sessionStorage.setItem(KEY, '1');
      } catch {
        // sessionStorage 가 막힌 환경(사파리 프라이빗 등) — 새로고침 루프가
        // 될 수 있으니 재시도 없이 오류로 올린다
        alreadyReloaded = true;
      }
      if (!alreadyReloaded) {
        location.reload();
        // 새로고침이 도는 동안 Suspense 를 붙잡아 둘, 끝나지 않는 promise
        return new Promise<never>(() => {});
      }
      throw e;
    }
  });
}
