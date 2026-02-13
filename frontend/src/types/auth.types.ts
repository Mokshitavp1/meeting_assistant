export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  role: 'ADMIN' | 'MEMBER';
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}