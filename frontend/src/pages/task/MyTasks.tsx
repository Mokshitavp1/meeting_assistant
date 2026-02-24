import { useMemo, useState, type FC } from "react";
import { Calendar, Search, SlidersHorizontal } from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import type { TaskPriority, TaskStatus } from "../../components/task/TaskCard";

type SortBy = "DEADLINE" | "PRIORITY" | "STATUS";
type GroupKey = "OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER";

type TaskItem = {
    id: string;
    title: string;
    description: string;
    assigneeId: string;
    assigneeName: string;
    priority: TaskPriority;
    status: TaskStatus;
    deadline: Date;
    createdAt: Date;
};

const PRIORITY_RANK: Record<TaskPriority, number> = {
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
};

const STATUS_RANK: Record<TaskStatus, number> = {
    OVERDUE: 1,
    IN_PROGRESS: 2,
    PENDING: 3,
    COMPLETED: 4,
};

const formatDate = (date: Date): string =>
    date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });

const normalizeDay = (date: Date): Date => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
};

const addDays = (date: Date, days: number): Date => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

const MyTasks: FC = () => {
    const user = useAuthStore((state) => state.user);
    const currentUserId = user?.id ?? "member-1";
    const currentUserName = user?.fullName ?? "You";

    const today = normalizeDay(new Date());
    const weekEnd = addDays(today, 7);

    const [tasks, setTasks] = useState<TaskItem[]>([
        {
            id: "task-1",
            title: "Finalize Q1 sprint retro notes",
            description: "Capture blockers, wins, and next sprint commitments.",
            assigneeId: currentUserId,
            assigneeName: currentUserName,
            priority: "HIGH",
            status: "IN_PROGRESS",
            deadline: today,
            createdAt: addDays(today, -2),
        },
        {
            id: "task-2",
            title: "Prepare release checklist",
            description: "Ensure QA sign-off and deployment steps are complete.",
            assigneeId: currentUserId,
            assigneeName: currentUserName,
            priority: "MEDIUM",
            status: "PENDING",
            deadline: addDays(today, 3),
            createdAt: addDays(today, -1),
        },
        {
            id: "task-3",
            title: "Follow up on security review",
            description: "Review findings and close remaining action items.",
            assigneeId: currentUserId,
            assigneeName: currentUserName,
            priority: "HIGH",
            status: "OVERDUE",
            deadline: addDays(today, -1),
            createdAt: addDays(today, -5),
        },
        {
            id: "task-4",
            title: "Draft onboarding improvements",
            description: "Update docs and record onboarding walkthrough video.",
            assigneeId: currentUserId,
            assigneeName: currentUserName,
            priority: "LOW",
            status: "PENDING",
            deadline: addDays(today, 12),
            createdAt: addDays(today, -3),
        },
        {
            id: "task-5",
            title: "Coordinate demo script",
            description: "Confirm flow with product and support teams.",
            assigneeId: currentUserId,
            assigneeName: currentUserName,
            priority: "MEDIUM",
            status: "COMPLETED",
            deadline: addDays(today, 1),
            createdAt: addDays(today, -4),
        },
        {
            id: "task-6",
            title: "Backend sync preparation",
            description: "Summarize API contract updates for tomorrow.",
            assigneeId: "member-2",
            assigneeName: "Alex",
            priority: "LOW",
            status: "PENDING",
            deadline: addDays(today, 2),
            createdAt: addDays(today, -2),
        },
    ]);

    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<"ALL" | TaskStatus>("ALL");
    const [priorityFilter, setPriorityFilter] = useState<"ALL" | TaskPriority>("ALL");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [sortBy, setSortBy] = useState<SortBy>("DEADLINE");
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    const myTasks = useMemo(
        () => tasks.filter((task) => task.assigneeId === currentUserId),
        [tasks, currentUserId]
    );

    const filteredTasks = useMemo(() => {
        const fromDate = dateFrom ? normalizeDay(new Date(dateFrom)) : null;
        const toDate = dateTo ? normalizeDay(new Date(dateTo)) : null;

        const result = myTasks.filter((task) => {
            const normalizedDeadline = normalizeDay(task.deadline);

            const matchesSearch =
                !search.trim() ||
                task.title.toLowerCase().includes(search.toLowerCase()) ||
                task.description.toLowerCase().includes(search.toLowerCase());

            const matchesStatus = statusFilter === "ALL" || task.status === statusFilter;
            const matchesPriority = priorityFilter === "ALL" || task.priority === priorityFilter;
            const matchesFrom = !fromDate || normalizedDeadline >= fromDate;
            const matchesTo = !toDate || normalizedDeadline <= toDate;

            return matchesSearch && matchesStatus && matchesPriority && matchesFrom && matchesTo;
        });

        return [...result].sort((left, right) => {
            if (sortBy === "DEADLINE") {
                return left.deadline.getTime() - right.deadline.getTime();
            }

            if (sortBy === "PRIORITY") {
                return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
            }

            return STATUS_RANK[left.status] - STATUS_RANK[right.status];
        });
    }, [myTasks, search, statusFilter, priorityFilter, dateFrom, dateTo, sortBy]);

    const groupedTasks = useMemo(() => {
        const groups: Record<GroupKey, TaskItem[]> = {
            OVERDUE: [],
            TODAY: [],
            THIS_WEEK: [],
            LATER: [],
        };

        filteredTasks.forEach((task) => {
            const deadline = normalizeDay(task.deadline);

            if ((deadline < today && task.status !== "COMPLETED") || task.status === "OVERDUE") {
                groups.OVERDUE.push(task);
                return;
            }

            if (deadline.getTime() === today.getTime()) {
                groups.TODAY.push(task);
                return;
            }

            if (deadline <= weekEnd) {
                groups.THIS_WEEK.push(task);
                return;
            }

            groups.LATER.push(task);
        });

        return groups;
    }, [filteredTasks, today, weekEnd]);

    const selectedTask = useMemo(
        () => myTasks.find((task) => task.id === selectedTaskId) ?? null,
        [myTasks, selectedTaskId]
    );

    const toggleTaskCompleted = (taskId: string, checked: boolean) => {
        setTasks((previous) =>
            previous.map((task) => {
                if (task.id !== taskId) {
                    return task;
                }

                return {
                    ...task,
                    status: checked ? "COMPLETED" : "PENDING",
                };
            })
        );
    };

    const groupMeta: Array<{ key: GroupKey; label: string }> = [
        { key: "OVERDUE", label: "Overdue" },
        { key: "TODAY", label: "Today" },
        { key: "THIS_WEEK", label: "This Week" },
        { key: "LATER", label: "Later" },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold text-slate-900">My Tasks</h1>
                <p className="text-sm text-slate-500">Manage tasks assigned to you with filters and quick updates.</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <label className="xl:col-span-2">
                        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                            <Search size={14} /> Search
                        </span>
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by title or description"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                    </label>

                    <label>
                        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                            <SlidersHorizontal size={14} /> Status
                        </span>
                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value as "ALL" | TaskStatus)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        >
                            <option value="ALL">All</option>
                            <option value="PENDING">Pending</option>
                            <option value="IN_PROGRESS">In Progress</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="OVERDUE">Overdue</option>
                        </select>
                    </label>

                    <label>
                        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">Priority</span>
                        <select
                            value={priorityFilter}
                            onChange={(event) => setPriorityFilter(event.target.value as "ALL" | TaskPriority)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        >
                            <option value="ALL">All</option>
                            <option value="HIGH">High</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="LOW">Low</option>
                        </select>
                    </label>

                    <label>
                        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                            <Calendar size={14} /> From
                        </span>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(event) => setDateFrom(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                    </label>

                    <label>
                        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">To</span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(event) => setDateTo(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                    </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-600">Sort by:</span>
                    <select
                        value={sortBy}
                        onChange={(event) => setSortBy(event.target.value as SortBy)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    >
                        <option value="DEADLINE">Deadline</option>
                        <option value="PRIORITY">Priority</option>
                        <option value="STATUS">Status</option>
                    </select>
                    <span className="ml-auto text-xs text-slate-500">{filteredTasks.length} task(s) found</span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="space-y-5 xl:col-span-8">
                    {groupMeta.map((group) => (
                        <section key={group.key} className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-slate-800">{group.label}</h2>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                    {groupedTasks[group.key].length}
                                </span>
                            </div>

                            {groupedTasks[group.key].length === 0 ? (
                                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                                    No tasks in this group.
                                </div>
                            ) : (
                                groupedTasks[group.key].map((task) => (
                                    <div
                                        key={task.id}
                                        onClick={() => setSelectedTaskId(task.id)}
                                        className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-300"
                                    >
                                        <div className="flex items-start gap-3">
                                            <input
                                                type="checkbox"
                                                checked={task.status === "COMPLETED"}
                                                onChange={(event) => toggleTaskCompleted(task.id, event.target.checked)}
                                                onClick={(event) => event.stopPropagation()}
                                                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                aria-label={`Mark ${task.title} complete`}
                                            />

                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="text-sm font-semibold text-slate-900">{task.title}</h3>
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                                        {task.status.replace("_", " ")}
                                                    </span>
                                                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                                                        {task.priority}
                                                    </span>
                                                </div>

                                                <p className="mt-1 text-sm text-slate-600">{task.description}</p>
                                                <p className="mt-2 text-xs text-slate-500">Deadline: {formatDate(task.deadline)}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </section>
                    ))}
                </div>

                <aside className="xl:col-span-4">
                    <div className="sticky top-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-900">Task Details</h2>

                        {!selectedTask ? (
                            <p className="mt-3 text-sm text-slate-500">Select a task card to view full details.</p>
                        ) : (
                            <div className="mt-3 space-y-3 text-sm">
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Title</p>
                                    <p className="font-medium text-slate-900">{selectedTask.title}</p>
                                </div>

                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Description</p>
                                    <p className="text-slate-700">{selectedTask.description}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
                                        <p className="font-medium text-slate-800">{selectedTask.status.replace("_", " ")}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wide text-slate-500">Priority</p>
                                        <p className="font-medium text-slate-800">{selectedTask.priority}</p>
                                    </div>
                                </div>

                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Deadline</p>
                                    <p className="font-medium text-slate-800">{formatDate(selectedTask.deadline)}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default MyTasks;
