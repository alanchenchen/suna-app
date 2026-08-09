/**
 * Browser client for the local Gateway bridge. Bridge IDs stay in memory only;
 * Runtime content is untrusted and must never be written to browser storage.
 */

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue =
  JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONRecord = Record<string, JSONValue>;

export type RuntimeHello = {
  protocol_version: string;
  runtime_version: string;
  transport: string;
  capabilities: Record<string, boolean>;
  content_sources: Record<string, boolean>;
  limits?: Record<string, number>;
  metadata?: JSONRecord;
};

export type AttachmentRef = {
  kind: "path" | "url" | "attachment";
  path?: string;
  url?: string;
  mime_type?: string;
  name?: string;
  size?: number;
};

export type MessagePart =
  { type: "text"; text: string } | { type: "image"; source: AttachmentRef };

export type SessionStatus = "idle" | "running" | "waiting" | "compacting";
export type SessionInfo = {
  id: string;
  title?: string;
  cwd: string;
  model_ref?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  last_attached_at?: string;
  status: SessionStatus;
  client_count: number;
};

export type SnapshotMessage = { role: string; content: string };
export type ToolSummaryItem = {
  tool: string;
  status: string;
  summary?: string;
};
export type ToolSummary = {
  total: number;
  success: number;
  failed: number;
  changes?: { tool: string; count: number }[];
  failures?: ToolSummaryItem[];
  recent?: ToolSummaryItem[];
  omitted?: number;
};
export type CurrentRun = {
  /** Present for an active run; used to reject notifications from a prior attach. */
  run_id?: string;
  status: SessionStatus;
  phase?: "model" | "tool" | "compact" | "guard" | "ask" | "skill";
  assistant_buffer?: string;
  reasoning_buffer?: string;
  waiting_type?: "ask" | "guard";
  can_control: boolean;
};
export type SessionSnapshot = {
  session: SessionInfo;
  messages?: SnapshotMessage[];
  compacted?: boolean;
  tool_summary?: ToolSummary;
  current_run?: CurrentRun;
};

export type ModelError = {
  kind: "unknown" | "http" | "network" | "cancelled" | "internal";
  message: string;
  status_code?: number;
  code?: string;
  type?: string;
  provider?: string;
  model?: string;
};
export type RunError = {
  kind: "no_model_configured" | "session_model_unavailable";
  model_ref?: string;
};
export type AgentRunEvent = {
  run_id?: string;
  state: "running" | "retrying" | "done" | "failed" | "cancelled";
  phase?: "model" | "tool" | "compact" | "guard" | "ask" | "skill";
  can_control: boolean;
  message?: string;
  attempt?: number;
  max_attempts?: number;
  delay_ms?: number;
  error?: ModelError;
  run_error?: RunError;
  resume_available?: boolean;
};
export type AgentUsageEvent = {
  run_id?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  context_tokens?: number;
  estimated_context_tokens?: number;
  context_window?: number;
  duration_ms?: number;
  tokens_per_sec?: number;
};
export type ToolStartEvent = {
  id: string;
  tool: string;
  params: JSONRecord;
  intent?: string;
};
export type ToolGuardEvent = {
  tool_call_id: string;
  tool: string;
  risk: string;
  decision: string;
  source: string;
  reason?: string;
  suggestion?: string;
  review_code?: string;
  review_message?: string;
};
export type ToolEndEvent = {
  id: string;
  tool: string;
  result: string;
  error?: boolean;
  result_truncated?: boolean;
  result_bytes?: number;
  metadata?: JSONRecord;
};
/**
 * 一次工具调用的完整生命周期记录，按执行顺序追加到时间线。
 * 由 tool_start / tool_guard / tool_end 三个事件渐进更新。
 */
export type ToolFlowItem = {
  id: string;
  tool: string;
  intent?: string;
  params?: JSONRecord;
  status: "running" | "guard" | "success" | "failed";
  result?: string;
  resultTruncated?: boolean;
  error?: boolean;
};
/**
 * 时间线中的一段叙事：思考 / 回复 / 工具，按真实到达顺序排列。
 * reasoning 与 assistant 是流式累积段（done 表示该段已结束），
 * tool 是工具调用生命周期记录。
 */
export type FlowSegment =
  | { kind: "reasoning"; id: number; text: string; done: boolean }
  | { kind: "assistant"; id: number; text: string; done: boolean }
  | { kind: "tool"; item: ToolFlowItem };
export type AskUserEvent = {
  question: string;
  options?: string[];
  id: string;
  session_id?: string;
  can_reply: boolean;
  allow_custom: boolean;
};
export type GuardConfirmEvent = {
  id: string;
  tool_call_id?: string;
  tool: string;
  params: JSONRecord;
  risk: string;
  reason: string;
  suggestion?: string;
  review_code?: string;
  review_message?: string;
  session_id?: string;
  can_reply: boolean;
};
export type CompactResultEvent = {
  before_tokens: number;
  after_tokens: number;
  context_window: number;
  turns_compressed: number;
  summary_tokens: number;
  truncated_outputs: number;
  noop?: boolean;
  running?: boolean;
  error?: string;
};

export type UsagePeriod = {
  input_tokens: number;
  output_tokens: number;
  requests: number;
};
export type ConfigModel = {
  provider: string;
  protocol: string;
  model: string;
  base_url?: string;
  context_window?: number;
  max_output_tokens?: number;
  strengths?: string[];
  subtask_for?: string[];
  reasoning?: JSONRecord;
  has_api_key?: boolean;
};
export type RuntimeConfig = {
  models: ConfigModel[];
  active_model: string;
  locale?: string;
  theme?: string;
  guard_mode?: string;
  workspace?: string;
};
export type ConfigSetParams = {
  action: "upsert_model" | "delete_model" | "activate_model" | "update_general";
  model?: ConfigModel;
  model_ref?: string;
  active_model?: string;
  api_key?: string;
  delete_api_key?: boolean;
  locale?: string;
  theme?: string;
  guard_mode?: string;
  workspace?: string | null;
};
export type MemoryItem = {
  id: string;
  content: string;
  kind: string;
  tags?: string[];
  priority: number;
  is_core: boolean;
};
export type SkillInfo = {
  name: string;
  description?: string;
  enabled: boolean;
  valid: boolean;
  reasons?: string[];
  path?: string;
  error?: string;
};
export type MCPServerInfo = {
  id?: string;
  name: string;
  transport?: string;
  command?: string;
  active: boolean;
  configured: boolean;
  tool_count: number;
  error?: string;
};

export type RuntimeBridgeMethods = {
  "session.list": {
    params: { cwd?: string; active_only?: boolean };
    result: { sessions: SessionInfo[] };
  };
  "session.create": {
    params: { cwd: string; title?: string };
    result: SessionSnapshot;
  };
  "session.attach": {
    params: { session_id: string; require_active?: boolean };
    result: SessionSnapshot;
  };
  "session.detach": {
    params: Record<string, never>;
    result: { status: "detached" };
  };
  "session.update": {
    params: {
      session_id: string;
      title?: string | null;
      model_ref?: string | null;
    };
    result: SessionSnapshot;
  };
  "session.delete": {
    params: { session_id: string };
    result: { deleted: boolean };
  };
  "session.compact": {
    params: Record<string, never>;
    result: { status: "ok" };
  };
  "session.usage": {
    params: Record<string, never>;
    result: { today: UsagePeriod; week: UsagePeriod; month: UsagePeriod };
  };
  "agent.sendMessage": {
    params: { client_msg_id?: string; parts: MessagePart[] };
    result: { status: "processing" };
  };
  "agent.resumeRun": {
    params: Record<string, never>;
    result: { status: "processing" };
  };
  "agent.cancel": {
    params: Record<string, never>;
    result: { status: "cancelled" };
  };
  "agent.askReply": {
    params: { id: string; answer: string };
    result: { status: "ok" };
  };
  "agent.guardReply": {
    params: { id: string; decision: "approve" | "reject" };
    result: { status: "ok" };
  };
  "config.get": { params: Record<string, never>; result: RuntimeConfig };
  "config.set": { params: ConfigSetParams; result: RuntimeConfig };
  "memory.list": {
    params: Record<string, never>;
    result: { memories: MemoryItem[] };
  };
  "memory.delete": { params: { id: string }; result: { deleted: boolean } };
  "memory.clear": {
    params: Record<string, never>;
    result: { deleted_count: number };
  };
  "skill.list": {
    params: Record<string, never>;
    result: { skills: SkillInfo[] };
  };
  "skill.set": {
    params: { name: string; enabled: boolean };
    result: { status: string };
  };
  "mcp.list": {
    params: Record<string, never>;
    result: { servers: MCPServerInfo[] };
  };
  "mcp.toggle": {
    params: { name: string; active: boolean };
    result: { status: string };
  };
  "mcp.reload": { params: { name: string }; result: { status: string } };
};
export type RuntimeBridgeMethod = keyof RuntimeBridgeMethods;
export type RuntimeBridgeParams<M extends RuntimeBridgeMethod> =
  RuntimeBridgeMethods[M]["params"];
export type RuntimeBridgeResult<M extends RuntimeBridgeMethod> =
  RuntimeBridgeMethods[M]["result"];

export type RuntimeNotifications = {
  "agent.delta": {
    run_id?: string;
    kind: "assistant" | "reasoning";
    content: string;
  };
  "agent.run": AgentRunEvent;
  "agent.usage": AgentUsageEvent;
  "agent.tool_start": ToolStartEvent;
  "agent.tool_guard": ToolGuardEvent;
  "agent.tool_end": ToolEndEvent;
  "agent.ask_user": AskUserEvent;
  "agent.guard_confirm": GuardConfirmEvent;
  "agent.interaction_resolved": { id: string; session_id?: string };
  "session.user_message": { session_id?: string; parts?: MessagePart[] };
  "session.updated": { session: SessionInfo };
  "session.compact_result": CompactResultEvent;
  "config.state": RuntimeConfig;
  "memory.state": { memories: MemoryItem[] };
  "skill.load": { name: string; status?: string };
  "skill.review": {
    name: string;
    status?: string;
    review?: string;
    error?: string;
  };
};
export type RuntimeNotificationMethod = keyof RuntimeNotifications;
export type RuntimeNotification = {
  [M in RuntimeNotificationMethod]: {
    method: M;
    params: RuntimeNotifications[M];
  };
}[RuntimeNotificationMethod];

export class RuntimeBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "RuntimeBridgeError";
  }
  get status() {
    return this.options.status;
  }
  get retryable() {
    return (
      this.options.retryable ??
      (this.status === undefined || this.status >= 500)
    );
  }
}

export type RuntimeBridgeClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  eventSourceFactory?: (url: string) => EventSource;
};
export type BridgeConnection = { id: string; hello: RuntimeHello };
const ROOT = "/api/v1/bridge";
const DEFAULT_TIMEOUT_MS = 15_000;

export class RuntimeBridgeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly eventSourceFactory: (url: string) => EventSource;
  private connection?: BridgeConnection;
  private activeSource?: EventSource;
  private reconnectTimer?: number;
  private reconnectAttempts = 0;
  private lifecycleGeneration = 0;
  private closed = false;
  private readonly baseReconnectDelayMs = 1_000;
  private readonly maxReconnectDelayMs = 30_000;

  constructor(options: RuntimeBridgeClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.eventSourceFactory =
      options.eventSourceFactory ?? ((url) => new EventSource(url));
  }
  currentConnection(): BridgeConnection | undefined {
    return this.connection;
  }
  async connect(signal?: AbortSignal): Promise<BridgeConnection> {
    this.closed = false;
    this.cancelReconnect();
    if (this.connection) return this.connection;
    const body = await this.request(
      "POST",
      `${ROOT}/connect`,
      undefined,
      signal,
    );
    if (!isBridgeConnection(body))
      throw new RuntimeBridgeError(
        "invalid_response",
        "Gateway returned an invalid Runtime connection.",
      );
    this.connection = body;
    this.reconnectAttempts = 0;
    return body;
  }
  async disconnect(): Promise<void> {
    ++this.lifecycleGeneration;
    this.closed = true;
    this.cancelReconnect();
    this.activeSource?.close();
    this.activeSource = undefined;
    const id = this.connection?.id;
    this.connection = undefined;
    if (id) await this.deleteConnection(id);
  }
  async disconnectIfCurrent(id: string): Promise<void> {
    if (this.connection?.id !== id) return;
    ++this.lifecycleGeneration;
    this.cancelReconnect();
    this.activeSource?.close();
    this.activeSource = undefined;
    this.connection = undefined;
    await this.deleteConnection(id);
  }
  private async deleteConnection(id: string): Promise<void> {
    try {
      await this.request("DELETE", `${ROOT}/${encodeURIComponent(id)}`);
    } catch {
      /* Expired bridge connections are already closed. */
    }
  }
  async rpc<M extends RuntimeBridgeMethod>(
    method: M,
    params: RuntimeBridgeParams<M>,
    signal?: AbortSignal,
  ): Promise<RuntimeBridgeResult<M>> {
    const id = this.connection?.id;
    if (!id)
      throw new RuntimeBridgeError(
        "not_connected",
        "Runtime is not connected.",
        { retryable: true },
      );
    const body = await this.request(
      "POST",
      `${ROOT}/${encodeURIComponent(id)}/rpc`,
      { method, params },
      signal,
    );
    if (!isRecord(body) || !("result" in body))
      throw new RuntimeBridgeError(
        "invalid_response",
        "Gateway returned an invalid Runtime response.",
      );
    return body.result as RuntimeBridgeResult<M>;
  }
  subscribe(
    onNotification: (notification: RuntimeNotification) => void,
    onError?: (error: RuntimeBridgeError) => void,
    onReconnected?: () => void | Promise<void>,
  ): () => void {
    const id = this.connection?.id;
    if (!id)
      throw new RuntimeBridgeError(
        "not_connected",
        "Runtime is not connected.",
        { retryable: true },
      );
    this.cancelReconnect();
    // A subscription owns one lifecycle generation. Every replacement or
    // explicit disconnect invalidates callbacks from the old EventSource.
    const generation = ++this.lifecycleGeneration;
    const source = this.eventSourceFactory(
      `${this.baseUrl}${ROOT}/${encodeURIComponent(id)}/events`,
    );
    this.activeSource?.close();
    this.activeSource = source;
    let intentional = false;
    let handlingError = false;
    const isCurrent = () =>
      !intentional &&
      !this.closed &&
      generation === this.lifecycleGeneration &&
      this.connection?.id === id &&
      this.activeSource === source;
    const restartStream = () => {
      if (handlingError || !isCurrent()) return;
      handlingError = true;
      source.close();
      this.activeSource = undefined;
      // A Gateway bridge may have been retired with its Runtime socket. Do not
      // retry an opaque ID forever: revoke it locally, then reconnect after a
      // bounded backoff and restore state from Runtime's authoritative attach.
      void this.dropConnection(id, generation).finally(() => {
        // dropConnection is asynchronous. A user may have connected another
        // bridge while it was pending, so validate ownership again here.
        if (
          generation === this.lifecycleGeneration &&
          !this.closed &&
          !this.connection
        )
          this.scheduleStreamReconnect(
            onNotification,
            onError,
            onReconnected,
            generation,
          );
      });
    };
    source.addEventListener("notification", (event) => {
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (isNotification(value) && isCurrent()) onNotification(value);
      } catch {
        if (!isCurrent()) return;
        onError?.(
          new RuntimeBridgeError(
            "invalid_event",
            "Gateway sent an invalid Runtime event.",
          ),
        );
      }
    });
    source.onerror = () => {
      // EventSource retries its own stream URL, but a terminal Gateway bridge
      // closure needs a fresh connection. Back off rather than repeatedly
      // invoking Runtime discovery and attach on a transient transport error.
      restartStream();
    };
    return () => {
      intentional = true;
      source.close();
      if (this.activeSource === source) {
        ++this.lifecycleGeneration;
        this.activeSource = undefined;
      }
    };
  }
  private async dropConnection(id: string, generation: number): Promise<void> {
    if (generation !== this.lifecycleGeneration || this.connection?.id !== id)
      return;
    this.connection = undefined;
    await this.deleteConnection(id);
  }
  private scheduleStreamReconnect(
    onNotification: (notification: RuntimeNotification) => void,
    onError?: (error: RuntimeBridgeError) => void,
    onReconnected?: () => void | Promise<void>,
    generation = this.lifecycleGeneration,
  ) {
    this.cancelReconnect();
    const exponent = Math.min(this.reconnectAttempts++, 5);
    const delay = Math.min(
      this.maxReconnectDelayMs,
      this.baseReconnectDelayMs * 2 ** exponent,
    );
    const jitter = Math.floor(Math.random() * Math.min(500, delay / 4));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closed || generation !== this.lifecycleGeneration) return;
      void this.reopenEventStream(
        onNotification,
        onError,
        onReconnected,
        generation,
      );
    }, delay + jitter);
  }
  private async reopenEventStream(
    onNotification: (notification: RuntimeNotification) => void,
    onError?: (error: RuntimeBridgeError) => void,
    onReconnected?: () => void | Promise<void>,
    generation = this.lifecycleGeneration,
  ) {
    try {
      if (this.closed || generation !== this.lifecycleGeneration) return;
      const existing = this.connection;
      if (!existing) {
        await this.connect();
        if (this.closed || generation !== this.lifecycleGeneration) {
          const replacement = this.connection;
          if (replacement) await this.disconnectIfCurrent(replacement.id);
          return;
        }
        // A new Gateway bridge has no Runtime attachment. Do not open its event
        // stream until the consumer has restored an authoritative attach.
        await onReconnected?.();
      }
      this.subscribe(onNotification, onError, onReconnected);
    } catch (reason) {
      const error =
        reason instanceof RuntimeBridgeError
          ? reason
          : new RuntimeBridgeError(
              "reconnect_failed",
              "Gateway connection failed.",
            );
      if (generation !== this.lifecycleGeneration || this.closed) return;
      onError?.(error);
      this.scheduleStreamReconnect(onNotification, onError, onReconnected);
    }
  }
  private cancelReconnect() {
    if (this.reconnectTimer !== undefined)
      window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
  private async request(
    method: "POST" | "DELETE",
    path: string,
    payload?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        signal: combined,
        headers:
          payload === undefined
            ? undefined
            : {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      throw new RuntimeBridgeError(
        combined.aborted ? "timeout" : "network_error",
        "Gateway connection failed.",
      );
    }
    if (response.status === 204) return undefined;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RuntimeBridgeError(
        "invalid_response",
        "Gateway returned an invalid response.",
        { status: response.status },
      );
    }
    if (!response.ok) {
      const error =
        isRecord(body) && isRecord(body.error) ? body.error : undefined;
      throw new RuntimeBridgeError(
        typeof error?.code === "string" ? error.code : "request_failed",
        typeof error?.message === "string"
          ? error.message
          : "Runtime request failed.",
        { status: response.status },
      );
    }
    return body;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isBridgeConnection(value: unknown): value is BridgeConnection {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.hello) &&
    typeof value.hello.protocol_version === "string" &&
    typeof value.hello.runtime_version === "string" &&
    typeof value.hello.transport === "string" &&
    isRecord(value.hello.capabilities) &&
    isRecord(value.hello.content_sources)
  );
}
function isNotification(value: unknown): value is RuntimeNotification {
  return (
    isRecord(value) && typeof value.method === "string" && "params" in value
  );
}
