import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import apiClient from '../api/axios.config';
import type { User, AuthResponse } from '../types/auth.types';

type ApiEnvelope<T> = {
  success: boolean;
  message?: string;
  data: T;
};

type RegisterPayload = {
  email: string;
  password: string;
  confirmPassword: string;
  name: string;
};

type LoginPayload = {
  email: string;
  password: string;
};

type MeResponse = {
  user?: {
    id: string;
    email: string;
    fullName?: string;
    name?: string;
    avatarUrl?: string;
    role?: string;
  };
};

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (userData: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateUser: (userData: Partial<User>) => void;
}

const toUser = (payload: {
  id: string;
  email: string;
  fullName?: string;
  name?: string;
  avatarUrl?: string;
  role?: string;
}): User => ({
  id: payload.id,
  email: payload.email,
  fullName: payload.fullName ?? payload.name ?? 'User',
  avatarUrl: payload.avatarUrl,
  role: payload.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
});

const saveTokens = (token: string | null, refreshToken: string | null) => {
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }

  if (refreshToken) {
    localStorage.setItem('refreshToken', refreshToken);
  } else {
    localStorage.removeItem('refreshToken');
  }
};

const clearState = () => ({
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,
});

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });

        try {
          const payload: LoginPayload = { email, password };
          const response = await apiClient.post<ApiEnvelope<AuthResponse>>('/auth/login', payload);
          const authData = response.data.data;

          saveTokens(authData.accessToken, authData.refreshToken ?? null);

          set({
            user: toUser(authData.user),
            token: authData.accessToken,
            refreshToken: authData.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          saveTokens(null, null);
          set({ ...clearState(), isLoading: false });
          throw error;
        }
      },

      register: async (userData: RegisterPayload) => {
        set({ isLoading: true });

        try {
          const response = await apiClient.post<ApiEnvelope<AuthResponse>>('/auth/register', userData);
          const authData = response.data.data;

          saveTokens(authData.accessToken, authData.refreshToken ?? null);

          set({
            user: toUser(authData.user),
            token: authData.accessToken,
            refreshToken: authData.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          saveTokens(null, null);
          set({ ...clearState(), isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        set({ isLoading: true });

        try {
          if (refreshToken) {
            await apiClient.post('/auth/logout', { refreshToken });
          }
        } catch {
        } finally {
          saveTokens(null, null);
          set({ ...clearState(), isLoading: false });
        }
      },

      checkAuth: async () => {
        const { token, refreshToken, user } = get();

        if (!token && !refreshToken) {
          saveTokens(null, null);
          set({ ...clearState(), isLoading: false });
          return;
        }

        set({ isLoading: true });

        try {
          const meResponse = await apiClient.get<ApiEnvelope<MeResponse>>('/auth/me');
          const currentUser = meResponse.data.data?.user;

          if (currentUser) {
            set({
              user: toUser(currentUser),
              isAuthenticated: true,
              isLoading: false,
            });
            return;
          }

          if (token && user) {
            set({ isAuthenticated: true, isLoading: false });
            return;
          }

          throw new Error('Unable to verify authenticated user');
        } catch {
          if (!refreshToken) {
            saveTokens(null, null);
            set({ ...clearState(), isLoading: false });
            return;
          }

          try {
            const refreshResponse = await apiClient.post<
              ApiEnvelope<{ accessToken: string; refreshToken: string }>
            >('/auth/refresh', { refreshToken });

            const refreshed = refreshResponse.data.data;
            saveTokens(refreshed.accessToken, refreshed.refreshToken);

            set({
              token: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              isAuthenticated: true,
              isLoading: false,
            });
          } catch {
            saveTokens(null, null);
            set({ ...clearState(), isLoading: false });
          }
        }
      },

      updateUser: (userData: Partial<User>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        }));
      },
    }),
    {
      name: 'meeting-auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);