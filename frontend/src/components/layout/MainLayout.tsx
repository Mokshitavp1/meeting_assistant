import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { Toaster } from "react-hot-toast";
import NotificationBell from "../notifications/NotificationBell";

const MainLayout = () => {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />

      {/* Main Content Area */}
      <main className="flex-1 h-screen overflow-y-auto flex flex-col">
        {/* Top bar with notification bell */}
        <div className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slate-100 px-8 py-3 flex justify-end">
          <NotificationBell />
        </div>

        <div className="container mx-auto p-8 max-w-7xl flex-1">
          <Outlet />
        </div>
      </main>

      {/* Toast Notifications */}
      <Toaster position="top-right" />
    </div>
  );
};

export default MainLayout;