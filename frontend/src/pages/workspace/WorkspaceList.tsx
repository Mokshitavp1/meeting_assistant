import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import apiClient from '../../api/axios.config'
import {
    Plus,
    Users,
    Copy,
    LogIn,
    Loader2,
    Building2,
    ArrowRight,
} from 'lucide-react'

// ── Types ──

interface Workspace {
    id: string
    name: string
    description?: string | null
    inviteCode: string
    role: string
    memberCount?: number
    createdAt: string
}

// ── API helpers ──

const fetchWorkspaces = async (): Promise<Workspace[]> => {
    const res = await apiClient.get('/workspaces')
    return res.data.data?.workspaces ?? []
}

const createWorkspace = async (data: { name: string; description?: string }) => {
    const res = await apiClient.post('/workspaces', data)
    return res.data.data?.workspace
}

const joinWorkspace = async (inviteCode: string) => {
    const res = await apiClient.post('/workspaces/join', { inviteCode })
    return res.data.data?.workspace
}

// ── Component ──

const WorkspaceList = () => {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const [showCreate, setShowCreate] = useState(false)
    const [showJoin, setShowJoin] = useState(false)
    const [createName, setCreateName] = useState('')
    const [createDesc, setCreateDesc] = useState('')
    const [inviteCode, setInviteCode] = useState('')

    const { data: workspaces = [], isLoading } = useQuery({
        queryKey: ['workspaces'],
        queryFn: fetchWorkspaces,
    })

    const createMutation = useMutation({
        mutationFn: createWorkspace,
        onSuccess: () => {
            toast.success('Workspace created!')
            queryClient.invalidateQueries({ queryKey: ['workspaces'] })
            setShowCreate(false)
            setCreateName('')
            setCreateDesc('')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.message || 'Failed to create workspace')
        },
    })

    const joinMutation = useMutation({
        mutationFn: joinWorkspace,
        onSuccess: () => {
            toast.success('Joined workspace!')
            queryClient.invalidateQueries({ queryKey: ['workspaces'] })
            setShowJoin(false)
            setInviteCode('')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.message || 'Invalid invite code')
        },
    })

    const copyInviteCode = (code: string) => {
        navigator.clipboard.writeText(code)
        toast.success('Invite code copied!')
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
                    <p className="text-gray-500 text-sm mt-1">Manage your team workspaces</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowJoin(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        <LogIn size={16} /> Join
                    </button>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                    >
                        <Plus size={16} /> New Workspace
                    </button>
                </div>
            </div>

            {/* ── Create Modal ── */}
            {showCreate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Workspace</h2>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault()
                                if (createName.trim().length < 2) return
                                createMutation.mutate({ name: createName, description: createDesc || undefined })
                            }}
                            className="space-y-4"
                        >
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                <input
                                    value={createName}
                                    onChange={(e) => setCreateName(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                    placeholder="Engineering Team"
                                    minLength={2}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Description <span className="text-gray-400">(optional)</span>
                                </label>
                                <textarea
                                    value={createDesc}
                                    onChange={(e) => setCreateDesc(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                                    rows={3}
                                    placeholder="A workspace for the engineering team"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCreate(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={createMutation.isPending}
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                >
                                    {createMutation.isPending ? 'Creating...' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Join Modal ── */}
            {showJoin && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Join Workspace</h2>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault()
                                if (!inviteCode.trim()) return
                                joinMutation.mutate(inviteCode.trim())
                            }}
                            className="space-y-4"
                        >
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Invite Code
                                </label>
                                <input
                                    value={inviteCode}
                                    onChange={(e) => setInviteCode(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
                                    placeholder="Paste invite code"
                                    required
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowJoin(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={joinMutation.isPending}
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                >
                                    {joinMutation.isPending ? 'Joining...' : 'Join'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Workspace Grid ── */}
            {workspaces.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
                    <Building2 className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-1">No workspaces yet</h3>
                    <p className="text-gray-500 text-sm mb-6">
                        Create a workspace or join one with an invite code
                    </p>
                    <div className="flex justify-center gap-3">
                        <button
                            onClick={() => setShowJoin(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            <LogIn size={16} /> Join Workspace
                        </button>
                        <button
                            onClick={() => setShowCreate(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                            <Plus size={16} /> Create Workspace
                        </button>
                    </div>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {workspaces.map((ws) => (
                        <div
                            key={ws.id}
                            className="group bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
                            onClick={() => navigate(`/workspaces/${ws.id}`)}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold text-lg">
                                    {ws.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-gray-100 text-gray-600 capitalize">
                                    {ws.role}
                                </span>
                            </div>

                            <h3 className="font-semibold text-gray-900 mb-1 group-hover:text-blue-600 transition-colors">
                                {ws.name}
                            </h3>
                            {ws.description && (
                                <p className="text-gray-500 text-sm line-clamp-2 mb-3">{ws.description}</p>
                            )}

                            <div className="flex items-center justify-between text-sm text-gray-400 border-t border-gray-100 pt-3 mt-3">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        copyInviteCode(ws.inviteCode)
                                    }}
                                    className="inline-flex items-center gap-1 hover:text-gray-600 transition-colors"
                                    title="Copy invite code"
                                >
                                    <Copy size={14} /> Invite
                                </button>
                                <span className="inline-flex items-center gap-1">
                                    <Users size={14} /> {ws.memberCount ?? '—'}
                                </span>
                                <ArrowRight
                                    size={16}
                                    className="text-gray-300 group-hover:text-blue-500 transition-colors"
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default WorkspaceList
