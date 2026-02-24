import {
  Calendar,
  User as UserIcon,
  CheckCircle2,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import clsx from "clsx";

export type TaskPriority = "HIGH" | "MEDIUM" | "LOW";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";

interface TaskCardProps {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  assigneeAvatarUrl?: string;
  deadline?: string | Date;
  priority?: TaskPriority;
  status?: TaskStatus;
  onViewDetails?: (taskId: string) => void;
  onMarkComplete?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}

const statusStyles: Record<TaskStatus, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
};

const priorityStyles: Record<TaskPriority, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-blue-100 text-blue-700",
};

const getAssigneeInitials = (assignee?: string): string => {
  if (!assignee) {
    return "UA";
  }

  const parts = assignee
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "UA";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
};

const getDeadlineMeta = (deadline?: string | Date) => {
  if (!deadline) {
    return null;
  }

  const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(deadlineDate.getTime())) {
    return null;
  }

  const now = new Date();
  const diffMs = deadlineDate.getTime() - now.getTime();
  const isOverdue = diffMs < 0;
  const absDiffMs = Math.abs(diffMs);

  const minutes = Math.floor(absDiffMs / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let relative = "Due soon";
  if (days > 0) {
    relative = isOverdue ? `${days}d overdue` : `${days}d left`;
  } else if (hours > 0) {
    relative = isOverdue ? `${hours}h overdue` : `${hours}h left`;
  } else {
    relative = isOverdue ? `${Math.max(minutes, 1)}m overdue` : `${Math.max(minutes, 1)}m left`;
  }

  return {
    formattedDate: deadlineDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    relative,
    isOverdue,
  };
};

const TaskCard = ({
  id,
  title,
  description,
  assignee,
  assigneeAvatarUrl,
  deadline,
  priority = "MEDIUM",
  status = "PENDING",
  onViewDetails,
  onMarkComplete,
  onEdit,
  onDelete,
}: TaskCardProps) => {
  const deadlineMeta = getDeadlineMeta(deadline);
  const initials = getAssigneeInitials(assignee);
  const isCompleted = status === "COMPLETED";

  const handleViewDetails = () => {
    onViewDetails?.(id);
  };

  const handleActionClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    action?: (taskId: string) => void
  ) => {
    event.stopPropagation();
    action?.(id);
  };

  return (
    <article
      className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 hover:shadow-md"
      onClick={handleViewDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleViewDetails();
        }
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
              priorityStyles[priority]
            )}
          >
            {priority}
          </span>
          <span
            className={clsx(
              "rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
              statusStyles[status]
            )}
          >
            {status.replace("_", " ")}
          </span>
        </div>

        {isCompleted ? (
          <CheckCircle2 size={18} className="text-green-500" />
        ) : deadlineMeta?.isOverdue || status === "OVERDUE" ? (
          <AlertTriangle size={18} className="text-red-500" />
        ) : (
          <div className="h-4 w-4 rounded-full border-2 border-slate-300 transition-colors group-hover:border-blue-500" />
        )}
      </div>

      <h3
        className={clsx(
          "mb-1 text-sm font-semibold leading-tight text-slate-800",
          isCompleted && "text-slate-400 line-through"
        )}
      >
        {title}
      </h3>

      {description && <p className="mb-4 line-clamp-2 text-xs text-slate-500">{description}</p>}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {assigneeAvatarUrl ? (
            <img
              src={assigneeAvatarUrl}
              alt={assignee ?? "Assignee"}
              className="h-7 w-7 rounded-full border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-[10px] font-bold text-slate-600">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-700">{assignee || "Unassigned"}</p>
            <p className="text-[11px] text-slate-500">Assignee</p>
          </div>
        </div>

        {deadlineMeta && (
          <div
            className={clsx(
              "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs",
              deadlineMeta.isOverdue ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-600"
            )}
          >
            <Calendar size={12} />
            <span>{deadlineMeta.formattedDate}</span>
            <span className="font-semibold">• {deadlineMeta.relative}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={(event) => handleActionClick(event, onMarkComplete)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <CheckCircle2 size={14} /> Mark Complete
        </button>
        <button
          type="button"
          onClick={(event) => handleActionClick(event, onEdit)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Pencil size={14} /> Edit
        </button>
        <button
          type="button"
          onClick={(event) => handleActionClick(event, onDelete)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          <Trash2 size={14} /> Delete
        </button>

        <div className="ml-auto hidden items-center gap-1 text-[11px] text-slate-400 sm:flex">
          <UserIcon size={12} /> Click card for details
        </div>
      </div>
    </article>
  );
};

export default TaskCard;