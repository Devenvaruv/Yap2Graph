import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import Home from "@/app/page";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("home page", () => {
  test("shows the six intents", () => {
    render(<Home />);

    for (const label of [
      "Standup",
      "Manager update",
      "LinkedIn post",
      "Technical blog",
      "What did I accomplish?",
      "End-of-day / end-of-week update",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  test("offers the five time ranges", () => {
    render(<Home />);

    for (const label of ["Today", "Last 3 days", "Last 7 days", "Last 14 days", "Custom"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  test("renders labeled placeholder panes", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: "Draft" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sources used" })).toBeInTheDocument();
  });

  test("reflects intent and time-range selection", () => {
    render(<Home />);

    expect(screen.getByRole("button", { name: /standup/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Last 7 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /technical blog/i }));
    fireEvent.click(screen.getByRole("button", { name: "Last 14 days" }));

    expect(screen.getByRole("button", { name: /technical blog/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /standup/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Last 14 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("generates a draft from the selected profile", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Standup draft",
          markdown: "## Completed\n- Shipped the Cognee mind map.",
          sources: [{ documentId: "chatgpt-daily-2026-09-12", excerpt: "Mind map shipped." }],
          usedModel: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    await waitFor(() => {
      expect(screen.getByText("Standup draft")).toBeInTheDocument();
    });

    expect(screen.getByText(/Shipped the Cognee mind map/)).toBeInTheDocument();
    expect(screen.getByText("chatgpt-daily-2026-09-12")).toBeInTheDocument();
  });
});
