import { lazy, Suspense, type FC, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import MainLayout from './components/layout/MainLayout'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { DashboardSkeleton } from './components/shared/LoadingSkeleton'

// Lazy-loaded pages — each gets its own code chunk
const Login = lazy(() => import('./pages/auth/Login'))
const Register = lazy(() => import('./pages/auth/Register'))
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'))
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'))
const LiveMeeting = lazy(() => import('./pages/meeting/LiveMeeting'))
const MeetingListPage = lazy(() => import('./pages/meeting/MeetingList'))
const MeetingDetail = lazy(() => import('./pages/meeting/MeetingDetail'))
const MyTasks = lazy(() => import('./pages/task/MyTasks'))
const TaskDetail = lazy(() => import('./pages/task/TaskDetail'))
const WorkspaceList = lazy(() => import('./pages/workspace/WorkspaceList'))
const WorkspaceDetail = lazy(() => import('./pages/workspace/WorkspaceDetail'))
const ProfileSettings = lazy(() => import('./pages/settings/Profile'))
const SettingsLayout = lazy(() => import('./pages/settings/SettingsLayout'))
const NotificationsSettings = lazy(() => import('./pages/settings/Notifications'))
const IntegrationsSettings = lazy(() => import('./pages/settings/Integrations'))

/** Shared loading fallback for Suspense boundaries */
const PageFallback: FC = () => (
  <div className="p-6">
    <DashboardSkeleton />
  </div>
)

/** App-wide Suspense wrapper */
const SuspenseWrapper: FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<PageFallback />}>{children}</Suspense>
  </ErrorBoundary>
)

// Protected Route Component
const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

// Public Route (redirect if already authenticated)
const PublicRoute = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return !isAuthenticated ? <>{children}</> : <Navigate to="/dashboard" replace />
}

function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Public Routes */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <SuspenseWrapper><Login /></SuspenseWrapper>
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute>
              <SuspenseWrapper><Register /></SuspenseWrapper>
            </PublicRoute>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicRoute>
              <SuspenseWrapper><ForgotPassword /></SuspenseWrapper>
            </PublicRoute>
          }
        />

        {/* Protected Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<SuspenseWrapper><Dashboard /></SuspenseWrapper>} />

          {/* Workspaces */}
          <Route path="workspaces" element={<SuspenseWrapper><WorkspaceList /></SuspenseWrapper>} />
          <Route path="workspaces/:id" element={<SuspenseWrapper><WorkspaceDetail /></SuspenseWrapper>} />

          {/* Meetings */}
          <Route path="meetings" element={<SuspenseWrapper><MeetingListPage /></SuspenseWrapper>} />
          <Route path="meetings/:id" element={<SuspenseWrapper><MeetingDetail /></SuspenseWrapper>} />
          <Route path="meetings/:id/live" element={<SuspenseWrapper><LiveMeeting /></SuspenseWrapper>} />

          {/* Tasks */}
          <Route path="tasks/my" element={<SuspenseWrapper><MyTasks /></SuspenseWrapper>} />
          <Route path="tasks/all" element={<Navigate to="/tasks/my" replace />} />
          <Route path="tasks/:id" element={<SuspenseWrapper><TaskDetail /></SuspenseWrapper>} />

          {/* Settings - nested under SettingsLayout */}
          <Route
            path="settings"
            element={<SuspenseWrapper><SettingsLayout /></SuspenseWrapper>}
          >
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<SuspenseWrapper><ProfileSettings /></SuspenseWrapper>} />
            <Route path="notifications" element={<SuspenseWrapper><NotificationsSettings /></SuspenseWrapper>} />
            <Route path="integrations" element={<SuspenseWrapper><IntegrationsSettings /></SuspenseWrapper>} />
          </Route>
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

export default App