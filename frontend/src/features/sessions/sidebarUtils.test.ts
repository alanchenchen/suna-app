import { describe, expect, it } from "vitest";
import {
  loadCollapsed,
  loadPinned,
  projectName,
  relativeTime,
  sortSessions,
} from "./sidebarUtils";
import type { SessionInfo } from "../../lib/runtimeBridge";

function session(
  id: string,
  status: SessionInfo["status"],
  updatedAt: string,
  cwd = "/project/a",
): SessionInfo {
  return {
    id,
    status,
    cwd,
    updated_at: updatedAt,
    title: `Task ${id}`,
    created_at: updatedAt,
    client_count: 0,
    message_count: 0,
  };
}

describe("sortSessions", () => {
  const now = "2026-08-17T12:00:00Z";
  const older = "2026-08-17T10:00:00Z";

  it("puts pinned sessions first", () => {
    const sessions = [session("a", "idle", now), session("b", "idle", older)];
    const sorted = sortSessions(sessions, new Set(["b"]));
    expect(sorted.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("puts waiting sessions before running and idle", () => {
    const sessions = [
      session("a", "idle", now),
      session("b", "running", now),
      session("c", "waiting", older),
    ];
    const sorted = sortSessions(sessions, new Set());
    expect(sorted.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("orders same-rank sessions by updated_at desc", () => {
    const sessions = [session("a", "idle", older), session("b", "idle", now)];
    const sorted = sortSessions(sessions, new Set());
    expect(sorted.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("does not mutate the input array", () => {
    const sessions = [session("a", "idle", now), session("b", "idle", older)];
    const before = sessions.map((s) => s.id);
    sortSessions(sessions, new Set());
    expect(sessions.map((s) => s.id)).toEqual(before);
  });
});

describe("projectName", () => {
  it("returns the basename of a project path", () => {
    expect(projectName("/Users/alice/projects/suna-app")).toBe("suna-app");
  });

  it("strips trailing slashes before taking the basename", () => {
    expect(projectName("/work/app/")).toBe("app");
  });

  it("falls back to the input for root paths", () => {
    expect(projectName("/")).toBe("/");
  });
});

describe("relativeTime", () => {
  it("returns just-now for recent timestamps", () => {
    expect(relativeTime(new Date().toISOString())).toBe("time.justNow");
  });

  it("returns minutes for timestamps within the hour", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinutesAgo)).toBe("5m");
  });

  it("returns hours for timestamps within the day", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h");
  });
});

describe("loadPinned / loadCollapsed", () => {
  it("returns an empty set when storage is empty", () => {
    localStorage.clear();
    expect(loadPinned().size).toBe(0);
    expect(loadCollapsed().size).toBe(0);
  });

  it("parses stored arrays into sets", () => {
    localStorage.setItem(
      "suna-app:pinned-sessions",
      JSON.stringify(["a", "b"]),
    );
    expect(Array.from(loadPinned())).toEqual(["a", "b"]);
  });

  it("ignores malformed storage", () => {
    localStorage.setItem("suna-app:pinned-sessions", "{not json");
    expect(loadPinned().size).toBe(0);
  });
});
