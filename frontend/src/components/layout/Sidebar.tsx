import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  CheckSquare,
  Settings,
  LogOut
} from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import clsx from "clsx"; // Make sure to npm install clsx

const Sidebar = () => {
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);

  const navItems = [
    { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard, match: "/dashboard" },
    { name: "Workspaces", path: "/workspaces", icon: Users, match: "/workspaces" },
    { name: "Meetings", path: "/meetings", icon: CalendarDays, match: "/meetings" },
    { name: "My Tasks", path: "/tasks/my", icon: CheckSquare, match: "/tasks" },
    { name: "Settings", path: "/settings/profile", icon: Settings, match: "/settings" },
  ];

  return (
    <div className="flex flex-col h-screen w-64 bg-slate-900 text-white border-r border-slate-800">
      {/* Brand Logo */}
      <div className="p-6 flex items-center gap-2">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold">M</div>
        <h1 className="text-xl font-bold tracking-tight">MeetingBrain</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 space-y-2 mt-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.match);

          return (
            <Link
              key={item.path}
              to={item.path}
              className={clsx(
                "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
                isActive
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-900/50"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              )}
            >
              <Icon size={20} />
              <span className="font-medium text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Logout Footer */}
      <div className="p-4 border-t border-slate-800">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-4 py-3 w-full text-red-400 hover:bg-red-900/20 rounded-lg transition-colors text-sm font-medium"
        >
          <LogOut size={20} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;