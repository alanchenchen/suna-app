export type Theme = "system" | "light" | "dark";

export type SessionStatus = "active" | "done" | "waiting" | "idle";

export type Session = {
  id: string;
  title: string;
  detail: string;
  time: string;
  status: SessionStatus;
};

export type ApprovalState = "pending" | "approved" | "rejected";

export type RunStep = {
  title: string;
  detail: string;
  state: "complete" | "current" | "upcoming";
};

export type RunSummary = {
  title: string;
  elapsed: string;
  clock: string;
  progress: number;
  description: string;
  steps: RunStep[];
  contextUsed: string;
  contextPercent: number;
};
