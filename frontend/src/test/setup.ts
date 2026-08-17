import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 每个测试后卸载组件树，避免 DOM 残留影响后续用例。
afterEach(() => {
  cleanup();
});
