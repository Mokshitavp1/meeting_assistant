import axios from "axios";

// 1. Create the Axios Instance
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Necessary for cookies/sessions if used
});

// 2. Request Interceptor: Attach JWT Token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 3. Response Interceptor: Handle Token Expiration
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // If backend says "Unauthorized" (401), force logout
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      // Optional: Clear auth store state here if accessible
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default apiClient;