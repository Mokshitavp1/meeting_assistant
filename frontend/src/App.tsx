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
const MyTasks = lazy(() => import('./pages/task/MyTasks'))
const WorkspaceList = lazy(() => import('./pages/workspace/WorkspaceList'))

const PlaceholderPage: FC<{ title: string }> = ({ title }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-700">{title}</div>
)

const WorkspaceDetail: FC = () => <PlaceholderPage title="Workspace Detail" />
const MeetingList: FC = () => <PlaceholderPage title="Meeting List" />
const MeetingDetail: FC = () => <PlaceholderPage title="Meeting Detail" />
const AllTasks: FC = () => <PlaceholderPage title="All Tasks" />
const TaskDetail: FC = () => <PlaceholderPage title="Task Detail" />
const Profile: FC = () => <PlaceholderPage title="Profile Settings" />
const Notifications: FC = () => <PlaceholderPage title="Notification Settings" />
const Integrations: FC = () => <PlaceholderPage title="Integrations Settings" />

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
          <Route path="workspaces/:id" element={<WorkspaceDetail />} />

          {/* Meetings */}
          <Route path="meetings" element={<MeetingList />} />
          <Route path="meetings/:id" element={<MeetingDetail />} />
          <Route path="meetings/:id/live" element={<SuspenseWrapper><LiveMeeting /></SuspenseWrapper>} />

          {/* Tasks */}
          <Route path="tasks/my" element={<SuspenseWrapper><MyTasks /></SuspenseWrapper>} />
          <Route path="tasks/all" element={<AllTasks />} />
          <Route path="tasks/:id" element={<TaskDetail />} />

          {/* Settings */}
          <Route path="settings/profile" element={<Profile />} />
          <Route path="settings/notifications" element={<Notifications />} />
          <Route path="settings/integrations" element={<Integrations />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

export default App