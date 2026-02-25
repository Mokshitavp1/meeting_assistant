import type { FC } from 'react'
import { CalendarDays, ChevronRight, Clock } from 'lucide-react'
import type { Meeting } from '../../types/meeting.types'

interface MeetingCardProps {
    meeting: Meeting & { scheduledStartTime?: string }
    onClick?: (id: string) => void
}

const statusStyles: Record<string, string> = {
    scheduled: 'bg-gray-100 text-gray-700',
    in_progress: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
    SCHEDULED: 'bg-gray-100 text-gray-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
}

const MeetingCard: FC<MeetingCardProps> = ({ meeting, onClick }) => {
    const dateStr = meeting.scheduledStartTime || meeting.startedAt || meeting.createdAt
    const formattedDate = dateStr
        ? new Date(dateStr).toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        })
        : 'No date set'

    return (
        <div
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => onClick?.(meeting.id)}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-11 h-11 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                        <CalendarDays className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-900">{meeting.title}</h3>
                        {meeting.description && (
                            <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">{meeting.description}</p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right hidden sm:block">
                        <div className="flex items-center gap-1 text-sm text-slate-500">
                            <Clock className="w-4 h-4" />
                            <span>{formattedDate}</span>
                        </div>
                        <span
                            className={`mt-1 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${statusStyles[meeting.status] ?? 'bg-gray-100 text-gray-700'
                                }`}
                        >
                            {meeting.status.replace('_', ' ').toLowerCase()}
                        </span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                </div>
            </div>
        </div>
    )
}

export default MeetingCard
