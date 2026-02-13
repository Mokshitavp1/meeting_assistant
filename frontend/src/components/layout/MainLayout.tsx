import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { Toaster } from "react-hot-toast";

const MainLayout = () => {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      {/* Main Content Area */}
      <main className="flex-1 h-screen overflow-y-auto">
        <div className="container mx-auto p-8 max-w-7xl">
          <Outlet /> {/* This is where Dashboard/Tasks/Meetings render */}
        </div>
      </main>

      {/* Toast Notifications */}
      <Toaster position="top-right" />
    </div>
  );
};

export default MainLayout;