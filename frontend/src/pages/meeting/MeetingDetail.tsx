import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    Calendar, Clock, Users, ArrowLeft, Play, Square,
    Trash2, Edit3, Loader2, Video, ClipboardList
} from 'lucide-react'
import apiClient from '../../api/axios.config'
import toast from 'react-hot-toast'

interface Meeting {
    id: string
    title: string
    description?: string
    status: string
    scheduledStartTime: string
    scheduledEndTime?: string
    actualStartTime?: string
    actualEndTime?: string
    summary?: string
    minutesOfMeeting?: string
    workspace?: { id: string; name: string } | null
    createdBy: { id: string; name: string; email: string }
    participants: { id: string; role: string; attended: boolean; user: { id: string; name: string; email: string } }[]
    _count?: { participants: number; tasks: number }
}

const MeetingDetail = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [isEditing, setIsEditing] = useState(false)
    const [editTitle, setEditTitle] = useState('')
    const [editDesc, setEditDesc] = useState('')

    const { data: meeting, isLoading, error } = useQuery<Meeting>({
        queryKey: ['meeting', id],
        queryFn: async () => {
            const { data } = await apiClient.get(`/meetings/${id}`)
            return data?.data?.meeting
        },
        enabled: !!id,
    })

    const startMutation = useMutation({
        mutationFn: async () => {
            const { data } = await apiClient.post(`/meetings/${id}/start`)
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['meeting', id] })
            queryClient.invalidateQueries({ queryKey: ['meetings'] })
            toast.success('Meeting started!')
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to start meeting'),
    })

    const endMutation = useMutation({
        mutationFn: async () => {
            const { data } = await apiClient.post(`/meetings/${id}/end`)
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['meeting', id] })
            queryClient.invalidateQueries({ queryKey: ['meetings'] })
            toast.success('Meeting ended')
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to end meeting'),
    })

    const updateMutation = useMutation({
        mutationFn: async (payload: { title?: string; description?: string }) => {
            const { data } = await apiClient.put(`/meetings/${id}`, payload)
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['meeting', id] })
            queryClient.invalidateQueries({ queryKey: ['meetings'] })
            toast.success('Meeting updated')
            setIsEditing(false)
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update meeting'),
    })

    const deleteMutation = useMutation({
        mutationFn: async () => {
            await apiClient.delete(`/meetings/${id}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['meetings'] })
            toast.success('Meeting deleted')
            navigate('/meetings')
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to delete meeting'),
    })

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'in_progress': return 'bg-red-100 text-red-700'
            case 'scheduled': return 'bg-blue-100 text-blue-700'
            case 'completed': return 'bg-green-100 text-green-700'
            case 'cancelled': return 'bg-gray-100 text-gray-600'
            default: return 'bg-gray-100 text-gray-700'
        }
    }

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'in_progress': return 'LIVE'
            case 'scheduled': return 'SCHEDULED'
            case 'completed': return 'COMPLETED'
            case 'cancelled': return 'CANCELLED'
            default: return status.toUpperCase()
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    if (error || !meeting) {
        return (
            <div className="text-center py-20">
                <Video className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">Meeting not found</h3>
                <button onClick={() => navigate('/meetings')} className="mt-4 text-blue-600 hover:underline">
                    Back to meetings
                </button>
            </div>
        )
    }

    const startEdit = () => {
        setEditTitle(meeting.title)
        setEditDesc(meeting.description || '')
        setIsEditing(true)
    }

    return (
        <div className="space-y-6">
            {/* Back button */}
            <button
                onClick={() => navigate('/meetings')}
                className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
            >
                <ArrowLeft size={16} /> Back to Meetings
            </button>

            {/* Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        {isEditing ? (
                            <div className="space-y-3 max-w-lg">
                                <input
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    className="w-full text-2xl font-bold px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <textarea
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                    rows={3}
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => updateMutation.mutate({ title: editTitle, description: editDesc })}
                                        disabled={updateMutation.isPending}
                                        className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className="px-4 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-3 mb-2">
                                    <h1 className="text-2xl font-bold text-gray-900">{meeting.title}</h1>
                                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${getStatusColor(meeting.status)}`}>
                                        {getStatusLabel(meeting.status)}
                                    </span>
                                </div>
                                {meeting.description && (
                                    <p className="text-gray-600 mb-4">{meeting.description}</p>
                                )}
                            </>
                        )}

                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mt-3">
                            <span className="flex items-center gap-1.5">
                                <Calendar size={14} />
                                {new Date(meeting.scheduledStartTime).toLocaleDateString(undefined, {
                                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
                                })}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Clock size={14} />
                                {new Date(meeting.scheduledStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                {meeting.scheduledEndTime && ` - ${new Date(meeting.scheduledEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Users size={14} />
                                {meeting.participants?.length || 0} participants
                            </span>
                        </div>

                        {meeting.workspace && (
                            <p className="text-sm text-gray-500 mt-2">
                                Workspace: <span className="font-medium text-gray-700">{meeting.workspace.name}</span>
                            </p>
                        )}
                        <p className="text-sm text-gray-500 mt-1">
                            Created by: <span className="font-medium text-gray-700">{meeting.createdBy?.name || 'Unknown'}</span>
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {meeting.status === 'scheduled' && (
                            <>
                                <button
                                    onClick={() => startMutation.mutate()}
                                    disabled={startMutation.isPending}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                                >
                                    <Play size={16} /> Start Meeting
                                </button>
                                <button
                                    onClick={startEdit}
                                    className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                                    title="Edit meeting"
                                >
                                    <Edit3 size={18} />
                                </button>
                            </>
                        )}
                        {meeting.status === 'in_progress' && (
                            <>
                                <button
                                    onClick={() => navigate(`/meetings/${id}/live`)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
                                >
                                    <Video size={16} /> Join Live
                                </button>
                                <button
                                    onClick={() => endMutation.mutate()}
                                    disabled={endMutation.isPending}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                                >
                                    <Square size={16} /> End Meeting
                                </button>
                            </>
                        )}
                        {meeting.status === 'completed' && (
                            <button
                                onClick={() => navigate(`/meetings/${id}/review`)}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                            >
                                <ClipboardList size={16} />
                                Review Tasks &amp; MoM
                                {meeting._count && meeting._count.tasks > 0 && (
                                    <span className="ml-1 rounded-full bg-blue-500 text-white text-[10px] font-bold px-1.5">
                                        {meeting._count.tasks}
                                    </span>
                                )}
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (window.confirm('Delete this meeting?')) deleteMutation.mutate()
                            }}
                            disabled={deleteMutation.isPending}
                            className="p-2 text-red-400 hover:text-red-600 transition-colors"
                            title="Delete meeting"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Participants */}
            {meeting.participants && meeting.participants.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Participants</h2>
                    <div className="space-y-2">
                        {meeting.participants.map((p) => (
                            <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                                        {(p.user.name || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">{p.user.name}</p>
                                        <p className="text-xs text-gray-500">{p.user.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-gray-500 capitalize">{p.role}</span>
                                    {p.attended && (
                                        <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Attended</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Summary / Minutes */}
            {meeting.summary && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900 mb-3">Meeting Summary</h2>
                    <p className="text-gray-600 whitespace-pre-wrap">{meeting.summary}</p>
                </div>
            )}

            {meeting.minutesOfMeeting && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900 mb-3">Minutes of Meeting</h2>
                    <div className="prose prose-sm max-w-none text-gray-600 whitespace-pre-wrap">
                        {meeting.minutesOfMeeting}
                    </div>
                </div>
            )}
        </div>
    )
}

export default MeetingDetail
