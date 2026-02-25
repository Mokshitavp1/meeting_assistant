import type { FC } from 'react'
import { Bell } from 'lucide-react'

const Notifications: FC = () => (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-lg">
        <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Bell size={20} className="text-amber-600" />
            </div>
            <div>
                <h2 className="text-lg font-semibold text-slate-900">Notification Settings</h2>
                <p className="text-sm text-slate-500">Control how and when you receive alerts</p>
            </div>
        </div>
        <div className="space-y-4">
            {[
                { label: 'Email notifications', desc: 'Receive emails for meeting reminders and task updates' },
                { label: 'Task deadline alerts', desc: 'Alert me 24 hours before a task is due' },
                { label: 'Meeting reminders', desc: 'Notify me 15 minutes before a scheduled meeting' },
                { label: 'Workspace activity', desc: 'Daily digest of workspace activity' },
            ].map(({ label, desc }) => (
                <div key={label} className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
                    <div>
                        <p className="text-sm font-medium text-slate-800">{label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input type="checkbox" defaultChecked className="sr-only peer" />
                        <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
                    </label>
                </div>
            ))}
        </div>
        <p className="text-xs text-slate-400 mt-4">Full notification management coming soon.</p>
    </div>
)

export default Notifications
