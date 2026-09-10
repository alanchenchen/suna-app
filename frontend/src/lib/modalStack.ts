/**
 * 浮层栈：全局记录当前打开的模态/浮层（按打开顺序）。
 *
 * 背景：命令面板、Dialog、详情抽屉各自在 document 上监听 Escape，
 * 一按 Esc 会把所有打开的浮层同时关掉；且快捷键可以把两个模态
 * 同时打开（面板 z-40 盖住 Dialog z-30，下层不可见也不可交互）。
 *
 * 约定：每个浮层在打开时 push、关闭/卸载时 pop；Escape 处理器
 * 先用 isTopModalLayer 判断自己是否在最顶层，只有顶层才响应。
 * id 必须稳定唯一（组件实例用 useId，单例用固定字符串）。
 */
const stack: string[] = [];

/** 浮层打开：登记到栈顶（重复 id 先移除再压栈，保证唯一）。 */
export function pushModalLayer(id: string) {
  const index = stack.indexOf(id);
  if (index >= 0) stack.splice(index, 1);
  stack.push(id);
}

/** 浮层关闭/卸载：从栈中移除。 */
export function popModalLayer(id: string) {
  const index = stack.indexOf(id);
  if (index >= 0) stack.splice(index, 1);
}

/** 该浮层是否是当前栈顶（唯一允许响应 Escape 的层）。 */
export function isTopModalLayer(id: string): boolean {
  return stack[stack.length - 1] === id;
}
