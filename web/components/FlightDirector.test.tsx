import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlightDirector } from "./FlightDirector";

const E = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;

describe("FlightDirector", () => {
  it("briefs on the position with computed price levels", () => {
    render(<FlightDirector collateral={E(10)} debt={E(20_000)} price={E(3_500)} />);
    expect(screen.getByText("Clear skies · health 1.49")).toBeTruthy();
    // glide level = 1.25 × 20,000 / (10 × 0.85) = 2,941.18
    expect(screen.getByText("2,941.18 (−16.0%)")).toBeTruthy();
  });

  it("answers a typed question and a preset with the contract maths", async () => {
    render(<FlightDirector collateral={E(10)} debt={E(20_000)} price={E(3_500)} />);
    fireEvent.change(screen.getByLabelText("Ask about this loan"), { target: { value: "what if eth crashes 20%" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Stress test · ETH −20%")).toBeTruthy();
    expect(screen.getByText(/health would be 1\.19/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "How much can I borrow?" }));
    expect(await screen.findByText("Borrowing against 10.0000 mETH")).toBeTruthy();
  });

  it("says it assumed the volatility when there is no price history", () => {
    render(<FlightDirector collateral={E(10)} debt={E(20_000)} price={E(3_500)} />);
    expect(screen.getByText(/70% a year is assumed/)).toBeTruthy();
  });

  it("measures volatility from price history when there is movement", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 3500 * (i % 2 ? 1.004 : 1));
    render(<FlightDirector collateral={E(10)} debt={E(20_000)} price={E(3_500)} history={{ prices, intervalS: 60, source: "test prices" }} />);
    expect(screen.getByText(/\(EWMA, λ 0\.94\) from the test prices/)).toBeTruthy();
  });

  it("does not invent a position when there is none", async () => {
    render(<FlightDirector collateral={0n} debt={0n} price={E(3_500)} />);
    expect(screen.getByText("No open loan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "What if ETH drops 20%?" }));
    expect(await screen.findByText(/That needs an open loan/)).toBeTruthy();
  });
});
