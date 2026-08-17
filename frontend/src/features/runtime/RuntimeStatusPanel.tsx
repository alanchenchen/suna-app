import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { RuntimeState } from "../../lib/runtimeStatus";

type RuntimeStatusPanelProps = {
  state: RuntimeState;
  onRetry: () => void;
};

const copy = {
  unavailable: {
    titleKey: "status.noRuntime.title",
    descKey: "status.noRuntime.desc",
    hintKey: "status.noRuntime.hint",
  },
  protocol_error: {
    titleKey: "status.incompatible.title",
    descKey: "status.incompatible.desc",
    hintKey: "status.incompatible.hint",
  },
  capability_error: {
    titleKey: "status.version.title",
    descKey: "status.version.desc",
    hintKey: "status.version.hint",
  },
} as const;

export function RuntimeStatusPanel({
  state,
  onRetry,
}: RuntimeStatusPanelProps) {
  const t = useT();
  if (state.kind === "loading") {
    return (
      <main aria-busy="true" className="grid min-h-dvh place-items-center p-6">
        <section
          aria-live="polite"
          className="w-[min(100%,456px)] animate-[message-in_480ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-[28px] border border-line bg-surface p-[42px] text-center shadow-lg backdrop-blur-2xl"
        >
          <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-blue-soft">
            <span className="h-3 w-3 animate-[breathe_1.8s_ease-in-out_infinite] rounded-full bg-blue shadow-[0_0_0_7px_var(--color-blue-glow)]" />
          </span>
          <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
            Suna App
          </p>
          <h1 className="mt-2.5 mb-2.5 text-[23px] font-extrabold tracking-tight text-ink">
            {t("status.connecting")}
          </h1>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            {t("status.detecting")}
          </p>
        </section>
      </main>
    );
  }

  if (state.kind === "ready") return null;

  const content = copy[state.kind];
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section
        aria-live="assertive"
        className="w-[min(100%,456px)] animate-[message-in_480ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-[28px] border border-line bg-surface p-[42px] text-center shadow-lg backdrop-blur-2xl"
      >
        <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-amber-soft text-amber">
          <Icon name="warning" size={22} />
        </span>
        <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
          {t("status.needsAttention")}
        </p>
        <h1 className="mt-2.5 mb-2.5 text-[23px] font-extrabold tracking-tight text-ink">
          {t(content.titleKey)}
        </h1>
        <p className="text-[13px] leading-relaxed text-ink-soft">
          {t(content.descKey)}
        </p>
        <div className="mt-6 mb-3 rounded-xl border border-line bg-surface-subtle p-3.5 text-left text-[11px] leading-relaxed text-ink-soft">
          <strong className="block text-[10px] font-extrabold tracking-wide text-ink uppercase">
            {t("status.next")}
          </strong>
          <span>{t(content.hintKey)}</span>
        </div>
        <div className="flex justify-between px-0.5 text-[10px] text-ink-muted">
          <span>{t("status.code")}</span>
          <code className="font-mono text-ink-soft">{state.code}</code>
        </div>
        <button
          className="mt-6 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue text-[12px] font-extrabold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-[background,transform] duration-150 hover:bg-blue-strong active:scale-[0.97]"
          onClick={onRetry}
          type="button"
        >
          <Icon name="arrow-up" size={16} />
          {t("status.retry")}
        </button>
      </section>
    </main>
  );
}
