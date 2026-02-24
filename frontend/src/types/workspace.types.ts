import type { ID, ISODateString } from './common.types';

export interface WorkspaceMember {
    id: ID;
    userId: ID;
    workspaceId: ID;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export interface Workspace {
    id: ID;
    name: string;
    description?: string;
    createdAt: ISODateString;
    updatedAt: ISODateString;
    members?: WorkspaceMember[];
}
