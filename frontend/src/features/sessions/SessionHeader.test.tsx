import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { TooltipProvider } from "../../components/ui/Tooltip";
import { SessionHeader } from "./SessionHeader";

function renderHeader(
  overrides: Partial<Parameters<typeof SessionHeader>[0]> = {},
) {
  render(
    <LocaleProvider>
      <TooltipProvider>
        <SessionHeader
          handoffRole="host"
          onOpenMobileMenu={() => undefined}
          onOpenSettings={() => undefined}
          onToggleTheme={() => undefined}
          resolvedTheme="light"
          selected={{
            id: "s1",
            title: "Test",
            cwd: "/workspace",
            status: "running",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 0,
            client_count: 1,
          }}
          {...overrides}
        />
      </TooltipProvider>
    </LocaleProvider>,
  );
}

describe("SessionHeader", () => {
  it("不再渲染停止按钮（停止唯一入口在输入框内）", () => {
    renderHeader();
    expect(screen.queryByText(/^stop$/i)).toBeNull();
  });

  it("渲染标题与设置入口", () => {
    renderHeader();
    expect(screen.getByText("Test")).toBeTruthy();
    expect(screen.getByLabelText(/settings/i)).toBeTruthy();
  });
});
