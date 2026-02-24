import { AssemblyAI } from 'assemblyai';

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY!
});

export const transcribeAudio = async (audioUrl: string) => {
  try {
    // Upload and transcribe
    const transcript = await client.transcripts.transcribe({
      audio: audioUrl,
      speaker_labels: true, // FREE speaker diarization!
      language_code: 'en'
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