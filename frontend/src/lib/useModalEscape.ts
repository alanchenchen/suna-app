import { useEffect, useId } from "react";
import { isTopModalLayer, popModalLayer, pushModalLayer } from "./modalStack";

/**
 * 浮层 Escape 管理 hook：打开时登记到浮层栈，Escape 只在
 * 自己是栈顶时触发 onEscape（配合 lib/modalStack 使用）。
 *
 * 解决：多个浮层各自监听 document 的 Escape 时一按全关、
 * 以及下层浮层抢答 Escape 的问题。
 */
export function useModalEscape(active: boolean, onEscape: () => void): string {
  // useId 含冒号（如 ":r1:"），作为栈 id 足够稳定唯一。
  const id = useId();
  useEffect(() => {
    if (!active) return;
    pushModalLayer(id);
    return () => popModalLayer(id);
  }, [active, id]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 只有栈顶浮层响应；下层浮层忽略（事件继续冒泡给上层处理）。
      if (!isTopModalLayer(id)) return;
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // onEscape 由调用方保证稳定（通常为 useCallback 或 setState 包装）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, id]);
  return id;
}
