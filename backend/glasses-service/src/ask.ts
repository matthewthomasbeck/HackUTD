export interface AskResult { audioUrl: string; transcript: string; confidence?: number }
export type AskFetch = typeof fetch;

export async function processQuestionAudio(options: { wav: Uint8Array; rescuer: string; perceptionUrl: string; fetcher?: AskFetch }): Promise<AskResult> {
  const fetcher = options.fetcher ?? fetch;
  const wav = Buffer.from(options.wav);
  const mediaForm = new FormData();
  mediaForm.append('file', new Blob([wav], { type: 'audio/wav' }), 'question.wav');
  mediaForm.append('kind', 'voice');
  const media = await fetcher(`${options.perceptionUrl.replace(/\/$/, '')}/media`, { method: 'POST', body: mediaForm, signal: AbortSignal.timeout(10_000) });
  if (!media.ok) throw new Error(`Media upload failed (${media.status}).`);
  const mediaValue: unknown = await media.json();
  const audioUrl = mediaValue && typeof mediaValue === 'object' && typeof (mediaValue as { url?: unknown }).url === 'string' ? (mediaValue as { url: string }).url : '';
  if (!audioUrl) throw new Error('Media server returned no audio URL.');

  const transcriptionForm = new FormData();
  transcriptionForm.append('file', new Blob([wav], { type: 'audio/wav' }), 'question.wav');
  transcriptionForm.append('rescuer', options.rescuer);
  const transcription = await fetcher(`${options.perceptionUrl.replace(/\/$/, '')}/transcribe`, { method: 'POST', body: transcriptionForm, signal: AbortSignal.timeout(10_000) });
  if (!transcription.ok) throw new Error(`Transcription failed (${transcription.status}).`);
  const transcriptionValue: unknown = await transcription.json();
  if (!transcriptionValue || typeof transcriptionValue !== 'object' || typeof (transcriptionValue as { transcript?: unknown }).transcript !== 'string') throw new Error('Transcription response had no transcript.');
  const result = transcriptionValue as { transcript: string; confidence?: unknown };
  return { audioUrl, transcript: result.transcript.trim(), ...(typeof result.confidence === 'number' ? { confidence: result.confidence } : {}) };
}
