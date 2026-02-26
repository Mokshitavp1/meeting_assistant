import { useState, useRef, useEffect, type FC } from 'react'
import { Bell, X, CheckCheck, ClipboardList, Calendar } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import apiClient from '../../api/axios.config'

interface Notification {
    id: string
    type: 'task-assignment' | 'task-reminder' | 'task-overdue' | 'meeting-review-ready'
    title: string
    message: string
    taskId?: string
    meetingId?: string
    meetingTitle?: string
    createdAt: string
    read: boolean
}

interface NotificationsResponse {
    notifications: Notification[]
    unreadCount: number
    total: number
}

const NotificationBell: FC = () => {
    const [open, setOpen] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const { data } = useQuery<NotificationsResponse>({
        queryKey: ['notifications'],
        queryFn: async () => {
            const { data } = await apiClient.get('/notifications')
            return data?.data
        },
        refetchInterval: 30_000, // poll every 30 seconds
    })

    const markReadMutation = useMutation({
        mutationFn: async (id: string) => {
            await apiClient.patch(`/notifications/${id}/read`)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    })

    const markAllReadMutation = useMutation({
        mutationFn: async () => {
            await apiClient.patch('/notifications/read-all')
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    })

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await apiClient.delete(`/notifications/${id}`)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    })

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    const notifications = data?.notifications || []
    const unreadCount = data?.unreadCount || 0

    const handleNotificationClick = (n: Notification) => {
        markReadMutation.mutate(n.id)
        setOpen(false)
        if (n.type === 'meeting-review-ready' && n.meetingId) {
            navigate(`/meetings/${n.meetingId}/review`)
        } else if (n.taskId) {
            navigate(`/tasks/${n.taskId}`)
        }
    }

    const getIcon = (type: Notification['type']) => {
        switch (type) {
            case 'meeting-review-ready': return <Calendar size={14} className="text-blue-500" />
            case 'task-assignment': return <ClipboardList size={14} className="text-emerald-500" />
            default: return <Bell size={14} className="text-amber-500" />
        }
    }

    const formatRelative = (iso: string) => {
        const diff = Date.now() - new Date(iso).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 1) return 'just now'
        if (mins < 60) return `${mins}m ago`
        const hrs = Math.floor(mins / 60)
        if (hrs < 24) return `${hrs}h ago`
        return `${Math.floor(hrs / 24)}d ago`
    }

    return (
        <div className="relative" ref={panelRef}>
            {/* Bell button */}
            <button
                onClick={() => setOpen((v) => !v)}
                className="relative p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Notifications"
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Panel */}
            {open && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-50">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                        <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
                        {unreadCount > 0 && (
                            <button
                                onClick={() => markAllReadMutation.mutate()}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                            >
                                <CheckCheck size={12} />
                                Mark all read
                            </button>
                        )}
                    </div>

                    {/* List */}
                    <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                        {notifications.length === 0 ? (
                            <div className="py-10 text-center text-sm text-slate-400">
                                <Bell size={28} className="mx-auto mb-2 opacity-30" />
                                No notifications yet
                            </div>
                        ) : (
                            notifications.slice(0, 20).map((n) => (
                                <div
                                    key={n.id}
                                    className={`flex gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${!n.read ? 'bg-blue-50/50' : ''}`}
                                    onClick={() => handleNotificationClick(n)}
                                >
                                    <div className="flex-shrink-0 mt-0.5">{getIcon(n.type)}</div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-xs font-semibold truncate ${!n.read ? 'text-slate-900' : 'text-slate-600'}`}>
                                            {n.title}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                                        <p className="text-[10px] text-slate-400 mt-1">{formatRelative(n.createdAt)}</p>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(n.id) }}
                                        className="flex-shrink-0 text-slate-300 hover:text-slate-500 mt-0.5"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default NotificationBell
