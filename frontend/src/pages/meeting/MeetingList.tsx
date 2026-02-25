import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Calendar, Clock, Users, Plus, Video, MapPin } from 'lucide-react'

interface Meeting {
    id: string
    title: string
    description?: string
    startsAt: string
    endsAt?: string
    workspace: string
    participantCount: number
    status: 'SCHEDULED' | 'LIVE' | 'COMPLETED'
    location?: string
}

const fetchMeetings = async (): Promise<Meeting[]> => {
    // Mock data for now
    return [
        {
            id: '1',
            title: 'Weekly Engineering Standup',
            description: 'Weekly team sync and sprint planning',
            startsAt: '2024-02-26T10:00:00Z',
            endsAt: '2024-02-26T11:00:00Z',
            workspace: 'Engineering Team',
            participantCount: 8,
            status: 'SCHEDULED',
            location: 'Conference Room A'
        },
        {
            id: '2',
            title: 'Product Review Session',
            description: 'Review new feature designs and prototypes',
            startsAt: '2024-02-26T14:00:00Z',
            endsAt: '2024-02-26T15:30:00Z',
            workspace: 'Design Sprint',
            participantCount: 5,
            status: 'SCHEDULED'
        },
        {
            id: '3',
            title: 'Client Presentation',
            startsAt: '2024-02-25T09:00:00Z',
            endsAt: '2024-02-25T10:00:00Z',
            workspace: 'Sales Team',
            participantCount: 12,
            status: 'COMPLETED'
        }
    ]
}

const MeetingList = () => {
    const navigate = useNavigate()
    const [filter, setFilter] = useState<'all' | 'scheduled' | 'live' | 'completed'>('all')

    const { data: meetings = [], isLoading } = useQuery({
        queryKey: ['meetings'],
        queryFn: fetchMeetings
    })

    const filteredMeetings = meetings.filter(meeting => {
        if (filter === 'all') return true
        return meeting.status.toLowerCase() === filter
    })

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'LIVE': return 'bg-red-50 border-red-200 text-red-700'
            case 'SCHEDULED': return 'bg-blue-50 border-blue-200 text-blue-700'
            case 'COMPLETED': return 'bg-green-50 border-green-200 text-green-700'
            default: return 'bg-gray-50 border-gray-200 text-gray-700'
        }
    }

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString)
        return {
            date: date.toLocaleDateString(),
            time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
    }

    const handleJoinMeeting = (meetingId: string) => {
        navigate(`/meetings/${meetingId}/live`)
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
                    <h1 className="text-2xl font-bold text-gray-900">Meetings</h1>
                    <p className="text-gray-500 text-sm mt-1">Manage your scheduled and past meetings</p>
                </div>
                <button className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
                    <Plus size={16} /> Schedule Meeting
                </button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
                <Calendar size={16} className="text-gray-400" />
                <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
                    {(['all', 'scheduled', 'live', 'completed'] as const).map((status) => (
                        <button
                            key={status}
                            onClick={() => setFilter(status)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${filter === status
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            {status}
                        </button>
                    ))}
                </div>
            </div>

            {/* Meeting List */}
            {filteredMeetings.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
                    <Video className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-1">No meetings found</h3>
                    <p className="text-gray-500 text-sm">
                        {filter === 'all' ? 'No meetings scheduled yet' : `No ${filter} meetings`}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredMeetings.map((meeting) => {
                        const { date, time } = formatDateTime(meeting.startsAt)
                        const endTime = meeting.endsAt ? formatDateTime(meeting.endsAt).time : null

                        return (
                            <div
                                key={meeting.id}
                                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <h3 className="font-semibold text-gray-900">{meeting.title}</h3>
                                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(meeting.status)}`}>
                                                {meeting.status}
                                            </span>
                                        </div>

                                        {meeting.description && (
                                            <p className="text-gray-600 text-sm mb-2">{meeting.description}</p>
                                        )}

                                        <div className="flex items-center gap-4 text-sm text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <Calendar size={14} />
                                                {date}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Clock size={14} />
                                                {time}{endTime && ` - ${endTime}`}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Users size={14} />
                                                {meeting.participantCount} participants
                                            </span>
                                            {meeting.location && (
                                                <span className="flex items-center gap-1">
                                                    <MapPin size={14} />
                                                    {meeting.location}
                                                </span>
                                            )}
                                        </div>

                                        <div className="text-sm text-gray-600 mt-1">
                                            Workspace: {meeting.workspace}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 ml-4">
                                        {meeting.status === 'LIVE' && (
                                            <button
                                                onClick={() => handleJoinMeeting(meeting.id)}
                                                className="px-3 py-1 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                                            >
                                                Join Live
                                            </button>
                                        )}
                                        {meeting.status === 'SCHEDULED' && (
                                            <button
                                                onClick={() => navigate(`/meetings/${meeting.id}`)}
                                                className="px-3 py-1 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                                            >
                                                View Details
                                            </button>
                                        )}
                                        {meeting.status === 'COMPLETED' && (
                                            <button
                                                onClick={() => navigate(`/meetings/${meeting.id}`)}
                                                className="px-3 py-1 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                                            >
                                                View Recording
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

export default MeetingList
