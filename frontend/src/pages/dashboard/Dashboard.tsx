import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import MeetingRecorder from "../../components/meeting/MeetingRecorder";
import CreateMeetingModal from "../../components/meeting/CreateMeetingModal";
import CreateTaskModal from "../../components/task/CreateTaskModal";
import TaskCard from "../../components/task/TaskCard";
import { useAuthStore } from "../../store/authStore";
import { CalendarDays, CheckSquare, AlertTriangle, Plus, Loader2 } from "lucide-react";
import apiClient from "../../api/axios.config";
import toast from "react-hot-toast";

type DashboardTask = {
  id: string;
  title: string;
  description?: string;
  assignedTo?: {
    id: string;
    name: string;
    email: string;
  };
  dueDate?: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

type DashboardMeeting = {
  id: string;
  title: string;
  description?: string;
  scheduledStartTime: string;
  scheduledEndTime?: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  workspace?: {
    id: string;
    name: string;
  };
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
};

const startOfDay = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === "ADMIN";
  const today = startOfDay(new Date());
  const nextWeek = addDays(today, 7);

  const [showScheduleMeetingModal, setShowScheduleMeetingModal] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [meetings, setMeetings] = useState<DashboardMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch data from API
  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch tasks
      const tasksResponse = await apiClient.get('/tasks');
      setTasks(tasksResponse.data?.data?.tasks || []);

      // Fetch meetings
      const meetingsResponse = await apiClient.get('/meetings');
      setMeetings(meetingsResponse.data?.data?.meetings || []);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setTasks([]);
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  // Transform task data for display
  const visibleTasks = tasks.map(task => ({
    id: task.id,
    title: task.title,
    assignee: task.assignedTo ? task.assignedTo.name : "Unassigned",
    deadline: task.dueDate ? new Date(task.dueDate) : new Date(),
    priority: task.priority.toUpperCase() as "HIGH" | "MEDIUM" | "LOW",
    status: (() => {
      const s = task.status as string;
      if (s === "completed") return "COMPLETED" as const;
      if (s === "in_progress") return "IN_PROGRESS" as const;
      if (task.dueDate && new Date(task.dueDate) < new Date() && s !== "completed") {
        return "OVERDUE" as const;
      }
      return "PENDING" as const;
    })(),
  }));

  // Transform meeting data for display
  const upcomingMeetings = meetings
    .filter(meeting => {
      const meetingDate = new Date(meeting.scheduledStartTime);
      return meetingDate >= today && meeting.status === 'scheduled';
    })
    .map(meeting => ({
      id: meeting.id,
      title: meeting.title,
      startsAt: new Date(meeting.scheduledStartTime),
      workspace: meeting.workspace?.name || "Personal",
    }));

  const recentTasks = visibleTasks.filter((task) => {
    const taskDate = startOfDay(task.deadline);
    return taskDate >= today && taskDate <= nextWeek;
  });

  const overdueTasks = visibleTasks.filter((task) => task.status === "OVERDUE").length;
  const pendingTasks = visibleTasks.filter(
    (task) => task.status === "PENDING" || task.status === "IN_PROGRESS"
  ).length;

  const sevenDayCalendar = Array.from({ length: 7 }).map((_, index) => {
    const date = addDays(today, index);
    const meetingsOnDay = upcomingMeetings.filter(
      (meeting) => startOfDay(meeting.startsAt).getTime() === startOfDay(date).getTime()
    );

    return {
      date,
      meetings: meetingsOnDay,
    };
  });

  const handleScheduleMeeting = () => {
    setShowScheduleMeetingModal(true);
  };

  const handleCreateTask = () => {
    setShowCreateTaskModal(true);
  };

  // Handle modal success - refresh data
  const handleModalSuccess = () => {
    fetchData();
  };

  // Handle navigation
  const handleViewAllTasks = () => {
    navigate('/tasks/my');
  };

  const handleOpenAgenda = (meetingId: string) => {
    navigate(`/meetings/${meetingId}`);
  };

  // Handle task actions
  const handleMarkComplete = async (taskId: string) => {
    try {
      await apiClient.patch(`/tasks/${taskId}/status`, { status: 'completed' });
      toast.success('Task marked as complete');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update task');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await apiClient.delete(`/tasks/${taskId}`);
      toast.success('Task deleted');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to delete task');
    }
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="ml-2 text-slate-600">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Good Morning, {user?.fullName || "Guest"} 👋
          </h1>
          <p className="mt-1 text-slate-500">
            {isAdmin
              ? "Admin view: tracking all workspace tasks and meetings."
              : "Member view: tracking your assigned tasks and meetings."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleScheduleMeeting}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <CalendarDays size={16} /> Schedule Meeting
          </button>
          <button
            onClick={handleCreateTask}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus size={16} /> Create Task
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-slate-600">
            <CheckSquare size={16} />
            <span className="text-sm font-medium">My Tasks</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{pendingTasks}</p>
          <p className="mt-1 text-xs text-slate-500">Pending + in progress</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-red-600">
            <AlertTriangle size={16} />
            <span className="text-sm font-medium">Overdue Tasks</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{overdueTasks}</p>
          <p className="mt-1 text-xs text-slate-500">Needs immediate attention</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-blue-600">
            <CalendarDays size={16} />
            <span className="text-sm font-medium">Upcoming Meetings</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{upcomingMeetings.length}</p>
          <p className="mt-1 text-xs text-slate-500">Next 7 days</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <div className="lg:col-span-8 space-y-6">
          <MeetingRecorder />

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">📅 Upcoming Meetings Calendar</h2>
              <p className="text-xs font-medium text-slate-500">Today + next 6 days</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {sevenDayCalendar.map(({ date, meetings }) => (
                <div key={date.toISOString()} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-700">
                    {date.toLocaleDateString(undefined, { weekday: "short" })}
                  </p>
                  <p className="text-lg font-bold text-slate-900">{date.getDate()}</p>
                  <p className="text-xs text-slate-500">{meetings.length} meeting(s)</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold mb-4 text-slate-800">📌 Upcoming Meeting Details</h2>
            <div className="flex flex-col gap-3">
              {upcomingMeetings.map((meeting) => (
                <div
                  key={meeting.id}
                  className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <h3 className="font-semibold text-slate-900">{meeting.title}</h3>
                    <p className="text-sm text-slate-500">
                      {meeting.startsAt.toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {" • "}
                      {meeting.workspace}
                    </p>
                  </div>
                  <button
                    onClick={() => handleOpenAgenda(meeting.id)}
                    className="text-blue-600 text-sm font-medium hover:underline"
                  >
                    Open Agenda
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-4 xl:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">
              ⚡ {isAdmin ? "Workspace Tasks" : "My Tasks"}
            </h2>
            <button
              onClick={handleViewAllTasks}
              className="text-xs font-bold text-blue-600 uppercase hover:underline"
            >
              View All
            </button>
          </div>

          <p className="text-xs text-slate-500">Showing tasks due today through the next 7 days.</p>

          <div className="space-y-3">
            {recentTasks.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                No tasks due in the selected range.
              </div>
            ) : (
              recentTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  id={task.id}
                  title={task.title}
                  assignee={task.assignee}
                  deadline={task.deadline}
                  priority={task.priority}
                  status={task.status}
                  onViewDetails={(taskId) => navigate(`/tasks/${taskId}`)}
                  onMarkComplete={(taskId) => handleMarkComplete(taskId)}
                  onEdit={(taskId) => navigate(`/tasks/${taskId}`)}
                  onDelete={(taskId) => handleDeleteTask(taskId)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showScheduleMeetingModal && (
        <CreateMeetingModal
          onClose={() => setShowScheduleMeetingModal(false)}
          onSuccess={() => {
            setShowScheduleMeetingModal(false);
            handleModalSuccess();
          }}
        />
      )}
      {showCreateTaskModal && (
        <CreateTaskModal
          onClose={() => setShowCreateTaskModal(false)}
          onSuccess={() => {
            setShowCreateTaskModal(false);
            handleModalSuccess();
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;