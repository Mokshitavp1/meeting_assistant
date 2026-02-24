import type { ID, ISODateString } from './common.types';

export type MeetingStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface MeetingParticipant {
    id: ID;
    name: string;
    email?: string;
    isHost?: boolean;
}

export interface TranscriptEntry {
    id: ID;
    speaker: string;
    text: string;
    timestamp: ISODateString;
}

export interface Meeting {
    id: ID;
    title: string;
    description?: string;
    workspaceId: ID;
    status: MeetingStatus;
    startedAt?: ISODateString;
    endedAt?: ISODateString;
    createdAt: ISODateString;
    updatedAt: ISODateString;
    participants?: MeetingParticipant[];
}
