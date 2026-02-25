import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckSquare, Clock, AlertTriangle, Plus, Filter, Loader2, Trash2 } from 'lucide-react'
import apiClient from '../../api/axios.config'
import toast from 'react-hot-toast'
import CreateTaskModal from '../../components/task/CreateTaskModal'

interface Task {
    id: string
    title: string
    description?: string
    priority: string
    status: string
    dueDate?: string
    assignedTo?: { id: string; name: string; email: string } | null
    meeting?: { id: string; title: string } | null
    createdAt: string
}

const fetchMyTasks = async (): Promise<Task[]> => {
    const { data } = await apiClient.get('/tasks')
    return data?.data?.tasks || []
}

const MyTasks = () => {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all')
    const [showCreateModal, setShowCreateModal] = useState(false)

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: ['my-tasks'],
        queryFn: fetchMyTasks
    })

    const updateStatusMutation = useMutation({
        mutationFn: async ({ id, status }: { id: string; status: string }) => {
            const { data } = await apiClient.patch(`/tasks/${id}/status`, { status })
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task status updated')
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || 'Failed to update task status')
        },
    })

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await apiClient.delete(`/tasks/${id}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Task deleted')
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || 'Failed to delete task')
        },
    })

    const filteredTasks = tasks.filter(task => {
        if (filter === 'all') return true
        return task.status === filter
    })

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high': return 'bg-red-50 border-red-200 text-red-700'
            case 'medium': return 'bg-yellow-50 border-yellow-200 text-yellow-700'
            case 'low': return 'bg-green-50 border-green-200 text-green-700'
            default: return 'bg-gray-50 border-gray-200 text-gray-700'
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckSquare className="w-5 h-5 text-green-600" />
            case 'in_progress': return <Clock className="w-5 h-5 text-blue-600" />
            default: return <Clock className="w-5 h-5 text-gray-600" />
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
            case 'pending': return 'Start'
            case 'in_progress': return 'Complete'
            default: return ''
        }
    }

    const isOverdue = (task: Task) =>
        task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed'

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
                    <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
                    <p className="text-gray-500 text-sm mt-1">Track your assigned tasks and deadlines</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                    <Plus size={16} /> New Task
                </button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
                <Filter size={16} className="text-gray-400" />
                <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
                    {([
                        { key: 'all', label: 'All' },
                        { key: 'pending', label: 'Pending' },
                        { key: 'in_progress', label: 'In Progress' },
                        { key: 'completed', label: 'Completed' },
                    ] as const).map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => setFilter(key)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === key
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Task List */}
            {filteredTasks.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
                    <CheckSquare className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-1">No tasks found</h3>
                    <p className="text-gray-500 text-sm">
                        {filter === 'all' ? 'No tasks assigned to you yet' : `No ${filter.replace('_', ' ')} tasks`}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredTasks.map((task) => {
                        const overdue = isOverdue(task)
                        const nextStatus = getNextStatus(task.status)

                        return (
                            <div
                                key={task.id}
                                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => navigate(`/tasks/${task.id}`)}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            {overdue ? <AlertTriangle className="w-5 h-5 text-red-600" /> : getStatusIcon(task.status)}
                                            <h3 className={`font-semibold text-gray-900 ${task.status === 'completed' ? 'line-through text-gray-400' : ''}`}>
                                                {task.title}
                                            </h3>
                                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getPriorityColor(task.priority)}`}>
                                                {task.priority.toUpperCase()}
                                            </span>
                                            {overdue && (
                                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">OVERDUE</span>
                                            )}
                                        </div>
                                        {task.description && (
                                            <p className="text-gray-600 text-sm mb-2 line-clamp-2">{task.description}</p>
                                        )}
                                        <div className="flex items-center gap-4 text-sm text-gray-500">
                                            <span>Assignee: {task.assignedTo?.name || 'Unassigned'}</span>
                                            {task.dueDate && <span>Due: {new Date(task.dueDate).toLocaleDateString()}</span>}
                                            {task.meeting && <span>Meeting: {task.meeting.title}</span>}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 ml-4" onClick={(e) => e.stopPropagation()}>
                                        {nextStatus && (
                                            <button
                                                onClick={() => updateStatusMutation.mutate({ id: task.id, status: nextStatus })}
                                                disabled={updateStatusMutation.isPending}
                                                className="px-3 py-1 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                                            >
                                                {getNextStatusLabel(task.status)}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => {
                                                if (window.confirm('Delete this task?')) deleteMutation.mutate(task.id)
                                            }}
                                            disabled={deleteMutation.isPending}
                                            className="p-1 text-red-400 hover:text-red-600 transition-colors"
                                            title="Delete task"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Create Task Modal */}
            {showCreateModal && (
                <CreateTaskModal
                    onClose={() => setShowCreateModal(false)}
                    onSuccess={() => {
                        setShowCreateModal(false)
                        queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
                    }}
                />
            )}
        </div>
    )
}

export default MyTasks
