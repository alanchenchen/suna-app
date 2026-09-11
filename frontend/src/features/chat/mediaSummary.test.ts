import { describe, expect, it } from "vitest";

import { parseMediaSummary } from "./mediaSummary";

/**
 * 媒体摘要解析：Runtime 生成的格式是确定性的
 * （`[image: name, mime, size, source=...]`），解析必须稳定，
 * 且对畸形输入安全降级（不能抛错、不能把 source 当展示信息）。
 */
describe("parseMediaSummary", () => {
  it("解析标准图片摘要（名称 / MIME / 大小）", () => {
    expect(
      parseMediaSummary(
        "[image: photo.png, image/png, 1.2MB, source=attachment:photo.png]",
      ),
    ).toEqual({ name: "photo.png", mime: "image/png", size: "1.2MB" });
  });

  it("解析 url 来源摘要", () => {
    expect(
      parseMediaSummary(
        "[image: shot.jpg, image/jpeg, 89.8KB, source=url:https://example.com/shot.jpg]",
      ),
    ).toEqual({ name: "shot.jpg", mime: "image/jpeg", size: "89.8KB" });
  });

  it("不把 source= 段当作展示信息", () => {
    const parsed = parseMediaSummary(
      "[image: a.png, image/png, 512B, source=path:/tmp/a.png]",
    );
    expect(parsed.size).toBe("512B");
    expect(parsed.mime).toBe("image/png");
  });

  it("畸形输入安全降级（不抛错）", () => {
    expect(parseMediaSummary("")).toEqual({});
    expect(parseMediaSummary("[image:")).toEqual({});
    expect(parseMediaSummary("普通文本")).toEqual({});
  });

  it("缺少大小/MIME 时只返回可用字段", () => {
    expect(
      parseMediaSummary("[image: only-name.png, source=attachment:x]"),
    ).toEqual({ name: "only-name.png" });
  });
});
