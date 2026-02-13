import { useReactMediaRecorder } from "react-media-recorder";
import { Mic, Square, Loader2, UploadCloud, Play, Pause } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import apiClient from "../../api/axios.config";

const MeetingRecorder = () => {
  const [isUploading, setIsUploading] = useState(false);

  const { status, startRecording, stopRecording, mediaBlobUrl } =
    useReactMediaRecorder({ audio: true });

  const handleUpload = async () => {
    if (!mediaBlobUrl) return;

    try {
      setIsUploading(true);
      
      // 1. Get the raw audio file from the browser's internal URL
      const audioBlob = await fetch(mediaBlobUrl).then((r) => r.blob());
      const file = new File([audioBlob], "meeting_recording.mp3", { type: "audio/mp3" });

      // 2. Create FormData to send to Backend
      const formData = new FormData();
      formData.append("file", file);

      // 3. Send to API (FastAPI backend)
      await apiClient.post("/meetings/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast.success("Meeting uploaded! AI processing started.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to upload meeting.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-800">🔴 Live Recorder</h2>
        <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${
          status === "recording" ? "bg-red-100 text-red-600 animate-pulse" : "bg-slate-100 text-slate-500"
        }`}>
          {status}
        </span>
      </div>
      
      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
        
        {/* Controls */}
        <div className="flex gap-4 mb-6">
          {status !== "recording" ? (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
            >
              <Mic size={20} /> Start Recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded-full font-semibold hover:bg-red-600 transition-all shadow-lg shadow-red-200"
            >
              <Square size={20} /> Stop Recording
            </button>
          )}
        </div>

        {/* Audio Player & Upload */}
        {mediaBlobUrl && status === "stopped" && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-4">
            <audio src={mediaBlobUrl} controls className="w-full mb-4 rounded-lg" />
            
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {isUploading ? <Loader2 className="animate-spin" /> : <UploadCloud size={18} />}
              {isUploading ? "Uploading..." : "Process with AI"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MeetingRecorder;