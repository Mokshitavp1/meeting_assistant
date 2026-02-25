import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";

interface RefreshTokenResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken?: string;
  };
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

type QueueItem = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

const viteEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

const API_BASE_URL = viteEnv?.VITE_API_URL ?? "http://localhost:4000/api/v1";
const REFRESH_ENDPOINT = "/auth/refresh";

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

let isRefreshing = false;
let requestQueue: QueueItem[] = [];

const processQueue = (error: unknown, token: string | null) => {
  requestQueue.forEach((queuedRequest) => {
    if (error) {
      queuedRequest.reject(error);
      return;
    }

    if (token) {
      queuedRequest.resolve(token);
      return;
    }

    queuedRequest.reject(new Error("Token refresh failed"));
  });

  requestQueue = [];
};

const setAuthorizationHeader = (config: InternalAxiosRequestConfig, token: string) => {
  const headers = AxiosHeaders.from(config.headers);
  headers.set("Authorization", `Bearer ${token}`);
  config.headers = headers;
};

const clearAuthAndRedirect = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("meeting-auth-storage");

  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
};

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem("token");

    if (token) {
      setAuthorizationHeader(config, token);
    }

    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    if (!originalRequest || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    if (originalRequest.url?.includes(REFRESH_ENDPOINT) || originalRequest._retry) {
      clearAuthAndRedirect();
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) {
      clearAuthAndRedirect();
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        requestQueue.push({ resolve, reject });
      })
        .then((newToken) => {
          setAuthorizationHeader(originalRequest, newToken);
          return apiClient(originalRequest);
        })
        .catch((queueError) => Promise.reject(queueError));
    }

    isRefreshing = true;

    try {
      const { data } = await axios.post<RefreshTokenResponse>(
        `${API_BASE_URL}${REFRESH_ENDPOINT}`,
        { refreshToken },
        {
          headers: { "Content-Type": "application/json" },
          withCredentials: true,
        }
      );

      const tokens = data?.data;
      if (!tokens?.accessToken) {
        throw new Error("No access token returned from refresh endpoint");
      }

      localStorage.setItem("token", tokens.accessToken);
      if (tokens.refreshToken) {
        localStorage.setItem("refreshToken", tokens.refreshToken);
      }

      processQueue(null, tokens.accessToken);
      setAuthorizationHeader(originalRequest, tokens.accessToken);

      return apiClient(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      clearAuthAndRedirect();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default apiClient;