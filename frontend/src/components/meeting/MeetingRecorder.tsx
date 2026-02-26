import { Mic, Square, Loader2, Pause, Play, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import toast from "react-hot-toast";
import apiClient from "../../api/axios.config";

type RecorderStatus = "idle" | "recording" | "paused" | "stopped";

interface MeetingRecorderProps {
  /** If provided, recordings are attached to this meeting instead of creating a new one */
  meetingId?: string;
  /** If true, recording starts automatically on mount */
  autoStart?: boolean;
  /** Called when recording stops and upload finishes successfully */
  onUploadComplete?: (meetingId: string) => void;
}

const formatTime = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const MeetingRecorder: FC<MeetingRecorderProps> = ({ meetingId: propMeetingId, autoStart = false, onUploadComplete }) => {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Track the meetingId used for the current recording session
  const activeMeetingIdRef = useRef<string | null>(propMeetingId || null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  const statusLabel = useMemo(() => status.toUpperCase(), [status]);

  const clearTimer = () => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const stopWaveform = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;

    if (!canvas || !analyser) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      analyser.getByteTimeDomainData(dataArray);

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#f8fafc";
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.lineWidth = 2;
      context.strokeStyle = "#2563eb";
      context.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let index = 0; index < bufferLength; index += 1) {
        const value = dataArray[index] / 128.0;
        const y = (value * canvas.height) / 2;

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }

        x += sliceWidth;
      }

      context.lineTo(canvas.width, canvas.height / 2);
      context.stroke();

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();
  };

  const cleanupMedia = async () => {
    stopWaveform();
    clearTimer();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    mediaRecorderRef.current = null;
  };

  const uploadRecording = async (audioBlob: Blob) => {
    try {
      setIsUploading(true);
      setUploadProgress(0);

      // Step 1: Use the existing meetingId (from props) or create an ad-hoc one
      let resolvedMeetingId = activeMeetingIdRef.current;

      if (!resolvedMeetingId) {
        const now = new Date();
        const meetingRes = await apiClient.post("/meetings", {
          title: `Quick Recording – ${now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
          description: "Recording created from Live Recorder",
          scheduledStartTime: now.toISOString(),
        });
        const meetingData = meetingRes.data;
        resolvedMeetingId =
          meetingData?.data?.meeting?.id ?? meetingData?.meeting?.id ?? meetingData?.id;

        if (!resolvedMeetingId) {
          throw new Error("Failed to create meeting for recording");
        }
        activeMeetingIdRef.current = resolvedMeetingId;
      }

      setUploadProgress(10);

      // Step 2: Upload the recording
      const file = new File([audioBlob], `recording-${Date.now()}.webm`, { type: audioBlob.type });
      const formData = new FormData();
      formData.append("recording", file);

      await apiClient.post(`/meetings/${resolvedMeetingId}/recording`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          if (!event.total) return;
          const progress = 10 + Math.round((event.loaded * 80) / event.total);
          setUploadProgress(progress);
        },
      });

      setUploadProgress(95);

      // Step 3: Trigger AI processing (transcription → task extraction → MoM)
      try {
        await apiClient.post(`/meetings/${resolvedMeetingId}/process`);
      } catch {
        console.warn("[MeetingRecorder] /process call failed — AI processing may be delayed");
      }

      setUploadProgress(100);
      toast.success("Recording uploaded! AI is generating MoM and tasks…");
      onUploadComplete?.(resolvedMeetingId);
    } catch (error) {
      console.error(error);
      setErrorMessage("Upload failed. Please try recording again.");
      toast.error("Failed to upload meeting recording.");
    } finally {
      setIsUploading(false);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("Your browser does not support audio recording.");
      return;
    }

    setErrorMessage(null);
    setUploadProgress(0);

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      chunksRef.current = [];
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;

      const audioContext = new AudioContext();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const newAudioUrl = URL.createObjectURL(audioBlob);
        setAudioUrl(newAudioUrl);
        await uploadRecording(audioBlob);
        await cleanupMedia();
      };

      recorder.onerror = () => {
        setErrorMessage("Recording failed. Please retry.");
        toast.error("Recording error occurred.");
      };

      recorder.start(250);
      setElapsedSeconds(0);
      setStatus("recording");
      drawWaveform();

      clearTimer();
      timerIntervalRef.current = window.setInterval(() => {
        setElapsedSeconds((previous) => previous + 1);
      }, 1000);
    } catch (error) {
      console.error(error);
      setErrorMessage("Microphone permission denied or unavailable.");
      toast.error("Unable to access microphone.");
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current) {
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder.state === "inactive") {
      return;
    }

    recorder.stop();
    setStatus("stopped");
    clearTimer();
    stopWaveform();
  };

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }

    recorder.pause();
    setStatus("paused");
    clearTimer();
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "paused") {
      return;
    }

    recorder.resume();
    setStatus("recording");

    clearTimer();
    timerIntervalRef.current = window.setInterval(() => {
      setElapsedSeconds((previous) => previous + 1);
    }, 1000);
  };

  useEffect(() => {
    // Clear any stale error message when the component mounts
    setErrorMessage(null);
    // Auto-start recording if requested
    if (autoStart) {
      // Small delay to ensure the component is fully mounted
      const t = window.setTimeout(() => { void startRecording(); }, 300);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      void cleanupMedia();
    };
  }, [audioUrl]);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-800">🔴 Live Recorder</h2>
        <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${status === "recording"
          ? "bg-red-100 text-red-600 animate-pulse"
          : status === "paused"
            ? "bg-amber-100 text-amber-600"
            : "bg-slate-100 text-slate-500"
          }`}>
          {statusLabel}
        </span>
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
          <span>Timer</span>
          <span className="font-mono text-base font-semibold text-slate-900">{formatTime(elapsedSeconds)}</span>
        </div>
        <canvas ref={canvasRef} width={720} height={120} className="h-28 w-full rounded-md bg-slate-50" />
      </div>

      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">

        <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
          {(status === "idle" || status === "stopped") && (
            <button
              onClick={startRecording}
              disabled={isUploading}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
            >
              <Mic size={20} /> Start Recording
            </button>
          )}

          {(status === "recording" || status === "paused") && (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded-full font-semibold hover:bg-red-600 transition-all shadow-lg shadow-red-200"
            >
              <Square size={20} /> Stop Recording
            </button>
          )}

          {status === "recording" && (
            <button
              onClick={pauseRecording}
              className="flex items-center gap-2 rounded-full bg-amber-500 px-6 py-3 font-semibold text-white transition-all hover:bg-amber-600"
            >
              <Pause size={18} /> Pause
            </button>
          )}

          {status === "paused" && (
            <button
              onClick={resumeRecording}
              className="flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 font-semibold text-white transition-all hover:bg-emerald-700"
            >
              <Play size={18} /> Resume
            </button>
          )}
        </div>

        {audioUrl && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-4">
            <audio src={audioUrl} controls className="mb-4 w-full rounded-lg" />

            {isUploading && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Loader2 className="animate-spin" size={16} /> Uploading recording...
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-blue-600 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">{uploadProgress}%</p>
              </div>
            )}
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MeetingRecorder;