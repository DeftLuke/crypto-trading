import { create } from "zustand";
import type { UserProfile, UserRole } from "@/types";

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  setUser: (user: UserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  hasRole: (...roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  hasRole: (...roles) => {
    const role = get().user?.role;
    if (!role) return false;
    if (role === "admin") return true;
    return roles.includes(role);
  },
}));
