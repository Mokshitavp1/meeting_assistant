import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    ArrowLeft, Users, Calendar, Copy, LinkIcon, Settings,
    Loader2, Building2, Trash2, CalendarPlus
} from 'lucide-react'
import apiClient from '../../api/axios.config'
import toast from 'react-hot-toast'
import { useState } from 'react'
import WorkspaceScheduleMeetingModal from '../../components/workspace/WorkspaceScheduleMeetingModal'

interface WorkspaceMember {
    id: string
    userId: string
    role: string
    joinedAt: string
    user: { id: string; name: string; email: string }
}

interface Workspace {
    id: string
    name: string
    description?: string
    inviteCode: string
    createdAt: string
    members: WorkspaceMember[]
    meetings?: { id: string; title: string; status: string; scheduledStartTime: string }[]
}

const WorkspaceDetail = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [isEditing, setIsEditing] = useState(false)
    const [editName, setEditName] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [showScheduleMeeting, setShowScheduleMeeting] = useState(false)

    const { data: workspace, isLoading, error } = useQuery<Workspace>({
        queryKey: ['workspace', id],
        queryFn: async () => {
            const { data } = await apiClient.get(`/workspaces/${id}`)
            return data?.data?.workspace
        },
        enabled: !!id,
    })

    const updateMutation = useMutation({
        mutationFn: async (payload: { name?: string; description?: string }) => {
            const { data } = await apiClient.put(`/workspaces/${id}`, payload)
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workspace', id] })
            queryClient.invalidateQueries({ queryKey: ['workspaces'] })
            toast.success('Workspace updated')
            setIsEditing(false)
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update workspace'),
    })

    const regenerateCodeMutation = useMutation({
        mutationFn: async () => {
            const { data } = await apiClient.post(`/workspaces/${id}/invite-code`)
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workspace', id] })
            toast.success('New invite code generated')
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to regenerate invite code'),
    })

    const removeMemberMutation = useMutation({
        mutationFn: async (memberId: string) => {
            await apiClient.delete(`/workspaces/${id}/members/${memberId}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workspace', id] })
            toast.success('Member removed')
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to remove member'),
    })

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code)
        toast.success('Invite code copied!')
    }

    const copyLink = (code: string) => {
        navigator.clipboard.writeText(`${window.location.origin}/join/${code}`)
        toast.success('Invite link copied!')
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    if (error || !workspace) {
        return (
            <div className="text-center py-20">
                <Building2 className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">Workspace not found</h3>
                <button onClick={() => navigate('/workspaces')} className="mt-4 text-blue-600 hover:underline">
                    Back to workspaces
                </button>
            </div>
        )
    }

    const startEdit = () => {
        setEditName(workspace.name)
        setEditDesc(workspace.description || '')
        setIsEditing(true)
    }

    return (
        <div className="space-y-6">
            {showScheduleMeeting && workspace && (
                <WorkspaceScheduleMeetingModal
                    workspaceId={workspace.id}
                    workspaceName={workspace.name}
                    members={workspace.members || []}
                    onClose={() => setShowScheduleMeeting(false)}
                    onSuccess={() => {
                        queryClient.invalidateQueries({ queryKey: ['workspace', id] })
                        queryClient.invalidateQueries({ queryKey: ['meetings'] })
                    }}
                />
            )}
            {/* Back button */}
            <button
                onClick={() => navigate('/workspaces')}
                className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
            >
                <ArrowLeft size={16} /> Back to Workspaces
            </button>

            {/* Workspace Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        {isEditing ? (
                            <div className="space-y-3 max-w-lg">
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="w-full text-2xl font-bold px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <textarea
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                    rows={2}
                                    placeholder="Workspace description"
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => updateMutation.mutate({ name: editName, description: editDesc })}
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
                                    <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl">
                                        {workspace.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h1 className="text-2xl font-bold text-gray-900">{workspace.name}</h1>
                                        {workspace.description && (
                                            <p className="text-gray-500 text-sm">{workspace.description}</p>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="flex items-center gap-4 mt-4 text-sm text-gray-500">
                            <span className="flex items-center gap-1.5">
                                <Users size={14} /> {workspace.members?.length || 0} members
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Calendar size={14} /> Created {new Date(workspace.createdAt).toLocaleDateString()}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowScheduleMeeting(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                            title="Schedule a meeting for all workspace members"
                        >
                            <CalendarPlus size={15} /> Schedule Meeting
                        </button>
                        {!isEditing && (
                            <button
                                onClick={startEdit}
                                className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Edit workspace"
                            >
                                <Settings size={18} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Invite code section */}
                <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-500">Invite Code:</span>
                        <span className="font-mono text-sm font-bold text-gray-800">{workspace.inviteCode}</span>
                        <button onClick={() => copyCode(workspace.inviteCode)} className="text-gray-400 hover:text-gray-600">
                            <Copy size={14} />
                        </button>
                        <button onClick={() => copyLink(workspace.inviteCode)} className="text-gray-400 hover:text-blue-600">
                            <LinkIcon size={14} />
                        </button>
                    </div>
                    <button
                        onClick={() => regenerateCodeMutation.mutate()}
                        disabled={regenerateCodeMutation.isPending}
                        className="text-xs text-blue-600 hover:underline font-medium disabled:opacity-50"
                    >
                        Regenerate Code
                    </button>
                </div>
            </div>

            {/* Members */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Members</h2>
                </div>
                {workspace.members && workspace.members.length > 0 ? (
                    <div className="space-y-2">
                        {workspace.members.map((member) => (
                            <div key={member.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                                        {(member.user.name || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">{member.user.name}</p>
                                        <p className="text-xs text-gray-500">{member.user.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                                        {member.role}
                                    </span>
                                    {member.role !== 'admin' && (
                                        <button
                                            onClick={() => {
                                                if (window.confirm(`Remove ${member.user.name} from workspace?`))
                                                    removeMemberMutation.mutate(member.id)
                                            }}
                                            className="text-red-400 hover:text-red-600 transition-colors"
                                            title="Remove member"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">No members yet. Share the invite code to add people.</p>
                )}
            </div>

            {/* Recent Meetings in this workspace */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Meetings</h2>
                    <button
                        onClick={() => setShowScheduleMeeting(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                        <CalendarPlus size={14} /> Schedule Meeting
                    </button>
                </div>
                {workspace.meetings && workspace.meetings.length > 0 ? (
                    <div className="space-y-2">
                        {workspace.meetings.map((m) => (
                            <div
                                key={m.id}
                                onClick={() => navigate(`/meetings/${m.id}`)}
                                className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                            >
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{m.title}</p>
                                    <p className="text-xs text-gray-500">
                                        {new Date(m.scheduledStartTime).toLocaleDateString()} at{' '}
                                        {new Date(m.scheduledStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                                <span className="text-xs font-medium text-gray-500 capitalize">{m.status.replace('_', ' ')}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">No meetings scheduled yet. Use the button above to schedule one.</p>
                )}
            </div>
        </div>
    )
}

export default WorkspaceDetail
