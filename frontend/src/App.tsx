import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import MainLayout from "./components/layout/MainLayout";
import Login from "./pages/Auth/Login";
import { useAuthStore } from "./store/authStore";

// Placeholder Components for now (We will build these next)
const Dashboard = () => <h1 className="text-2xl font-bold">Dashboard Overview</h1>;
const Tasks = () => <h1 className="text-2xl font-bold">My Tasks</h1>;
const Register = () => <div className="p-10">Register Page (Coming Soon)</div>;

// Protected Route Component
const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return children;
};

function App() {
  return (
    <BrowserRouter>
      {/* Global Notifications */}
      <Toaster position="top-right" />
      
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected Routes (Wrapped in MainLayout) */}
        <Route path="/" element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="meetings" element={<div>Meetings Page</div>} />
          <Route path="workspaces" element={<div>Workspaces Page</div>} />
          <Route path="settings" element={<div>Settings Page</div>} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;