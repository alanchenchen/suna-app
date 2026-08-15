/**
 * 轻量 i18n：中英文双语，无第三方依赖。
 * - 语言检测：localStorage 偏好 > 浏览器语言（navigator.language）
 * - 切换后持久化，界面即时生效（React state 驱动重渲染）
 */

export type Locale = "zh" | "en";

const STORAGE_KEY = "suna-locale";

/** 检测系统语言：浏览器语言前缀匹配 zh → 中文，否则英文。 */
export function detectLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // localStorage 不可用时回落到浏览器语言。
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function saveLocale(locale: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 持久化失败不影响本次会话。
  }
}

type Dict = Record<string, { zh: string; en: string }>;

/** 翻译字典：UI 高频文案。key 稳定，新增文案在此登记。 */
const DICT: Dict = {
  // 应用壳
  "app.name": { zh: "Suna", en: "Suna" },
  "nav.overview": { zh: "总览", en: "Overview" },
  "nav.task": { zh: "任务", en: "Task" },
  "nav.settings": { zh: "设置", en: "Settings" },
  "overview.title": { zh: "任务总览", en: "Tasks" },
  "overview.subtitle.connected": {
    zh: "Suna Runtime 已连接，随时可接管任务",
    en: "Runtime connected — take over any task",
  },
  "overview.subtitle.disconnected": {
    zh: "Suna Runtime 未连接",
    en: "Runtime disconnected",
  },
  "overview.new": { zh: "新建任务", en: "New task" },
  "overview.needsYou": { zh: "需要你处理", en: "Needs you" },
  "overview.running": { zh: "运行中", en: "Running" },
  "overview.recent": { zh: "最近任务", en: "Recent" },
  "overview.empty.needsYou": {
    zh: "没有待处理的事项",
    en: "Nothing needs you",
  },
  "overview.empty": { zh: "暂无", en: "None" },
  "overview.onboarding.title": {
    zh: "配置一个模型开始使用",
    en: "Configure a model to get started",
  },
  "overview.onboarding.desc": {
    zh: "Suna 还没有可用的模型。添加模型（如 DeepSeek）后即可新建任务。",
    en: "No model configured yet. Add one (e.g. DeepSeek) to start new tasks.",
  },
  "overview.onboarding.cta": { zh: "去配置模型", en: "Configure model" },
  "overview.reconnect": { zh: "重新连接 Runtime", en: "Reconnect Runtime" },
  // 侧栏
  "sidebar.search": { zh: "搜索任务…", en: "Search tasks…" },
  "sidebar.empty": {
    zh: "还没有任务。创建一个任务开始吧。",
    en: "No tasks yet. Create one to start.",
  },
  "sidebar.noMatch": { zh: "没有匹配的任务。", en: "No matching tasks." },
  "sidebar.connected": { zh: "Runtime 已连接", en: "Runtime connected" },
  "sidebar.disconnected": {
    zh: "Runtime 未连接，点击重连",
    en: "Runtime disconnected — click to reconnect",
  },
  "sidebar.workspace": { zh: "Runtime workspace", en: "Runtime workspace" },
  "session.status.idle": { zh: "空闲", en: "Idle" },
  "session.status.running": { zh: "正在运行", en: "Running" },
  "session.status.waiting": { zh: "等待你的回答", en: "Waiting for you" },
  "session.status.compacting": { zh: "正在压缩上下文", en: "Compacting" },
  "session.unnamed": { zh: "未命名任务", en: "Untitled task" },
  "session.join": { zh: "加入", en: "Join" },
  "session.opening": { zh: "正在打开…", en: "Opening…" },
  // 连接页
  "connect.title": { zh: "连接 Runtime", en: "Connect Runtime" },
  "connect.connecting": {
    zh: "正在连接你的工作空间",
    en: "Connecting to your workspace",
  },
  "connect.desc": {
    zh: "通过本地 Gateway 连接 Suna Runtime。",
    en: "Connect to Suna Runtime via the local gateway.",
  },
  "connect.button": { zh: "连接 Runtime", en: "Connect" },
  "connect.connectingBtn": { zh: "正在连接…", en: "Connecting…" },
  // 设置中心
  "settings.title": { zh: "Suna 设置", en: "Suna Settings" },
  "settings.tab.connection": { zh: "连接", en: "Connection" },
  "settings.tab.models": { zh: "模型", en: "Models" },
  "settings.tab.security": { zh: "安全", en: "Security" },
  "settings.tab.memory": { zh: "记忆", en: "Memory" },
  "settings.tab.skills": { zh: "技能", en: "Skills" },
  "settings.tab.mcp": { zh: "外部工具", en: "External tools" },
  "settings.loading": { zh: "正在加载可用设置…", en: "Loading settings…" },
  // 工作台
  "chat.sendPlaceholder": { zh: "给 Suna 发送消息…", en: "Message Suna…" },
  "chat.empty.title": { zh: "开始一个任务", en: "Start a task" },
  "chat.empty.desc": {
    zh: "告诉 Suna 你想在这个工作目录中完成什么，它会负责执行与推进。",
    en: "Tell Suna what to do in this workspace — it will execute and drive it forward.",
  },
  "chat.user": { zh: "你", en: "You" },
  // 决策卡
  "guard.approve": { zh: "批准", en: "Approve" },
  "guard.reject": { zh: "拒绝", en: "Reject" },
  "guard.modify": { zh: "按建议执行", en: "Apply suggestion" },
  "guard.approveOriginal": { zh: "批准原操作", en: "Approve original" },
  "guard.suggest": { zh: "建议改为：", en: "Suggested:" },
  "guard.title": { zh: "需要你的授权", en: "Approval needed" },
  "ask.title": { zh: "Suna 有一个问题", en: "Suna has a question" },
  "decision.otherClient": {
    zh: "此请求由其他客户端处理；当前窗口仅可查看。",
    en: "Handled by another client; this window is view-only.",
  },
};

export type Translate = (key: string) => string;

/** 构造翻译函数：locale 变化时由组件持有最新闭包。 */
export function createTranslator(locale: Locale): Translate {
  return (key: string) => DICT[key]?.[locale] ?? DICT[key]?.zh ?? key;
}
