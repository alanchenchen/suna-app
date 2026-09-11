import { describe, expect, it } from "vitest";

import type { JSONRecord, ToolFlowItem } from "../../lib/runtimeBridge";
import { execJobId, execMode } from "./toolCards";

function execItem(params: JSONRecord, result?: string): ToolFlowItem {
  return {
    id: "t1",
    tool: "exec",
    status: "success",
    params,
    result,
  };
}

describe("execMode", () => {
  it("treats run without background as foreground", () => {
    expect(execMode(execItem({ command: "ls" }))).toBe("foreground");
  });

  it("treats background=true as background start", () => {
    expect(execMode(execItem({ command: "pnpm dev", background: true }))).toBe(
      "background",
    );
  });

  it("detects status and stop actions", () => {
    expect(execMode(execItem({ action: "status", job_id: "abc" }))).toBe(
      "status",
    );
    expect(execMode(execItem({ action: "stop", job_id: "abc" }))).toBe("stop");
  });

  it("treats non-exec tools as foreground", () => {
    expect(
      execMode({
        id: "t2",
        tool: "readfile",
        status: "success",
        params: { background: true },
      }),
    ).toBe("foreground");
  });
});

describe("execJobId", () => {
  it("extracts job id from background start result", () => {
    expect(
      execJobId(
        execItem(
          { command: "pnpm dev", background: true },
          "Exec started background job 5fce386d-c3fe-4e8d-adca-89901ffd2007.\nScope: run. Elapsed: 3 ms.",
        ),
      ),
    ).toBe("5fce386d-c3fe-4e8d-adca-89901ffd2007");
  });

  it("returns undefined for foreground results", () => {
    expect(
      execJobId(execItem({ command: "ls" }, "Exec command completed.")),
    ).toBeUndefined();
    expect(execJobId(execItem({ command: "ls" }))).toBeUndefined();
  });
});
