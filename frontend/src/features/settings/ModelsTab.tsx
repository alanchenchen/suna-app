import { useState } from "react";
import { Select } from "../../components/ui/Select";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useT } from "../../lib/i18n";
import type { ConfigModel } from "../../lib/runtimeBridge";
import type { SettingsTabProps } from "./RuntimeSettings";

type ModelDraft = {
  provider: string;
  protocol: string;
  model: string;
  base_url: string;
  context_window: string;
  max_output_tokens: string;
  api_key: string;
  strengths: string;
  subtask_for: string;
};

const EMPTY_DRAFT: ModelDraft = {
  provider: "",
  protocol: "openai_chat",
  model: "",
  base_url: "",
  context_window: "",
  max_output_tokens: "",
  api_key: "",
  strengths: "",
  subtask_for: "",
};

const PROTOCOLS = [
  "openai_chat",
  "openai_responses",
  "anthropic",
  "ollama",
  "gemini",
];

function modelRef(model: ConfigModel) {
  return `${model.provider}/${model.model}`;
}

function fromModel(model: ConfigModel): ModelDraft {
  return {
    provider: model.provider,
    protocol: model.protocol,
    model: model.model,
    base_url: model.base_url ?? "",
    context_window: model.context_window ? String(model.context_window) : "",
    max_output_tokens: model.max_output_tokens
      ? String(model.max_output_tokens)
      : "",
    api_key: "",
    strengths: (model.strengths ?? []).join(", "),
    subtask_for: (model.subtask_for ?? []).join(", "),
  };
}

/** 模型 Tab：列表 + 新增/编辑（对齐 TUI 表单）+ 删除 + 激活（设计 §10.2）。 */
export function ModelsTab({ config, onConfig, rpc }: SettingsTabProps) {
  const t = useT();
  const [editing, setEditing] = useState<ConfigModel | "new" | undefined>();
  const [draft, setDraft] = useState<ModelDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string>();
  // 删除确认：先弹 ConfirmDialog，确认后才执行删除。
  const [pendingDelete, setPendingDelete] = useState<ConfigModel>();

  function startEdit(model: ConfigModel | "new") {
    setEditing(model);
    setDraft(model === "new" ? EMPTY_DRAFT : fromModel(model));
    setError(undefined);
  }

  async function save() {
    if (!draft.provider.trim() || !draft.model.trim()) {
      setError(t("models.error.required"));
      return;
    }
    if (!draft.base_url.trim()) {
      setError(t("models.error.endpoint"));
      return;
    }
    const payload = {
      provider: draft.provider.trim(),
      protocol: draft.protocol,
      model: draft.model.trim(),
      base_url: draft.base_url.trim(),
      context_window: draft.context_window
        ? Number(draft.context_window)
        : undefined,
      max_output_tokens: draft.max_output_tokens
        ? Number(draft.max_output_tokens)
        : undefined,
      strengths: draft.strengths
        ? draft.strengths
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
      subtask_for: draft.subtask_for
        ? draft.subtask_for
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
    };
    try {
      const next = await rpc("config.set", {
        action: "upsert_model",
        model: payload,
        api_key: draft.api_key.trim() || undefined,
      });
      onConfig(next);
      setEditing(undefined);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("models.error.save"),
      );
    }
  }

  async function remove(model: ConfigModel) {
    // 确认已上移到 ConfirmDialog：这里只执行删除。
    const hasKey = model.has_api_key;
    try {
      const next = await rpc("config.set", {
        action: "delete_model",
        model_ref: modelRef(model),
        delete_api_key: hasKey,
      });
      onConfig(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("models.error.delete"),
      );
    }
  }

  async function activate(model: ConfigModel) {
    try {
      const next = await rpc("config.set", {
        action: "activate_model",
        active_model: modelRef(model),
      });
      onConfig(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("models.error.activate"),
      );
    }
  }

  if (!config) return null;
  const activeRef = config.active_model;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[13px] font-extrabold text-ink">
          {t("models.title")}
        </h3>
        <button
          className="cursor-pointer rounded-lg bg-blue px-3 py-1.5 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong"
          onClick={() => startEdit("new")}
          type="button"
        >
          {t("models.add")}
        </button>
      </div>

      {editing ? (
        <form
          className="grid gap-3 rounded-xl border border-blue/30 bg-blue-soft/25 p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Provider"
              onChange={(value) => setDraft({ ...draft, provider: value })}
              required
              value={draft.provider}
            />
            <label className="grid gap-1 text-[11px] font-bold text-ink-soft">
              {t("models.protocol")}
              <Select
                ariaLabel={t("models.protocol")}
                onValueChange={(value) =>
                  setDraft({ ...draft, protocol: value })
                }
                options={PROTOCOLS.map((value) => ({ value, label: value }))}
                value={draft.protocol}
              />
            </label>
          </div>
          <Field
            label={t("models.modelName")}
            onChange={(value) => setDraft({ ...draft, model: value })}
            required
            value={draft.model}
          />
          <Field
            label="Endpoint"
            onChange={(value) => setDraft({ ...draft, base_url: value })}
            placeholder="https://api.example.com"
            required
            value={draft.base_url}
          />
          <Field
            label="API Key"
            onChange={(value) => setDraft({ ...draft, api_key: value })}
            placeholder={
              editing !== "new" && editing.has_api_key
                ? t("models.endpointKeep")
                : t("models.endpointOptional")
            }
            type="password"
            value={draft.api_key}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Context Window"
              onChange={(value) =>
                setDraft({ ...draft, context_window: value })
              }
              placeholder="128000"
              type="number"
              value={draft.context_window}
            />
            <Field
              label="Max Output"
              onChange={(value) =>
                setDraft({ ...draft, max_output_tokens: value })
              }
              placeholder="8192"
              type="number"
              value={draft.max_output_tokens}
            />
          </div>
          <Field
            label={t("models.strengths")}
            onChange={(value) => setDraft({ ...draft, strengths: value })}
            value={draft.strengths}
          />
          <Field
            label={t("models.subtaskFor")}
            onChange={(value) => setDraft({ ...draft, subtask_for: value })}
            value={draft.subtask_for}
          />
          {error && (
            <small className="text-[12px] font-semibold text-rose">
              {error}
            </small>
          )}
          <div className="flex justify-end gap-2">
            <button
              className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle"
              onClick={() => setEditing(undefined)}
              type="button"
            >
              {t("models.cancel")}
            </button>
            <button
              className="cursor-pointer rounded-lg bg-blue px-3 py-1.5 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong"
              type="submit"
            >
              {t("models.save")}
            </button>
          </div>
        </form>
      ) : (
        config.models.map((model) => {
          const ref = modelRef(model);
          const active = ref === activeRef;
          return (
            <div
              className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-[13px]"
              key={ref}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <strong className="truncate text-ink">{ref}</strong>
                  {active && (
                    <span className="rounded-sm bg-green-soft px-1.5 py-px text-[10px] font-bold text-green">
                      {t("models.inUse")}
                    </span>
                  )}
                </span>
                <small className="mt-0.5 block truncate text-[11px] font-normal text-ink-muted">
                  {model.protocol}
                  {model.base_url ? ` · ${model.base_url}` : ""}
                  {model.context_window ? ` · ${model.context_window} ctx` : ""}
                </small>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {!active && (
                  <button
                    className="cursor-pointer text-[11px] font-bold text-blue-strong transition-opacity duration-150 hover:opacity-75"
                    onClick={() => void activate(model)}
                    type="button"
                  >
                    {t("models.setDefault")}
                  </button>
                )}
                <button
                  className="cursor-pointer text-[11px] font-bold text-ink-muted transition-opacity duration-150 hover:text-ink"
                  onClick={() => startEdit(model)}
                  type="button"
                >
                  {t("models.edit")}
                </button>
                <button
                  className="cursor-pointer text-[11px] font-bold text-rose transition-opacity duration-150 hover:opacity-75"
                  onClick={() => setPendingDelete(model)}
                  type="button"
                >
                  {t("models.delete")}
                </button>
              </span>
            </div>
          );
        })
      )}
      {!editing && config.models.length === 0 && (
        <p className="text-[13px] text-ink-muted">{t("models.empty")}</p>
      )}
      <ConfirmDialog
        busy={false}
        confirmLabel={t("models.delete")}
        danger
        description={
          pendingDelete?.has_api_key
            ? t("models.deleteConfirm", {
                name: pendingDelete ? modelRef(pendingDelete) : "",
              })
            : t("models.deleteConfirmSimple", {
                name: pendingDelete ? modelRef(pendingDelete) : "",
              })
        }
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
          setPendingDelete(undefined);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
        open={Boolean(pendingDelete)}
        title={t("models.deleteTitle")}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-bold text-ink-soft">
      {label}
      <input
        className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-[12px] text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}
