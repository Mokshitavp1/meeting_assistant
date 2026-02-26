import { useEffect, useMemo, useState, type FC } from "react";
import { Mic, MicOff, PhoneOff, Users, Captions } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { useParams, useNavigate } from "react-router-dom";
import MeetingRecorder from "../../components/meeting/MeetingRecorder";
import apiClient from "../../api/axios.config";
import { useAuthStore } from "../../store/authStore";
import { useQuery } from "@tanstack/react-query";

type Participant = {
    id: string;
    name: string;
    isMuted?: boolean;
    isOnline?: boolean;
};

type TranscriptChunk = {
    id: string;
    speaker: string;
    text: string;
    timestamp: string;
};

const formatDuration = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600)
        .toString()
        .padStart(2, "0");
    const mins = Math.floor((seconds % 3600) / 60)
        .toString()
        .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${hrs}:${mins}:${secs}`;
};

const LiveMeeting: FC = () => {
    const user = useAuthStore((state) => state.user);
    const token = useAuthStore((state) => state.token);
    const { id: meetingId } = useParams<{ id: string }>();
    const navigate = useNavigate();

    // Fetch meeting info for title and participants
    const { data: meetingData } = useQuery<{ title: string; participants: Participant[] }>({
        queryKey: ['meeting-live', meetingId],
        queryFn: async () => {
            const { data } = await apiClient.get(`/meetings/${meetingId}`);
            const m = data?.data?.meeting;
            return {
                title: m?.title || 'Meeting',
                participants: (m?.participants || []).map((p: any) => ({
                    id: p.user.id,
                    name: p.user.name || p.user.email,
                    isOnline: true,
                    isMuted: false,
                })),
            };
        },
        enabled: !!meetingId,
    });

    const meetingTitle = meetingData?.title || 'Live Meeting';

    const [isTranscriptEnabled, setIsTranscriptEnabled] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [isEndingMeeting, setIsEndingMeeting] = useState(false);
    const [meetingDuration, setMeetingDuration] = useState(0);
    const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">(
        "connecting"
    );
    const [participants, setParticipants] = useState<Participant[]>([
        { id: "p-self", name: user?.fullName ?? "You", isOnline: true, isMuted: false },
    ]);
    const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);

    const socketUrl = useMemo(() => {
        const envUrl = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SOCKET_URL;
        if (envUrl) {
            return envUrl;
        }
        return "http://localhost:4000";
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setMeetingDuration((previous) => previous + 1);
        }, 1000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        const socket: Socket = io(socketUrl, {
            transports: ["websocket", "polling"],
            auth: token ? { token } : undefined,
        });

        socket.on("connect", () => {
            setConnectionStatus("connected");
            socket.emit("join-room", meetingId);
        });

        socket.on("disconnect", () => {
            setConnectionStatus("disconnected");
        });

        socket.on("participants:update", (nextParticipants: Participant[]) => {
            setParticipants(nextParticipants);
        });

        socket.on("participant-joined", (participant: Participant) => {
            setParticipants((previous) => {
                const exists = previous.some((item) => item.id === participant.id);
                return exists ? previous : [...previous, participant];
            });
        });

        socket.on("participant-left", (participantId: string) => {
            setParticipants((previous) => previous.filter((item) => item.id !== participantId));
        });

        socket.on("transcript:update", (chunk: TranscriptChunk) => {
            setTranscript((previous) => [...previous.slice(-49), chunk]);
        });

        socket.on("transcript:chunk", (chunk: Omit<TranscriptChunk, "id">) => {
            setTranscript((previous) => [
                ...previous.slice(-49),
                { id: `t-${Date.now()}`, speaker: chunk.speaker, text: chunk.text, timestamp: chunk.timestamp },
            ]);
        });

        socket.on("connect_error", () => {
            setConnectionStatus("disconnected");
        });

        return () => {
            socket.emit("leave-room", meetingId);
            socket.disconnect();
        };
    }, [meetingId, socketUrl, token]);

    const handleToggleMute = () => {
        setIsMuted((previous) => !previous);
        setParticipants((previous) =>
            previous.map((participant) =>
                participant.name === (user?.fullName ?? "You") ? { ...participant, isMuted: !isMuted } : participant
            )
        );
    };

    // Populate participants from API data
    useEffect(() => {
        if (meetingData?.participants && meetingData.participants.length > 0) {
            setParticipants([
                { id: "p-self", name: user?.fullName ?? "You", isOnline: true, isMuted: false },
                ...meetingData.participants.filter((p) => p.name !== (user?.fullName ?? "You")),
            ]);
        }
    }, [meetingData, user?.fullName]);

    const handleEndMeeting = async () => {
        if (isEndingMeeting) {
            return;
        }

        try {
            setIsEndingMeeting(true);
            await apiClient.post(`/meetings/${meetingId}/end`, {
                triggerAiProcessing: true,
            });
            setTranscript((previous) => [
                ...previous,
                {
                    id: `t-${Date.now()}`,
                    speaker: "System",
                    text: "Meeting ended. AI is processing the recording — you'll be redirected to review tasks and minutes shortly.",
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
            // Navigate to meeting detail after a short delay
            setTimeout(() => {
                navigate(`/meetings/${meetingId}`);
            }, 2500);
        } catch {
            setTranscript((previous) => [
                ...previous,
                {
                    id: `t-${Date.now()}`,
                    speaker: "System",
                    text: "Could not end meeting from server. Please retry.",
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
        } finally {
            setIsEndingMeeting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">{meetingTitle}</h1>
                        <p className="text-sm text-slate-500">Hosted by {user?.fullName ?? "Guest"}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${connectionStatus === "connected"
                                ? "bg-emerald-100 text-emerald-700"
                                : connectionStatus === "connecting"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-red-100 text-red-700"
                                }`}
                        >
                            {connectionStatus}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            Duration {formatDuration(meetingDuration)}
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="space-y-6 xl:col-span-8">
                    <MeetingRecorder
                        meetingId={meetingId}
                        autoStart={true}
                        onUploadComplete={(recordedMeetingId) => {
                            setTimeout(() => navigate(`/meetings/${recordedMeetingId}/review`), 1500);
                        }}
                    />

                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-800">Meeting Controls</h2>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                onClick={handleToggleMute}
                                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${isMuted
                                    ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                    }`}
                            >
                                {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                                {isMuted ? "Unmute" : "Mute"}
                            </button>

                            <button
                                onClick={() => setIsTranscriptEnabled((previous) => !previous)}
                                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${isTranscriptEnabled
                                    ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                    }`}
                            >
                                <Captions size={16} />
                                {isTranscriptEnabled ? "Disable Transcript" : "Enable Transcript"}
                            </button>

                            <button
                                onClick={handleEndMeeting}
                                disabled={isEndingMeeting}
                                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <PhoneOff size={16} />
                                {isEndingMeeting ? "Ending..." : "End Meeting"}
                            </button>
                        </div>
                    </div>

                    {isTranscriptEnabled && (
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                            <h2 className="mb-4 text-lg font-bold text-slate-800">Live Transcript</h2>
                            <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
                                {transcript.length === 0 ? (
                                    <p className="text-sm text-slate-500">No transcript yet...</p>
                                ) : (
                                    transcript.map((item) => (
                                        <div key={item.id} className="rounded-md bg-white p-3">
                                            <div className="mb-1 flex items-center justify-between">
                                                <span className="text-xs font-semibold text-slate-700">{item.speaker}</span>
                                                <span className="text-[11px] text-slate-400">{item.timestamp}</span>
                                            </div>
                                            <p className="text-sm text-slate-700">{item.text}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <aside className="space-y-4 xl:col-span-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center gap-2">
                            <Users size={18} className="text-slate-700" />
                            <h2 className="text-lg font-bold text-slate-800">Participants</h2>
                        </div>

                        <div className="space-y-2">
                            {participants.map((participant) => (
                                <div
                                    key={participant.id}
                                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                                >
                                    <div>
                                        <p className="text-sm font-medium text-slate-800">{participant.name}</p>
                                        <p className="text-xs text-slate-500">
                                            {participant.isOnline === false ? "Offline" : "Online"}
                                        </p>
                                    </div>
                                    <span
                                        className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${participant.isMuted ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                                            }`}
                                    >
                                        {participant.isMuted ? "Muted" : "Active"}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default LiveMeeting;
