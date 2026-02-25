import { type FC } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { User, Bell, Puzzle } from 'lucide-react'

const tabs = [
    { label: 'Profile', path: '/settings/profile', icon: User },
    { label: 'Notifications', path: '/settings/notifications', icon: Bell },
    { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
]

const SettingsLayout: FC = () => (
    <div className="space-y-6 animate-in fade-in duration-500">
        {/* Header */}
        <div>
            <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
            <p className="text-slate-500 mt-1">Manage your account preferences</p>
        </div>

        {/* Tab bar */}
        <div className="border-b border-slate-200">
            <nav className="flex gap-1">
                {tabs.map(({ label, path, icon: Icon }) => (
                    <NavLink
                        key={path}
                        to={path}
                        className={({ isActive }) =>
                            `inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${isActive
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                            }`
                        }
                    >
                        <Icon size={16} />
                        {label}
                    </NavLink>
                ))}
            </nav>
        </div>

        {/* Tab content */}
        <Outlet />
    </div>
)

export default SettingsLayout
