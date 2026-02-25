import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare, Clock, AlertTriangle, Plus, Filter } from 'lucide-react'

interface Task {
    id: string
    title: string
    description?: string
    priority: 'HIGH' | 'MEDIUM' | 'LOW'
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE'
    dueDate?: string
    assignee: string
}

const fetchMyTasks = async (): Promise<Task[]> => {
    // Mock data for now
    return [
        {
            id: '1',
            title: 'Review quarterly presentation',
            description: 'Go through Q4 slides and provide feedback',
            priority: 'HIGH',
            status: 'PENDING',
            dueDate: '2024-03-01',
            assignee: 'John Doe'
        },
        {
            id: '2',
            title: 'Update project timeline',
            priority: 'MEDIUM',
            status: 'IN_PROGRESS',
            dueDate: '2024-02-28',
            assignee: 'Jane Smith'
        },
        {
            id: '3',
            title: 'Schedule team retrospective',
            priority: 'LOW',
            status: 'COMPLETED',
            assignee: 'Mike Johnson'
        }
    ]
}

const MyTasks = () => {
    const [filter, setFilter] = useState<'all' | 'pending' | 'in-progress' | 'completed'>('all')

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: ['my-tasks'],
        queryFn: fetchMyTasks
    })

    const filteredTasks = tasks.filter(task => {
        if (filter === 'all') return true
        if (filter === 'pending') return task.status === 'PENDING'
        if (filter === 'in-progress') return task.status === 'IN_PROGRESS'
        if (filter === 'completed') return task.status === 'COMPLETED'
        return true
    })

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'HIGH': return 'bg-red-50 border-red-200 text-red-700'
            case 'MEDIUM': return 'bg-yellow-50 border-yellow-200 text-yellow-700'
            case 'LOW': return 'bg-green-50 border-green-200 text-green-700'
            default: return 'bg-gray-50 border-gray-200 text-gray-700'
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'COMPLETED': return <CheckSquare className="w-5 h-5 text-green-600" />
            case 'IN_PROGRESS': return <Clock className="w-5 h-5 text-blue-600" />
            case 'OVERDUE': return <AlertTriangle className="w-5 h-5 text-red-600" />
            default: return <Clock className="w-5 h-5 text-gray-600" />
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
                <button className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
                    <Plus size={16} /> New Task
                </button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
                <Filter size={16} className="text-gray-400" />
                <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
                    {(['all', 'pending', 'in-progress', 'completed'] as const).map((status) => (
                        <button
                            key={status}
                            onClick={() => setFilter(status)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${filter === status
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            {status.replace('-', ' ')}
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
                        {filter === 'all' ? 'No tasks assigned to you yet' : `No ${filter.replace('-', ' ')} tasks`}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredTasks.map((task) => (
                        <div
                            key={task.id}
                            className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        {getStatusIcon(task.status)}
                                        <h3 className="font-semibold text-gray-900">{task.title}</h3>
                                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getPriorityColor(task.priority)}`}>
                                            {task.priority}
                                        </span>
                                    </div>
                                    {task.description && (
                                        <p className="text-gray-600 text-sm mb-2">{task.description}</p>
                                    )}
                                    <div className="flex items-center gap-4 text-sm text-gray-500">
                                        <span>Assignee: {task.assignee}</span>
                                        {task.dueDate && <span>Due: {new Date(task.dueDate).toLocaleDateString()}</span>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default MyTasks
