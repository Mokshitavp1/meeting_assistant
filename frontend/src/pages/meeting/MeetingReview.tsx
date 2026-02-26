import { useState, useEffect, type FC } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
    ArrowLeft, CheckCircle, Plus, Trash2, Loader2,
    User, Calendar, AlertTriangle, FileText, ClipboardList,
    ChevronDown
} from 'lucide-react'
import apiClient from '../../api/axios.config'
import toast from 'react-hot-toast'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Participant {
    id: string
    name: string | null
    email: string
}

interface ReviewTask {
    id: string
    title: string
    description: string
    assignedToId: string | null
    priority: 'low' | 'medium' | 'high'
    dueDate: string | null
    isConfirmed: boolean
    assignedTo: Participant | null
}

interface ReviewData {
    meetingId: string
    title: string
    status: string
    minutesOfMeeting: string
    summary: string
    participants: Participant[]
    unconfirmedTasks: ReviewTask[]
    pendingCount: number
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY_OPTIONS: { value: 'low' | 'medium' | 'high'; label: string; cls: string }[] = [
    { value: 'low', label: 'Low', cls: 'bg-slate-100 text-slate-600' },
    { value: 'medium', label: 'Medium', cls: 'bg-amber-100 text-amber-700' },
    { value: 'high', label: 'High', cls: 'bg-red-100 text-red-700' },
]

// ─── Sub-component: Editable Task Card ────────────────────────────────────────

interface TaskCardProps {
    task: ReviewTask
    participants: Participant[]
    index: number
    onUpdate: (id: string, field: keyof ReviewTask, value: any) => void
    onRemove: (id: string) => void
}

const TaskCard: FC<TaskCardProps> = ({ task, participants, index, onUpdate, onRemove }) => {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            {/* Header row */}
            <div className="flex items-start gap-2">
                <span className="flex-shrink-0 mt-2 text-xs font-bold text-slate-400">#{index + 1}</span>
                <input
                    value={task.title}
                    onChange={(e) => onUpdate(task.id, 'title', e.target.value)}
                    placeholder="Task title"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                    onClick={() => onRemove(task.id)}
                    className="flex-shrink-0 text-red-300 hover:text-red-600 transition-colors"
                    title="Remove task"
                >
                    <Trash2 size={16} />
                </button>
            </div>

            {/* Description */}
            <textarea
                value={task.description}
                onChange={(e) => onUpdate(task.id, 'description', e.target.value)}
                placeholder="Task description (optional)"
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />

            {/* Bottom fields */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {/* Assignee */}
                <div className="relative">
                    <User size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <select
                        value={task.assignedToId || ''}
                        onChange={(e) => onUpdate(task.id, 'assignedToId', e.target.value || null)}
                        className="w-full rounded-lg border border-slate-200 pl-7 pr-2 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                    >
                        <option value="">Unassigned</option>
                        {participants.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name || p.email}
                            </option>
                        ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>

                {/* Due date */}
                <div className="relative">
                    <Calendar size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="datetime-local"
                        value={task.dueDate ? task.dueDate.slice(0, 16) : ''}
                        onChange={(e) =>
                            onUpdate(task.id, 'dueDate', e.target.value ? new Date(e.target.value).toISOString() : null)
                        }
                        className="w-full rounded-lg border border-slate-200 pl-7 pr-2 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {/* Priority */}
                <div className="relative">
                    <select
                        value={task.priority}
                        onChange={(e) => onUpdate(task.id, 'priority', e.target.value as 'low' | 'medium' | 'high')}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                    >
                        {PRIORITY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label} Priority</option>
                        ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
            </div>
        </div>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const MeetingReview: FC = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const [tasks, setTasks] = useState<ReviewTask[]>([])
    const [minutesOfMeeting, setMinutesOfMeeting] = useState('')
    const [removedIds, setRemovedIds] = useState<string[]>([])
    const [initialized, setInitialized] = useState(false)

    // ── Fetch review data ─────────────────────────────────────────────────────
    const { data: review, isLoading, error } = useQuery<ReviewData>({
        queryKey: ['meeting-review', id],
        queryFn: async () => {
            const { data } = await apiClient.get(`/meetings/${id}/review`)
            return data?.data as ReviewData
        },
        enabled: !!id,
    })

    // Initialise local state once data loads
    useEffect(() => {
        if (review && !initialized) {
            setTasks(review.unconfirmedTasks.map((t) => ({
                ...t,
                description: t.description || '',
            })))
            setMinutesOfMeeting(review.minutesOfMeeting || '')
            setInitialized(true)
        }
    }, [review, initialized])

    // ── Confirm mutation ──────────────────────────────────────────────────────
    const confirmMutation = useMutation({
        mutationFn: async () => {
            const { data } = await apiClient.post(`/meetings/${id}/confirm`, {
                tasks: tasks.map((t) => ({
                    id: t.id,
                    title: t.title,
                    description: t.description,
                    assignedToId: t.assignedToId,
                    priority: t.priority,
                    dueDate: t.dueDate,
                })),
                minutesOfMeeting,
                deleteTaskIds: removedIds,
            })
            return data
        },
        onSuccess: (data) => {
            toast.success(`${data.data.confirmedCount} task(s) confirmed! Emails and reminders sent.`)
            navigate(`/meetings/${id}`)
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || 'Failed to confirm tasks')
        },
    })

    // ── Task helpers ──────────────────────────────────────────────────────────
    const handleUpdate = (taskId: string, field: keyof ReviewTask, value: any) => {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, [field]: value } : t)))
    }

    const handleRemove = (taskId: string) => {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        setRemovedIds((prev) => [...prev, taskId])
    }

    const handleAddTask = () => {
        const tempId = `new_${Date.now()}`
        setTasks((prev) => [
            ...prev,
            {
                id: tempId,
                title: '',
                description: '',
                assignedToId: null,
                priority: 'medium',
                dueDate: null,
                isConfirmed: false,
                assignedTo: null,
            },
        ])
    }

    // ── Loading / error states ────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    if (error || !review) {
        return (
            <div className="text-center py-20">
                <AlertTriangle className="mx-auto h-12 w-12 text-amber-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">Could not load review</h3>
                <button onClick={() => navigate(`/meetings/${id}`)} className="mt-4 text-blue-600 hover:underline">
                    Back to Meeting
                </button>
            </div>
        )
    }

    const participants = review.participants || []

    return (
        <div className="space-y-6">
            {/* Back + Title */}
            <div className="flex items-start justify-between">
                <button
                    onClick={() => navigate(`/meetings/${id}`)}
                    className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
                >
                    <ArrowLeft size={16} /> Back to Meeting
                </button>

                <button
                    disabled={confirmMutation.isPending || tasks.length === 0}
                    onClick={() => {
                        // Validate no empty titles
                        const hasEmpty = tasks.some((t) => !t.title.trim())
                        if (hasEmpty) {
                            toast.error('All tasks must have a title before confirming')
                            return
                        }
                        confirmMutation.mutate()
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {confirmMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <CheckCircle size={16} />
                    )}
                    {confirmMutation.isPending ? 'Confirming...' : 'Confirm All & Send'}
                </button>
            </div>

            {/* Page header */}
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4">
                <h1 className="text-xl font-bold text-slate-900 mb-1">
                    Review & Confirm — {review.title}
                </h1>
                <p className="text-sm text-slate-500">
                    Review the AI-generated Minutes of Meeting and extracted tasks below. Edit as needed, then click
                    <span className="font-semibold text-emerald-600"> Confirm All &amp; Send</span> to finalize.
                    Each assigned person will receive an email and a dashboard notification. Deadlines will be added to their calendar.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
                {/* ── MoM Editor (left / wider) ── */}
                <section className="xl:col-span-2 space-y-3">
                    <div className="flex items-center gap-2">
                        <FileText size={16} className="text-slate-600" />
                        <h2 className="text-base font-semibold text-slate-800">Minutes of Meeting</h2>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-slate-100 px-4 py-2 bg-slate-50 flex items-center justify-between">
                            <span className="text-xs text-slate-500">AI-generated — edit freely</span>
                            {review.summary && (
                                <span className="text-xs text-slate-400 italic truncate max-w-[160px]" title={review.summary}>
                                    {review.summary.slice(0, 60)}{review.summary.length > 60 ? '...' : ''}
                                </span>
                            )}
                        </div>
                        <textarea
                            value={minutesOfMeeting}
                            onChange={(e) => setMinutesOfMeeting(e.target.value)}
                            placeholder="No minutes generated yet. You can write them manually here."
                            rows={24}
                            className="w-full p-4 text-sm text-slate-700 focus:outline-none resize-y font-mono leading-relaxed"
                        />
                    </div>
                </section>

                {/* ── Tasks (right / wider) ── */}
                <section className="xl:col-span-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ClipboardList size={16} className="text-slate-600" />
                            <h2 className="text-base font-semibold text-slate-800">
                                Extracted Tasks
                                <span className="ml-2 rounded-full bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5">
                                    {tasks.length}
                                </span>
                            </h2>
                        </div>
                        <button
                            onClick={handleAddTask}
                            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                            <Plus size={14} /> Add task
                        </button>
                    </div>

                    {tasks.length === 0 ? (
                        <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
                            <ClipboardList size={32} className="mx-auto text-slate-300 mb-3" />
                            <p className="text-sm text-slate-400">No tasks extracted yet.</p>
                            <button
                                onClick={handleAddTask}
                                className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                            >
                                <Plus size={14} /> Add a task manually
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
                            {tasks.map((task, index) => (
                                <TaskCard
                                    key={task.id}
                                    task={task}
                                    participants={participants}
                                    index={index}
                                    onUpdate={handleUpdate}
                                    onRemove={handleRemove}
                                />
                            ))}
                        </div>
                    )}

                    {/* Bottom confirm button (duplicate for convenience) */}
                    {tasks.length > 0 && (
                        <div className="pt-2">
                            <button
                                disabled={confirmMutation.isPending}
                                onClick={() => {
                                    const hasEmpty = tasks.some((t) => !t.title.trim())
                                    if (hasEmpty) {
                                        toast.error('All tasks must have a title before confirming')
                                        return
                                    }
                                    confirmMutation.mutate()
                                }}
                                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                            >
                                {confirmMutation.isPending ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <CheckCircle size={16} />
                                )}
                                {confirmMutation.isPending
                                    ? 'Confirming & sending...'
                                    : `Confirm ${tasks.length} Task${tasks.length !== 1 ? 's' : ''} & Send`}
                            </button>
                            <p className="text-center text-xs text-slate-400 mt-2">
                                Assigned users will receive an email + dashboard notification. Deadlines are added to Google Calendar.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}

export default MeetingReview
