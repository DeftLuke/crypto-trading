import { describe, it, expect } from "vitest";
import { useAuthStore } from "@/store/authStore";

describe("authStore", () => {
  it("admin has all roles", () => {
    useAuthStore.getState().setUser({ id: "1", email: "admin@test.com", role: "admin" });
    expect(useAuthStore.getState().hasRole("viewer")).toBe(true);
    expect(useAuthStore.getState().hasRole("researcher")).toBe(true);
  });

  it("viewer limited", () => {
    useAuthStore.getState().setUser({ id: "2", email: "x@test.com", role: "viewer" });
    expect(useAuthStore.getState().hasRole("researcher")).toBe(false);
    expect(useAuthStore.getState().hasRole("viewer")).toBe(true);
  });
});
