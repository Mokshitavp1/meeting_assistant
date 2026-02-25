import { useState, type FC } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import apiClient from '../../api/axios.config'

interface CreateMeetingModalProps {
    onClose: () => void
    onSuccess: () => void
}

const CreateMeetingModal: FC<CreateMeetingModalProps> = ({ onClose, onSuccess }) => {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [scheduledStartTime, setScheduledStartTime] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            await apiClient.post('/meetings', {
                title,
                description: description || undefined,
                scheduledStartTime: new Date(scheduledStartTime).toISOString(),
            })
            toast.success('Meeting scheduled!')
            onSuccess()
            onClose()
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to schedule meeting')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-900">Schedule Meeting</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
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
                            placeholder="Weekly Team Standup"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            rows={3}
                            placeholder="Discuss sprint progress..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Date &amp; Time *</label>
                        <input
                            type="datetime-local"
                            required
                            value={scheduledStartTime}
                            onChange={(e) => setScheduledStartTime(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                            {loading ? 'Scheduling...' : 'Schedule'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default CreateMeetingModal
