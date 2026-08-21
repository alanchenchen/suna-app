import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";

/**
 * RuntimeInstallPanel 是 Runtime 引导安装页（首次无 Runtime 或需升级时进入）。
 * 阶段化呈现：检测 → 下载（真实进度条）→ 校验 → 安装 → 启动；1s 轮询状态。
 * 安装完成或失败后由调用方决定下一步（重新连接 / 手动下载）。
 */

export type InstallPhase =
  "detect" | "download" | "verify" | "install" | "start" | "done" | "error";

export type InstallStatus = {
  phase: InstallPhase;
  downloaded_bytes?: number;
  total_bytes?: number;
  mirror?: string;
  error?: string;
};

const POLL_INTERVAL_MS = 1000;

const STEPS: InstallPhase[] = [
  "detect",
  "download",
  "verify",
  "install",
  "start",
];

export function RuntimeInstallPanel({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<InstallStatus>({ phase: "detect" });
  const [installing, setInstalling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/runtime/install/status", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json()) as InstallStatus;
      setStatus(body);
      if (body.phase === "done") {
        stopPolling();
        onDone();
      }
    } catch {
      // 网络错误：保持当前状态，下次轮询重试。
    }
  }, [onDone, stopPolling]);

  const startInstall = useCallback(async () => {
    setInstalling(true);
    try {
      const response = await fetch("/api/v1/runtime/install", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setInstalling(false);
        return;
      }
      const body = (await response.json()) as InstallStatus;
      setStatus(body);
      stopPolling();
      pollRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    } catch {
      setInstalling(false);
    }
  }, [poll, stopPolling]);

  useEffect(() => {
    void poll();
    return stopPolling;
  }, [poll, stopPolling]);

  const currentStep = STEPS.indexOf(status.phase);
  const progress =
    status.phase === "download" && status.total_bytes
      ? Math.min(
          100,
          Math.round(
            ((status.downloaded_bytes ?? 0) / status.total_bytes) * 100,
          ),
        )
      : undefined;

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section
        aria-live="polite"
        className="animate-[message-in_480ms_cubic-bezier(0.2,0.8,0.2,1)_both] w-[min(100%,456px)] rounded-[28px] border border-line bg-surface p-[42px] text-center shadow-lg backdrop-blur-2xl"
      >
        <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-blue-soft text-blue">
          <Icon name="download" size={22} />
        </span>
        <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
          Suna App
        </p>
        <h1 className="mt-2.5 mb-2.5 text-[23px] font-extrabold tracking-tight text-ink">
          {t("install.title")}
        </h1>

        {/* 步骤指示器 */}
        <ol className="mx-auto mt-5 grid max-w-[280px] gap-2 text-left">
          {STEPS.map((step, index) => {
            const done = index < currentStep;
            const active = index === currentStep;
            return (
              <li key={step} className="flex items-center gap-2.5 text-[12px]">
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${
                    done
                      ? "bg-emerald-soft text-emerald"
                      : active
                        ? "bg-blue-soft text-blue"
                        : "bg-surface-raised text-ink-muted"
                  }`}
                >
                  {done ? (
                    <Icon name="check" size={12} />
                  ) : active ? (
                    <span className="animate-pulse">•</span>
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={
                    active
                      ? "font-bold text-ink"
                      : done
                        ? "text-ink-soft"
                        : "text-ink-muted"
                  }
                >
                  {t(`install.step.${step}`)}
                </span>
              </li>
            );
          })}
        </ol>

        {/* 下载进度条（仅 download 阶段显示真实进度） */}
        {status.phase === "download" && (
          <div className="mt-5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] transition-[width] duration-300"
                style={{
                  width: progress !== undefined ? `${progress}%` : "100%",
                }}
              />
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              {progress !== undefined
                ? `${t("install.downloading")} ${progress}%`
                : t("install.downloadingUnknown")}
              {status.mirror ? ` · ${status.mirror}` : ""}
            </p>
          </div>
        )}

        {/* 错误态 */}
        {status.phase === "error" && (
          <div className="mt-5 rounded-xl border border-line bg-surface-raised/60 p-3.5 text-left">
            <p className="text-[12px] leading-relaxed text-ink-soft">
              {status.error || t("install.errorUnknown")}
            </p>
            <p className="mt-2 text-[11px] text-ink-muted">
              {t("install.errorHint")}
            </p>
          </div>
        )}

        {/* 操作区 */}
        <div className="mt-6 grid gap-2">
          {status.phase === "error" ? (
            <>
              <button
                className="inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-[12px] font-extrabold text-white shadow-[0_4px_12px_var(--color-blue-glow)] transition-[transform,box-shadow] duration-150 hover:shadow-[0_7px_18px_var(--color-blue-glow)] active:scale-[0.97]"
                onClick={() => void startInstall()}
                type="button"
              >
                <Icon name="refresh" size={14} />
                {t("install.retry")}
              </button>
              <button
                className="inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line text-[12px] font-extrabold text-ink transition-colors duration-150 hover:bg-surface-raised"
                onClick={onCancel}
                type="button"
              >
                {t("install.cancel")}
              </button>
            </>
          ) : installing || status.phase === "download" ? (
            <button
              className="inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line text-[12px] font-extrabold text-ink transition-colors duration-150 hover:bg-surface-raised"
              onClick={() => {
                // 取消仅退出面板；安装任务在 gateway 侧继续（下次进入可看状态）。
                stopPolling();
                onCancel();
              }}
              type="button"
            >
              {t("install.cancel")}
            </button>
          ) : (
            <button
              className="inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-[12px] font-extrabold text-white shadow-[0_4px_12px_var(--color-blue-glow)] transition-[transform,box-shadow] duration-150 hover:shadow-[0_7px_18px_var(--color-blue-glow)] active:scale-[0.97]"
              onClick={() => void startInstall()}
              type="button"
            >
              {t("install.start")}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
