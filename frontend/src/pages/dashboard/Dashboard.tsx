import MeetingRecorder from "../../components/meeting/MeetingRecorder";
import TaskCard from "../../components/task/TaskCard";
import { useAuthStore } from "../../store/authStore";
import { CalendarDays, CheckSquare, AlertTriangle, Plus } from "lucide-react";

type DashboardTask = {
  id: string;
  title: string;
  assignee: string;
  deadline: Date;
  priority: "HIGH" | "MEDIUM" | "LOW";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
};

type DashboardMeeting = {
  id: string;
  title: string;
  startsAt: Date;
  workspace: string;
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
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === "ADMIN";
  const today = startOfDay(new Date());
  const nextWeek = addDays(today, 7);

  const allWorkspaceTasks: DashboardTask[] = [
    {
      id: "task-1",
      title: "Fix login authentication bug on staging",
      assignee: "John Doe",
      deadline: addDays(today, 1),
      priority: "HIGH",
      status: "IN_PROGRESS",
    },
    {
      id: "task-2",
      title: "Update privacy policy for GDPR compliance",
      assignee: "Sarah Smith",
      deadline: addDays(today, 5),
      priority: "MEDIUM",
      status: "PENDING",
    },
    {
      id: "task-3",
      title: "Prepare Q3 marketing slides",
      assignee: "You",
      deadline: addDays(today, 7),
      priority: "LOW",
      status: "PENDING",
    },
    {
      id: "task-4",
      title: "Share sprint demo notes",
      assignee: "You",
      deadline: addDays(today, -1),
      priority: "MEDIUM",
      status: "OVERDUE",
    },
    {
      id: "task-5",
      title: "Schedule team sync",
      assignee: "Mike",
      deadline: addDays(today, 2),
      priority: "MEDIUM",
      status: "COMPLETED",
    },
  ];

  const upcomingMeetings: DashboardMeeting[] = [
    {
      id: "meeting-1",
      title: "Weekly Engineering Sync",
      startsAt: new Date(new Date().setHours(10, 0, 0, 0)),
      workspace: "Engineering",
    },
    {
      id: "meeting-2",
      title: "Product Roadmap Review",
      startsAt: addDays(new Date(new Date().setHours(14, 0, 0, 0)), 2),
      workspace: "Product",
    },
    {
      id: "meeting-3",
      title: "Customer Feedback Roundup",
      startsAt: addDays(new Date(new Date().setHours(11, 30, 0, 0)), 4),
      workspace: "Growth",
    },
  ];

  const visibleTasks = isAdmin
    ? allWorkspaceTasks
    : allWorkspaceTasks.filter((task) => task.assignee.toLowerCase() === "you");

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
    console.log("Schedule meeting action triggered");
  };

  const handleCreateTask = () => {
    console.log("Create task action triggered");
  };

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
                  <button className="text-blue-600 text-sm font-medium hover:underline">Open Agenda</button>
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
            <button className="text-xs font-bold text-blue-600 uppercase hover:underline">View All</button>
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
                  onViewDetails={(taskId) => console.log("View details", taskId)}
                  onMarkComplete={(taskId) => console.log("Mark complete", taskId)}
                  onEdit={(taskId) => console.log("Edit task", taskId)}
                  onDelete={(taskId) => console.log("Delete task", taskId)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;