import MeetingRecorder from "../../components/meeting/MeetingRecorder";
import TaskCard from "../../components/task/TaskCard";
import { useAuthStore } from "../../store/authStore";

const Dashboard = () => {
  const user = useAuthStore((state) => state.user);

  // Fake data to visualize the UI before connecting Backend
  const recentTasks = [
    { title: "Fix login authentication bug on staging", assignee: "John Doe", deadline: "Tomorrow", priority: "HIGH" },
    { title: "Update privacy policy for GDPR compliance", assignee: "Sarah Smith", deadline: "Next Week", priority: "MEDIUM" },
    { title: "Prepare Q3 marketing slides", assignee: "You", deadline: "Fri, Oct 24", priority: "LOW" },
    { title: "Schedule team sync", assignee: "Mike", deadline: "Today", priority: "MEDIUM", status: "COMPLETED" },
  ] as const;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Good Morning, {user?.fullName || "Guest"} 👋
          </h1>
          <p className="text-slate-500 mt-1">Here is what's happening in your workspace today.</p>
        </div>
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-slate-900">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Recorder (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          <MeetingRecorder />
          
          {/* Recent Meetings List (Placeholder) */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold mb-4 text-slate-800">📅 Recent Meetings</h2>
            <div className="flex flex-col gap-3">
               <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold text-slate-900">Weekly Engineering Sync</h3>
                    <p className="text-sm text-slate-500">Recorded Yesterday • 45 mins</p>
                  </div>
                  <button className="text-blue-600 text-sm font-medium hover:underline">View Notes</button>
               </div>
               <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 flex justify-between items-center opacity-70">
                  <div>
                    <h3 className="font-semibold text-slate-900">Product Design Review</h3>
                    <p className="text-sm text-slate-500">Recorded Oct 12 • 1h 10m</p>
                  </div>
                  <button className="text-blue-600 text-sm font-medium hover:underline">View Notes</button>
               </div>
            </div>
          </div>
        </div>

        {/* Right Column: Tasks (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">⚡ My Tasks</h2>
            <button className="text-xs font-bold text-blue-600 uppercase hover:underline">View All</button>
          </div>
          
          <div className="space-y-3">
            {recentTasks.map((task, idx) => (
              // @ts-ignore
              <TaskCard key={idx} {...task} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;