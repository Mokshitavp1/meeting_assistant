import { useState, type FC } from 'react'
import { X, Calendar, Users, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import apiClient from '../../api/axios.config'

interface WorkspaceMember {
    id: string
    userId: string
    user: { id: string; name: string; email: string }
}

interface WorkspaceScheduleMeetingModalProps {
    workspaceId: string
    workspaceName: string
    members: WorkspaceMember[]
    onClose: () => void
    onSuccess: () => void
}

const WorkspaceScheduleMeetingModal: FC<WorkspaceScheduleMeetingModalProps> = ({
    workspaceId,
    workspaceName,
    members,
    onClose,
    onSuccess,
}) => {
    const navigate = useNavigate()
    const [title, setTitle] = useState('')
    const [scheduledStartTime, setScheduledStartTime] = useState('')
    const [loading, setLoading] = useState(false)

    const participantIds = members.map((m) => m.userId)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!title.trim() || !scheduledStartTime) return
        setLoading(true)
        try {
            const { data } = await apiClient.post('/meetings', {
                title: title.trim(),
                workspaceId,
                scheduledStartTime: new Date(scheduledStartTime).toISOString(),
                participantIds,
            })
            toast.success(`Meeting scheduled! All ${members.length} workspace members have been notified.`)
            onSuccess()
            onClose()
            const meetingId = data?.data?.meeting?.id
            if (meetingId) {
                navigate(`/meetings/${meetingId}`)
            }
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to schedule meeting')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">Schedule Meeting</h2>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Workspace: <span className="font-medium text-slate-700">{workspaceName}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>

                {/* Participant preview */}
                <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                        <Users size={14} className="text-blue-600" />
                        <span className="text-sm font-medium text-blue-700">
                            All {members.length} workspace members will be invited
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {members.map((m) => (
                            <span
                                key={m.id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-blue-200 text-xs text-slate-700"
                            >
                                <span className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-[10px] shrink-0">
                                    {(m.user.name || m.user.email).charAt(0).toUpperCase()}
                                </span>
                                {m.user.name || m.user.email}
                            </span>
                        ))}
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Meeting Title *</label>
                        <input
                            type="text"
                            required
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Weekly Team Standup"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            <Calendar size={14} className="inline mr-1" />
                            Date &amp; Time *
                        </label>
                        <input
                            type="datetime-local"
                            required
                            value={scheduledStartTime}
                            onChange={(e) => setScheduledStartTime(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !title.trim() || !scheduledStartTime}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                            {loading ? (
                                <><Loader2 size={15} className="animate-spin" /> Scheduling...</>
                            ) : (
                                `Schedule for ${members.length} member${members.length !== 1 ? 's' : ''}`
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default WorkspaceScheduleMeetingModal
