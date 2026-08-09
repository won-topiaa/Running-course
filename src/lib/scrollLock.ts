// ---------------------------------------------------------------------------
// 바텀시트용 배경 스크롤 잠금
//
// 시트 두 개(코스 상세, 저장·공유)가 각자 body.style.overflow 를 직접 만지면
// 겹쳐 열렸다 하나만 닫힐 때 배경 스크롤이 풀린다. 참조 카운트로 잠근다 —
// 마지막 잠금이 풀릴 때만 원래대로 되돌린다.
// ---------------------------------------------------------------------------

let locks = 0;

/** 잠그고, 되돌리는 함수를 반환한다. 반환 함수는 여러 번 불러도 한 번만 센다. */
export function lockBodyScroll(): () => void {
  locks += 1;
  if (locks === 1) document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) document.body.style.overflow = '';
  };
}
