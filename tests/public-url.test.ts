import { describe, expect, it } from "vitest";
import { publicUrl } from "@/lib/public-url";

// Behind Catalyst AppSail the request arrives addressed to the container itself.
const internal = new Request("http://0.0.0.0:9000/admin/notifications/abc");

describe("publicUrl", () => {
  it("uses AUTH_URL, not the container's internal address", () => {
    expect(publicUrl("/admin/bookings/42", internal, { AUTH_URL: "https://waky.example.in/" })).toBe("https://waky.example.in/admin/bookings/42");
  });

  it("falls back to the request's own origin when AUTH_URL isn't set (local development)", () => {
    expect(publicUrl("login", new Request("http://localhost:3000/x"), {})).toBe("http://localhost:3000/login");
  });
});
