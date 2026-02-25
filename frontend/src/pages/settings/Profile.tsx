import { useState, type FC } from 'react'
import toast from 'react-hot-toast'
import { User, Mail, Shield, Save } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import apiClient from '../../api/axios.config'

const Profile: FC = () => {
    const user = useAuthStore((state) => state.user)
    const updateUser = useAuthStore((state) => state.updateUser)

    const [fullName, setFullName] = useState(user?.fullName ?? '')
    const [saving, setSaving] = useState(false)

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            await apiClient.put('/auth/profile', { fullName })
            updateUser({ fullName })
            toast.success('Profile updated!')
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update profile')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-lg">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <User size={20} className="text-blue-600" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-slate-900">Profile Settings</h2>
                    <p className="text-sm text-slate-500">Update your personal information</p>
                </div>
            </div>

            <form onSubmit={handleSave} className="space-y-5">
                {/* Avatar */}
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-2xl">
                        {(user?.fullName ?? 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p className="text-sm font-medium text-slate-700">Profile Picture</p>
                        <p className="text-xs text-slate-500 mt-0.5">Avatar upload coming soon</p>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                    <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Your full name"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        <span className="flex items-center gap-1.5"><Mail size={14} /> Email Address</span>
                    </label>
                    <input
                        type="email"
                        value={user?.email ?? ''}
                        disabled
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed"
                    />
                    <p className="text-xs text-slate-400 mt-1">Email cannot be changed</p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        <span className="flex items-center gap-1.5"><Shield size={14} /> Role</span>
                    </label>
                    <input
                        type="text"
                        value={user?.role ?? 'Member'}
                        disabled
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed capitalize"
                    />
                </div>

                <div className="pt-2">
                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        <Save size={16} />
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>
        </div>
    )
}

export default Profile