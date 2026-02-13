import { Calendar, User as UserIcon, CheckCircle2 } from "lucide-react";
import clsx from "clsx";

interface TaskProps {
  title: string;
  assignee?: string;
  deadline?: string;
  priority?: "HIGH" | "MEDIUM" | "LOW";
  status?: "PENDING" | "COMPLETED";
}

const TaskCard = ({ title, assignee, deadline, priority = "MEDIUM", status = "PENDING" }: TaskProps) => {
  return (
    <div className="group bg-white p-4 rounded-xl border border-slate-200 hover:shadow-md transition-all duration-200 cursor-pointer">
      <div className="flex justify-between items-start mb-2">
        <span
          className={clsx(
            "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider",
            priority === "HIGH" ? "bg-red-100 text-red-700" :
            priority === "MEDIUM" ? "bg-amber-100 text-amber-700" :
            "bg-blue-100 text-blue-700"
          )}
        >
          {priority}
        </span>
        
        {status === "COMPLETED" ? (
          <CheckCircle2 size={18} className="text-green-500" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-slate-300 group-hover:border-blue-500 transition-colors" />
        )}
      </div>

      <h3 className={clsx(
        "font-semibold text-slate-800 mb-3 text-sm leading-tight",
        status === "COMPLETED" && "line-through text-slate-400"
      )}>
        {title}
      </h3>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
             <UserIcon size={12} className="text-slate-400" />
          </div>
          <span className="font-medium">{assignee || "Unassigned"}</span>
        </div>
        
        {deadline && (
          <div className={clsx(
            "flex items-center gap-1.5 px-2 py-1 rounded",
            // Highlight deadline if it's urgent (logic could be added here)
            "bg-slate-50 text-slate-600"
          )}>
            <Calendar size={12} />
            <span>{deadline}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCard;