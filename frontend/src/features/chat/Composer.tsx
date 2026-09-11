import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/ui/Select";
import { UsageMeter } from "./UsageRing";
import { ActivityStrip } from "./activity";
import { useT } from "../../lib/i18n";
import type {
  AgentUsageEvent,
  ConfigModel,
  MessagePart,
  SteeringMessage,
} from "../../lib/runtimeBridge";

type ComposerProps = {
  onSubmit: (parts: MessagePart[]) => Promise<void>;
  disabled?: boolean;
  waiting?: boolean;
  observer?: boolean;
  canAttachImageUrl?: boolean;
  /** Increment to request focus on the composer textarea. */
  focusTrigger?: number;
  /** 运行中可注入引导消息（agent.steer）。 */
  canSteer?: boolean;
  /** 引导消息上限（hello.limits.max_steering_messages）。 */
  maxSteering?: number;
  /** 当前 run 已注入的引导消息（按 sequence 升序）。 */
  steering?: SteeringMessage[];
  onSteer?: (text: string) => Promise<void>;
  onRemoveSteering?: (id: string) => Promise<void>;
  /** 是否已配置模型：false 时输入框禁用并提示先配置。 */
  hasModels?: boolean;
  /** 输入框输入 / 时打开命令面板（斜杠命令入口）。 */
  onOpenCommands?: () => void;
  /** 已配置模型列表（Codex 模式：输入框上方模型选择器）。 */
  models?: ConfigModel[];
  /** 当前会话模型 ref（provider/model）。 */
  activeModel?: string;
  /** 切换会话模型。 */
  onUpdateModel?: (modelRef: string) => Promise<void>;
  /** 运行中取消当前 run（发送钮的停止形态）。 */
  onStop?: () => void;
  /** 当前 run 用量：嵌入工具行的上下文环（hover/点按显示明细）。 */
  usage?: AgentUsageEvent;
  /** 运行活动（等待模型/工具执行等）：显示在输入卡上方，loading 跟随输入焦点。 */
  activity?: {
    phase?: string;
    pending?: boolean;
    activeTool?: { tool: string; intent?: string; status?: string };
    /** 流式输出阶段：thinking=reasoning 流，replying=assistant 流。 */
    streaming?: "thinking" | "replying";
  };
};

export type ComposerHandle = {
  /** 外部（如空状态建议卡）向输入框填充草稿并聚焦。 */
  fillDraft: (text: string) => void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      onSubmit,
      disabled,
      waiting,
      observer = false,
      canAttachImageUrl,
      focusTrigger = 0,
      canSteer = false,
      maxSteering = 32,
      steering = [],
      onSteer,
      onRemoveSteering,
      hasModels = true,
      onOpenCommands,
      models = [],
      activeModel,
      onUpdateModel,
      onStop,
      usage,
      activity,
    },
    ref,
  ) {
    const t = useT();
    const [draft, setDraft] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const [showImageInput, setShowImageInput] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string>();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
      // 发送后清空草稿时，把自动增高的高度恢复为初始值。
      if (!draft && textareaRef.current) textareaRef.current.style.height = "";
    }, [draft]);

    useEffect(() => {
      if (focusTrigger > 0 && !disabled) textareaRef.current?.focus();
    }, [disabled, focusTrigger]);

    // 暴露给应用壳：空状态建议卡点击后填入示例 prompt 并聚焦输入框。
    useImperativeHandle(
      ref,
      () => ({
        fillDraft(text: string) {
          setDraft(text);
          setError(undefined);
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
      }),
      [],
    );

    /** 校验图片 URL 是否合法 http(s)。 */
    function validateUrl(url: string) {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }

    /** 把输入框的 URL 添加为附件 chip（去重）。 */
    function addImageUrl() {
      const url = imageUrl.trim();
      if (!url) return;
      if (!validateUrl(url)) {
        setError(t("chat.invalidImageUrl"));
        return;
      }
      setError(undefined);
      setImageUrls((value) => (value.includes(url) ? value : [...value, url]));
      setImageUrl("");
    }

    async function submit() {
      const message = draft.trim();
      if ((!message && imageUrls.length === 0) || sending || disabled) return;
      // 运行中（canSteer）：发送即引导（agent.steer），注入给正在跑的 run。
      // 不走乐观清空/awaitingRun——steer 结果由 agent.steering 通知驱动显示。
      if (canSteer && message && onSteer) {
        setSending(true);
        setError(undefined);
        const text = message;
        setDraft("");
        try {
          await onSteer(text);
        } catch (reason) {
          setDraft(text);
          setError(
            reason instanceof Error ? reason.message : t("chat.sendError"),
          );
        } finally {
          setSending(false);
        }
        return;
      }
      if (imageUrl.trim()) {
        // 输入框有未添加的 URL：先校验再视为待提交附件。
        if (!validateUrl(imageUrl.trim())) {
          setError(t("chat.invalidImageUrl"));
          return;
        }
      }
      setSending(true);
      setError(undefined);
      const parts: MessagePart[] = [];
      if (message) parts.push({ type: "text", text: message });
      // 全部附件（已添加 chips + 输入框未添加的一个）一起提交。
      const urls = imageUrls.map((url) => url.trim()).filter(Boolean);
      if (imageUrl.trim()) urls.push(imageUrl.trim());
      for (const url of urls) {
        parts.push({ type: "image", source: { kind: "url", url } });
      }
      // 乐观清空：立即清空输入（发送按钮进入 sending 态），失败时恢复草稿，
      // 避免网络慢时用户误以为没发出而重复提交。
      const prevDraft = draft;
      const prevUrls = imageUrls;
      const prevImageUrl = imageUrl;
      setDraft("");
      setImageUrls([]);
      setImageUrl("");
      setShowImageInput(false);
      try {
        await onSubmit(parts);
      } catch (reason) {
        setDraft(prevDraft);
        setImageUrls(prevUrls);
        setImageUrl(prevImageUrl);
        setError(
          reason instanceof Error ? reason.message : t("chat.sendError"),
        );
      } finally {
        setSending(false);
      }
    }

    return (
      <footer className="composer-area">
        {(activity || waiting || error) && (
          <div className="mx-auto mb-2 grid w-[min(720px,100%)] gap-1.5">
            {/* 活动状态条：细分等待模型/思考中/正在回复/工具执行等阶段。
                位于输入卡上方（loading 跟随输入焦点）；run 开始/结束
                各一次出现/消失，不会逐帧顶动输入卡。 */}
            {activity ? (
              <ActivityStrip {...activity} />
            ) : waiting ? (
              <span className="inline-flex w-fit min-h-[27px] items-center gap-1.5 rounded-full border border-amber/20 bg-amber-soft px-2 py-1 text-[10px] font-extrabold text-amber">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-amber/15">
                  <Icon name="warning" size={13} />
                </span>
                {t("chat.waitingReply")}
              </span>
            ) : null}
            {error && (
              <span className="text-[12px] font-semibold text-rose">
                {error}
              </span>
            )}
          </div>
        )}
        <div
          className={`mx-auto w-[min(720px,100%)] rounded-[16px] border bg-surface-solid transition-colors duration-200 max-[720px]:rounded-[14px] ${observer ? "border-line bg-surface-subtle/50 opacity-80" : "border-line focus-within:border-blue/40"}`}
        >
          {showImageInput && (
            <div className="grid gap-1.5 px-4 pt-3 max-[720px]:px-3">
              <label className="grid gap-1 text-[10px] font-bold text-ink-muted">
                {t("chat.imageUrl")}
                <span className="flex gap-1.5">
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-3 py-2 text-[12px] text-ink outline-none focus:border-blue/40"
                    disabled={disabled || sending}
                    onChange={(event) => setImageUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        addImageUrl();
                      }
                    }}
                    placeholder="https://example.com/image.png"
                    type="url"
                    value={imageUrl}
                  />
                  <button
                    aria-label={t("chat.addImage")}
                    className="shrink-0 cursor-pointer rounded-lg border border-line bg-surface-raised px-3 text-[11px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink disabled:opacity-45"
                    disabled={disabled || sending || !imageUrl.trim()}
                    onClick={addImageUrl}
                    type="button"
                  >
                    {t("chat.addImage")}
                  </button>
                </span>
              </label>
              {/* 已添加的图片附件 chips：可逐个删除（多图支持，设计 §7.5） */}
              {imageUrls.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {imageUrls.map((url) => (
                    <span
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-raised py-0.5 pr-1 pl-2.5 text-[10.5px] font-semibold text-ink-soft"
                      key={url}
                    >
                      <span className="truncate">{url}</span>
                      <button
                        aria-label={t("chat.removeImage", { url })}
                        className="grid h-4 w-4 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
                        disabled={disabled || sending}
                        onClick={() =>
                          setImageUrls((value) =>
                            value.filter((item) => item !== url),
                          )
                        }
                        type="button"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </div>
          )}
          {/* 运行中引导消息列表：已注入的 steer 消息。可见性不依赖本端控制权——
              guest 也要能看到 owner（如 TUI）排队的引导消息；撤回按钮仅对
              can_control 的条目显示，无控制权时只读展示。 */}
          {steering.length > 0 && (
            <div className="flex flex-col gap-1 px-4 pt-3 max-[720px]:px-3">
              {steering.map((item) => (
                <div
                  className="flex items-center gap-2 rounded-lg bg-surface-raised/60 px-2.5 py-1.5"
                  key={item.id}
                >
                  <Icon
                    className="shrink-0 text-ink-muted"
                    name="chevron-right"
                    size={12}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] leading-[1.4] text-ink-soft">
                    {item.parts
                      .filter((part) => part.type === "text")
                      .map((part) => part.text)
                      .join(" ")}
                  </span>
                  {item.can_control && (
                    <button
                      aria-label={t("chat.removeSteering")}
                      className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
                      onClick={() => void onRemoveSteering?.(item.id)}
                      type="button"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* 引导消息已达上限提示（hello.limits.max_steering_messages）。 */}
          {canSteer && steering.length >= maxSteering && (
            <div className="mx-4 mt-3 rounded-lg border border-ink-muted/20 bg-surface-raised/50 px-2.5 py-1.5 text-[11px] text-ink-muted max-[720px]:mx-3">
              {t("chat.steeringLimit", { count: String(maxSteering) })}
            </div>
          )}
          {/* ZCode 输入区形态：上下两行——textarea 独占上部，
              工具行贴底（左：附件入口；右：模型 + 发送）。 */}
          <textarea
            aria-label={t("chat.inputLabel")}
            className="min-h-[52px] max-h-[148px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[13.5px] leading-[22px] text-ink outline-none focus-visible:shadow-none placeholder:text-ink-muted max-[720px]:min-h-[48px] max-[720px]:px-3 max-[720px]:text-[13px]"
            disabled={disabled || sending || !hasModels}
            onChange={(event) => setDraft(event.target.value)}
            onInput={(event) => {
              // 随内容自动增高，最多 148px（与 CSS max-height 一致）；超出后内部滚动。
              const element = event.currentTarget;
              element.style.height = "auto";
              element.style.height = `${Math.min(element.scrollHeight, 148)}px`;
            }}
            onKeyDown={(event) => {
              // 斜杠命令：草稿为空时输入 / 打开命令面板（Discord/Slack 惯例）。
              // isComposing：IME 组合输入中的 / 是选词，不触发。
              if (
                event.key === "/" &&
                !event.nativeEvent.isComposing &&
                !draft.trim() &&
                !canSteer &&
                !disabled &&
                onOpenCommands
              ) {
                event.preventDefault();
                onOpenCommands();
                return;
              }
              // isComposing：中文输入法组合输入中的回车用于选词，不能发送。
              // Cmd/Ctrl+Enter 强制发送（组合键下忽略 Shift，防止 IME 占用场景）；
              // 普通 Enter 非 Shift 发送，Shift+Enter 换行。
              const mod = event.metaKey || event.ctrlKey;
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                (mod || !event.shiftKey)
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              !hasModels
                ? t("chat.noModelPlaceholder")
                : canSteer
                  ? t("chat.steerPlaceholder")
                  : disabled
                    ? // 观察态的说明已由状态条（SessionStatusBars）承担，
                      // 占位符不再重复一遍——只提示这里为什么不可输入。
                      t("chat.viewOnlyPlaceholder")
                    : t("chat.sendPlaceholder")
            }
            ref={textareaRef}
            rows={1}
            value={draft}
          />
          {/* 底部工具行：左侧附件 + 模型 + 上下文 badge，右侧发送/停止。 */}
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 max-[720px]:px-2 max-[720px]:pb-2">
            <div className="flex min-w-0 items-center gap-1">
              {canAttachImageUrl && (
                <button
                  aria-expanded={showImageInput}
                  aria-label={t("chat.imageUrl")}
                  className={`grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[10px] transition-colors duration-150 max-[720px]:h-10 max-[720px]:w-10 ${showImageInput ? "bg-blue-soft text-blue-strong" : "text-ink-muted hover:bg-surface-subtle hover:text-ink"}`}
                  disabled={disabled || sending}
                  onClick={() => setShowImageInput((value) => !value)}
                  type="button"
                >
                  {/* plus 旋转 45° 形变为 ×（单图标 morph，无状态切换闪烁）。 */}
                  <Icon
                    className={`transition-transform duration-200 ${showImageInput ? "rotate-45" : ""}`}
                    name="plus"
                    size={16}
                  />
                </button>
              )}
              {/* 模型选择器（Codex/ZCode 形态）：工具行左侧的紧凑下拉。 */}
              {hasModels && models.length > 0 && (
                <Select
                  ariaLabel={t("chat.modelPicker")}
                  disabled={disabled || !onUpdateModel}
                  fitContent
                  onValueChange={(value) => void onUpdateModel?.(value)}
                  options={models.map((model) => ({
                    value: `${model.provider}/${model.model}`,
                    label: `${model.provider}/${model.model}`,
                  }))}
                  value={
                    activeModel &&
                    models.some(
                      (model) =>
                        `${model.provider}/${model.model}` === activeModel,
                    )
                      ? activeModel
                      : `${models[0].provider}/${models[0].model}`
                  }
                />
              )}
              <UsageMeter usage={usage} />
            </div>
            {/* 右下主按钮（主流 agent 形态）：运行中时发送钮原地变为同色圆形停止钮；
                其余时刻是发送钮（含 sending 转圈）。 */}
            {canSteer && onStop ? (
              <button
                aria-label={t("chat.stopRun")}
                className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-blue text-white transition-colors duration-150 hover:bg-blue-strong active:scale-90 max-[720px]:h-10 max-[720px]:w-10"
                onClick={onStop}
                type="button"
              >
                <Icon name="stop" size={13} />
              </button>
            ) : (
              <button
                aria-label={t("chat.send")}
                className="group/send grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-blue text-white transition-colors duration-150 hover:bg-blue-strong active:scale-90 disabled:cursor-default disabled:opacity-40 max-[720px]:h-10 max-[720px]:w-10"
                disabled={
                  (canSteer
                    ? !draft.trim()
                    : !draft.trim() &&
                      !imageUrl.trim() &&
                      imageUrls.length === 0) ||
                  disabled ||
                  sending
                }
                onClick={() => void submit()}
                type="button"
              >
                {sending ? (
                  <Icon
                    aria-hidden="true"
                    className="animate-spin"
                    name="loader"
                    size={15}
                  />
                ) : (
                  <Icon
                    className="transition-transform duration-160 group-hover/send:animate-[icon-lift_240ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
                    name="arrow-up"
                    size={16}
                  />
                )}
              </button>
            )}
          </div>
        </div>
        {/* 提示行仅桌面显示（窄屏空间有限且用户熟悉触屏输入）。 */}
        <p className="mx-auto mt-1.5 w-[min(720px,100%)] text-center text-[10px] font-semibold text-ink-muted/70 max-[720px]:hidden">
          {t("chat.composerHint")}
        </p>
      </footer>
    );
  },
);
