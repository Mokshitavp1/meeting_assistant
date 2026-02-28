import { AssemblyAI } from 'assemblyai';

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY!
});

export const transcribeAudio = async (audioUrl: string) => {
  try {
    let audioInput: string = audioUrl;

    if (audioUrl.startsWith('http://localhost') || audioUrl.startsWith('http://127.0.0.1')) {
      try {
        const parsed = new URL(audioUrl);
        const pathname = decodeURIComponent(parsed.pathname || '');
        if (pathname.startsWith('/uploads/')) {
          audioInput = `.${pathname}`;
        }
      } catch {
        // Keep original audio input when URL parsing fails.
      }
    }

    // Upload and transcribe
    const transcript = await client.transcripts.transcribe({
      audio: audioInput,
      speaker_labels: true, // FREE speaker diarization!
      language_code: 'en',
      speech_models: ['universal-2']
    });

    if (transcript.status === 'error') {
      throw new Error(transcript.error);
    }

    // Format with speaker labels
    const formattedTranscript = transcript.utterances?.map(utterance => ({
      speaker: `Speaker ${utterance.speaker}`,
      text: utterance.text,
      start: utterance.start,
      end: utterance.end
    })) || [];

    return {
      fullTranscript: transcript.text,
      utterances: formattedTranscript,
      duration: transcript.audio_duration
    };

  } catch (error) {
    console.error('AssemblyAI Error:', error);
    throw new Error('Transcription failed');
  }
};