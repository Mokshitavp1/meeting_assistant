import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    ArrowLeft, CheckSquare, Clock, AlertTriangle, Trash2,
    Edit3, Loader2, MessageCircle, Send, Calendar, User as UserIcon
} from 'lucide-react'
import apiClient from '../../api/axios.config'
import toast from 'react-hot-toast'

interface Task {
    id: string
    title: string
    description?: string
    status: string
    priority: string
    dueDate?: string
    createdAt: string
    updatedAt: string
    completedAt?: string
    assignedTo?: { id: string; name: string; email: string } | null
    meeting?: { id: string; title: string; workspaceId?: string } | null
}

interface Comment {
    id: string
    content: string
    userName: string
    userId: string
    createdAt: string
}

const TaskDetail = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const [isEditing, setIsEditing] = useState(false)
    const [editTitle, setEditTitle] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [editPriority, setEditPriority] = useState('')
    const [editDueDate, setEditDueDate] = useState('')
    const [newComment, setNewComment] = useState('')

    const { data: task, isLoading, error } = useQuery<Task>({
        queryKey: ['task', id],
        queryFn: async () => {
            const { data } = await apiClient.get(`/tasks/${id}`)
            return data?.data?.task
        },
        enabled: !!id,
    })

    const { data: comments = [] } = useQuery<Comment[]>({
        queryKey: ['task-comments', id],
        queryFn: async () => {
            const { data } = await apiClient.get(`/tasks/${id}/comments`)
            return data?.data?.comments || []
        },
        enabled: !!id,
    })

    const updateMutation = useMutation({
        mutationFn: async (payload: any) => {
            const { data } = await apiClient.put(`/tasks/${id}`, payload)
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', id] })
            queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task updated')
            setIsEditing(false)
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update task'),
    })

    const statusMutation = useMutation({
        mutationFn: async (status: string) => {
            const { data } = await apiClient.patch(`/tasks/${id}/status`, { status })
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', id] })
            queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Status updated')
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update status'),
    })

    const deleteMutation = useMutation({
        mutationFn: async () => {
            await apiClient.delete(`/tasks/${id}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task deleted')
            navigate('/tasks/my')
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to delete task'),
    })

    const commentMutation = useMutation({
        mutationFn: async (content: string) => {
            const { data } = await apiClient.post(`/tasks/${id}/comments`, { content })
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task-comments', id] })
            toast.success('Comment added')
            setNewComment('')
        },
        onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to add comment'),
    })

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high': return 'bg-red-100 text-red-700'
            case 'medium': return 'bg-yellow-100 text-yellow-700'
            case 'low': return 'bg-green-100 text-green-700'
            default: return 'bg-gray-100 text-gray-700'
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-green-100 text-green-700'
            case 'in_progress': return 'bg-blue-100 text-blue-700'
            case 'pending': return 'bg-gray-100 text-gray-700'
            case 'cancelled': return 'bg-red-100 text-red-600'
            default: return 'bg-gray-100 text-gray-700'
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckSquare className="w-5 h-5 text-green-600" />
            case 'in_progress': return <Clock className="w-5 h-5 text-blue-600" />
            default: return <Clock className="w-5 h-5 text-gray-500" />
        }
    }

    const getNextStatus = (current: string): string | null => {
        switch (current) {
            case 'pending': return 'in_progress'
            case 'in_progress': return 'completed'
            default: return null
        }
    }

    const getNextStatusLabel = (current: string): string => {
        switch (current) {
            case 'pending': return 'Start Task'
            case 'in_progress': return 'Mark Complete'
            default: return ''
        }
    }

    const isOverdue = task?.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed'

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    if (error || !task) {
        return (
            <div className="text-center py-20">
                <CheckSquare className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">Task not found</h3>
                <button onClick={() => navigate('/tasks/my')} className="mt-4 text-blue-600 hover:underline">
                    Back to tasks
                </button>
            </div>
        )
    }

    const startEdit = () => {
        setEditTitle(task.title)
        setEditDesc(task.description || '')
        setEditPriority(task.priority)
        setEditDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : '')
        setIsEditing(true)
    }

    const nextStatus = getNextStatus(task.status)

    return (
        <div className="space-y-6">
            {/* Back button */}
            <button
                onClick={() => navigate('/tasks/my')}
                className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
            >
                <ArrowLeft size={16} /> Back to Tasks
            </button>

            {/* Task Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        {isEditing ? (
                            <div className="space-y-3 max-w-lg">
                                <input
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    className="w-full text-xl font-bold px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <textarea
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                    rows={3}
                                    placeholder="Task description"
                                />
                                <div className="flex gap-3">
                                    <select
                                        value={editPriority}
                                        onChange={(e) => setEditPriority(e.target.value)}
                                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    >
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                    <input
                                        type="datetime-local"
                                        value={editDueDate}
                                        onChange={(e) => setEditDueDate(e.target.value)}
                                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => updateMutation.mutate({
                                            title: editTitle,
                                            description: editDesc,
                                            priority: editPriority,
                                            dueDate: editDueDate ? new Date(editDueDate).toISOString() : null,
                                        })}
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
                                <div className="flex items-center gap-3 mb-3">
                                    {isOverdue ? <AlertTriangle className="w-6 h-6 text-red-500" /> : getStatusIcon(task.status)}
                                    <h1 className={`text-2xl font-bold text-gray-900 ${task.status === 'completed' ? 'line-through text-gray-400' : ''}`}>
                                        {task.title}
                                    </h1>
                                </div>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${getStatusColor(task.status)}`}>
                                        {task.status.replace('_', ' ').toUpperCase()}
                                    </span>
                                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${getPriorityColor(task.priority)}`}>
                                        {task.priority.toUpperCase()}
                                    </span>
                                    {isOverdue && (
                                        <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700">
                                            OVERDUE
                                        </span>
                                    )}
                                </div>
                                {task.description && (
                                    <p className="text-gray-600 mb-4">{task.description}</p>
                                )}
                            </>
                        )}

                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mt-3">
                            {task.assignedTo && (
                                <span className="flex items-center gap-1.5">
                                    <UserIcon size={14} /> {task.assignedTo.name}
                                </span>
                            )}
                            {task.dueDate && (
                                <span className="flex items-center gap-1.5">
                                    <Calendar size={14} />
                                    Due: {new Date(task.dueDate).toLocaleDateString()} at{' '}
                                    {new Date(task.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                            {task.meeting && (
                                <span
                                    className="flex items-center gap-1.5 text-blue-600 cursor-pointer hover:underline"
                                    onClick={() => navigate(`/meetings/${task.meeting!.id}`)}
                                >
                                    From meeting: {task.meeting.title}
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-gray-400 mt-2">
                            Created: {new Date(task.createdAt).toLocaleString()}
                            {task.completedAt && ` • Completed: ${new Date(task.completedAt).toLocaleString()}`}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {nextStatus && (
                            <button
                                onClick={() => statusMutation.mutate(nextStatus)}
                                disabled={statusMutation.isPending}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                                {getNextStatusLabel(task.status)}
                            </button>
                        )}
                        {!isEditing && (
                            <button
                                onClick={startEdit}
                                className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Edit task"
                            >
                                <Edit3 size={18} />
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (window.confirm('Delete this task?')) deleteMutation.mutate()
                            }}
                            disabled={deleteMutation.isPending}
                            className="p-2 text-red-400 hover:text-red-600 transition-colors"
                            title="Delete task"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Comments */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <MessageCircle size={18} /> Comments ({comments.length})
                </h2>

                {comments.length > 0 && (
                    <div className="space-y-3 mb-6">
                        {comments.map((comment) => (
                            <div key={comment.id} className="p-3 bg-gray-50 rounded-lg">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-medium text-gray-800">{comment.userName}</span>
                                    <span className="text-xs text-gray-400">
                                        {new Date(comment.createdAt).toLocaleString()}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-600">{comment.content}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add comment */}
                <form
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (newComment.trim()) commentMutation.mutate(newComment.trim())
                    }}
                    className="flex gap-2"
                >
                    <input
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Add a comment..."
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                    <button
                        type="submit"
                        disabled={!newComment.trim() || commentMutation.isPending}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        <Send size={14} /> Send
                    </button>
                </form>
            </div>
        </div>
    )
}

export default TaskDetail
