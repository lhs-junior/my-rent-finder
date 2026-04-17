import { useEffect } from "react";

// iOS Safari는 body.style.overflow='hidden'만으로 스크롤이 완전히 잠기지 않고,
// 모달을 닫을 때 스크롤 위치가 유실되거나 페이지가 점프하는 현상이 있다.
// position:fixed + top:-scrollY 로 잠그고, 해제 시 원래 위치로 복귀한다.
// 여러 모달이 중첩 열릴 수 있으므로 참조 카운트로 관리한다.

let lockCount = 0;
let savedScrollY = 0;
let savedBody = null;

function applyLock() {
  savedScrollY = window.scrollY || window.pageYOffset || 0;
  const { body } = document;
  savedBody = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };
  body.style.position = "fixed";
  body.style.top = `-${savedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
}

function releaseLock() {
  if (!savedBody) return;
  const { body } = document;
  body.style.position = savedBody.position;
  body.style.top = savedBody.top;
  body.style.left = savedBody.left;
  body.style.right = savedBody.right;
  body.style.width = savedBody.width;
  body.style.overflow = savedBody.overflow;
  savedBody = null;
  window.scrollTo(0, savedScrollY);
}

export function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    if (lockCount === 0) applyLock();
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) releaseLock();
    };
  }, [active]);
}
