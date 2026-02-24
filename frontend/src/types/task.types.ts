import type { ID, ISODateString } from './common.types';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface Task {
    id: ID;
    title: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: ISODateString;
    assigneeId?: ID;
    meetingId?: ID;
    workspaceId: ID;
    createdAt: ISODateString;
    updatedAt: ISODateString;
}
