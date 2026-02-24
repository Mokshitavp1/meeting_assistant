import { useAuthStore } from '../store/authStore';

type AuthStoreState = ReturnType<typeof useAuthStore.getState>;

export type UseAuthResult = {
    user: AuthStoreState['user'];
    isAuthenticated: AuthStoreState['isAuthenticated'];
    isLoading: AuthStoreState['isLoading'];
    login: AuthStoreState['login'];
    logout: AuthStoreState['logout'];
    register: AuthStoreState['register'];
};

export const useAuth = (): UseAuthResult => {
    const user = useAuthStore((state) => state.user);
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const isLoading = useAuthStore((state) => state.isLoading);
    const login = useAuthStore((state) => state.login);
    const logout = useAuthStore((state) => state.logout);
    const register = useAuthStore((state) => state.register);

    return {
        user,
        isAuthenticated,
        isLoading,
        login,
        logout,
        register,
    };
};

export default useAuth;
