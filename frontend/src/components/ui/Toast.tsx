import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { useT } from "../../lib/i18n";

export type ToastKind = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastContextValue = {
  toast: (kind: ToastKind, message: string) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * 轻量 Toast：成功/错误/信息三种，2.8 秒自动消失，支持手动关闭。
 * 用于操作反馈（发送成功、模型切换、设置保存等），不承载阻塞决策。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 2800);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[max(20px,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((item) => (
          <div
            className="pointer-events-auto flex max-w-[min(420px,92vw)] animate-[slide-up_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] items-center gap-2.5 rounded-xl border border-line bg-surface-solid py-2.5 pr-2 pl-3.5 shadow-lg backdrop-blur-xl"
            key={item.id}
            role={item.kind === "error" ? "alert" : "status"}
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${item.kind === "success" ? "bg-green-soft text-green" : item.kind === "error" ? "bg-rose/10 text-rose" : "bg-blue-soft text-blue"}`}
            >
              {item.kind === "success" ? (
                <Check size={12} strokeWidth={2.5} />
              ) : item.kind === "error" ? (
                <TriangleAlert size={12} strokeWidth={2.5} />
              ) : (
                <Info size={12} strokeWidth={2.5} />
              )}
            </span>
            <span className="text-[12.5px] font-semibold text-ink">
              {item.message}
            </span>
            <button
              aria-label={t("common.closeNotice")}
              className="ml-1 grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
              onClick={() => dismiss(item.id)}
              type="button"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider");
  return value;
}
