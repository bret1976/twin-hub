import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Phase = "idle" | "listening" | "transcribing";

interface Capture {
  stream: MediaStream;
  audio: AudioContext;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  timer: number;
  discard: boolean;
  ending: boolean;
  heard: boolean;
  lastVoice: number;
  started: number;
  stop: () => void;
}

function mergeSamples(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j] ?? 0;
      count += 1;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

/**
 * Records the microphone as WAV. Compressed browser recordings were being
 * heard as a different sentence than the one the person said.
 */
export function MicButton({
  disabled,
  value,
  onChange,
  onFinal,
}: {
  disabled?: boolean;
  value: string;
  onChange: (text: string) => void;
  onFinal: (text: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [hint, setHint] = useState<string | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const captureRef = useRef<Capture | null>(null);
  const armingRef = useRef(false);
  const cancelRef = useRef(false);
  const startedAt = useRef(0);
  const baseRef = useRef("");
  const valueRef = useRef(value);
  const committedRef = useRef(false);
  valueRef.current = value;

  function setMicPhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  useEffect(() => {
    return () => {
      const capture = captureRef.current;
      if (!capture) return;
      capture.discard = true;
      capture.stop();
    };
  }, []);

  function release(capture: Capture) {
    window.clearInterval(capture.timer);
    capture.processor.onaudioprocess = null;
    capture.processor.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.audio.close().catch(() => undefined);
    if (captureRef.current === capture) captureRef.current = null;
  }

  async function transcribe(blob: Blob) {
    if (blob.size < 1200) {
      setMicPhase("idle");
      setHint("Didn't catch that. Tap the mic and speak again.");
      return;
    }
    try {
      const text = (await api.transcribe(await blobToBase64(blob), "audio/wav")).text.trim();
      const missed = !text || (/^(no|nope|none)\.?$/i.test(text) && blob.size > 12_000);
      if (missed || committedRef.current) {
        setMicPhase("idle");
        setHint(missed ? "I missed what you said. Tap the mic and speak again." : null);
        return;
      }
      committedRef.current = true;
      const next = `${baseRef.current}${text}`.trim();
      onChange(next);
      setMicPhase("idle");
      setHint(null);
      onFinal(next);
    } catch (err) {
      setMicPhase("idle");
      setHint(err instanceof Error ? err.message : "Could not transcribe that.");
    }
  }

  function endRecording() {
    const capture = captureRef.current;
    if (!capture || capture.ending) return;
    capture.ending = true;
    window.clearInterval(capture.timer);
    const discard = capture.discard;
    const rate = capture.audio.sampleRate || 48000;
    const wav = encodeWav(downsample(mergeSamples(capture.chunks), rate, 16000), 16000);
    release(capture);
    if (discard) {
      setMicPhase("idle");
      return;
    }
    setMicPhase("transcribing");
    setHint("Turning that into text…");
    void transcribe(wav);
  }

  async function begin() {
    if (!window.isSecureContext) {
      setHint("Open http://127.0.0.1:45454 so the browser allows the mic.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setHint("This browser can't use the microphone.");
      return;
    }

    setHint("Listening… allow the mic if your browser asks.");
    setMicPhase("listening");
    committedRef.current = false;
    cancelRef.current = false;
    startedAt.current = performance.now();
    baseRef.current = valueRef.current.trim() ? `${valueRef.current.trim()} ` : "";

    let audio: AudioContext;
    try {
      audio = new AudioContext();
      void audio.resume();
    } catch {
      setMicPhase("idle");
      setHint("Couldn't open the microphone.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      void audio.close().catch(() => undefined);
      const name = err instanceof DOMException ? err.name : "";
      setMicPhase("idle");
      setHint(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Allow the microphone in the browser prompt, then tap again."
          : name === "NotFoundError"
            ? "No microphone was found."
            : "Couldn't open the microphone.",
      );
      return;
    }
    if (cancelRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      void audio.close().catch(() => undefined);
      return;
    }

    await audio.resume().catch(() => undefined);
    let processor: ScriptProcessorNode;
    try {
      processor = audio.createScriptProcessor(4096, 1, 1);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      void audio.close().catch(() => undefined);
      setMicPhase("idle");
      setHint("Couldn't start the recording.");
      return;
    }

    const now = performance.now();
    const capture: Capture = {
      stream,
      audio,
      processor,
      chunks: [],
      timer: 0,
      discard: false,
      ending: false,
      heard: false,
      lastVoice: now,
      started: now,
      stop: () => undefined,
    };
    capture.stop = () => endRecording();
    captureRef.current = capture;

    processor.onaudioprocess = (event) => {
      if (capture.ending) return;
      const input = event.inputBuffer.getChannelData(0);
      capture.chunks.push(new Float32Array(input));
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += (input[i] ?? 0) ** 2;
      const rms = Math.sqrt(sum / input.length);
      if (rms > 0.012) {
        capture.heard = true;
        capture.lastVoice = performance.now();
      }
    };

    const source = audio.createMediaStreamSource(stream);
    const mute = audio.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(audio.destination);

    capture.timer = window.setInterval(() => {
      if (capture.ending) return;
      const clock = performance.now();
      if (capture.heard && clock - capture.lastVoice > 7000) endRecording();
      else if (clock - capture.started > 90_000) endRecording();
    }, 200);

    setHint("Listening… say everything, then tap the mic to send.");
  }

  function toggle() {
    if (disabled || phaseRef.current === "transcribing") return;
    if (phaseRef.current === "listening") {
      if (captureRef.current) endRecording();
      else if (performance.now() - startedAt.current > 700) {
        cancelRef.current = true;
        setMicPhase("idle");
        setHint(null);
      }
      return;
    }
    if (armingRef.current) return;
    armingRef.current = true;
    void begin().finally(() => {
      armingRef.current = false;
    });
  }

  const listening = phase === "listening";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || phase === "transcribing"}
        aria-pressed={listening}
        data-mic={phase}
        aria-label={listening ? "Stop and send speech" : "Speak with microphone"}
        onClick={toggle}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
          listening
            ? "animate-pulse border-teal bg-teal text-ink"
            : "border-teal/50 bg-ink text-teal hover:border-teal"
        }`}
      >
        {listening ? <Square className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
      </button>
      {hint && (
        <span className={`max-w-[16rem] text-left text-xs ${phase === "idle" ? "text-coral" : "text-teal"}`}>
          {hint}
        </span>
      )}
    </div>
  );
}
