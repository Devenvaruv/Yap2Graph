import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import Home from "@/app/page";

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

    expect(screen.getByRole("heading", { name: "Output" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Activities used" })).toBeInTheDocument();
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
});
