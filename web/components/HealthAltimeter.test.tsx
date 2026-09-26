import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAX_UINT } from "@/lib/sim/glide";
import { HealthAltimeter, scaleHealth } from "./HealthAltimeter";

const wad = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;

describe("HealthAltimeter", () => {
  it("shows Safe at 1.5", () => {
    render(<HealthAltimeter health={wad(1.5)} />);
    const meter = screen.getByRole("meter", { name: "Position health" });
    expect(meter).toHaveAttribute("aria-valuetext", "Health 1.50, safe");
    expect(screen.getByText("Safe")).toBeInTheDocument();
  });

  it("shows Gliding with a per-block rate at 1.2", () => {
    render(<HealthAltimeter health={wad(1.2)} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "Health 1.20, gliding");
    expect(screen.getByText("Gliding")).toBeInTheDocument();
    // r = 0.005 × (1.25 − 1.2) / 0.23 = 0.1086%
    expect(screen.getByText("0.10% per block")).toBeInTheDocument();
  });

  it("shows Backstop at 1.0", () => {
    render(<HealthAltimeter health={wad(1.0)} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "Health 1.00, backstop");
    expect(screen.getByText("Backstop")).toBeInTheDocument();
  });

  it("handles no debt", () => {
    render(<HealthAltimeter health={MAX_UINT} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "No debt");
  });

  it("gives the glide zone the most room", () => {
    expect(scaleHealth(1.25) - scaleHealth(1.02)).toBeGreaterThan(0.4);
    expect(scaleHealth(0.5)).toBe(0);
    expect(scaleHealth(5)).toBe(1);
  });
});
