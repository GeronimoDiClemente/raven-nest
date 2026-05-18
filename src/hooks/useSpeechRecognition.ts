import React, { useRef, useState, useCallback } from 'react'

interface SpeechRecognitionHook {
  isListening: boolean
  isTranscribing: boolean
  isModelLoading: boolean
  interimTranscript: string
  start: () => void
  stop: () => void
  toggle: () => void
}

// Module-level mount counter. `window.speech.removeStatusListener()` clears ALL
// status listeners in the preload, so under StrictMode (double-mount) or HMR
// (overlapping mounts) the second mount's cleanup would otherwise nuke the
// listener the still-mounted instance depends on. Only run cleanup when no
// active mount remains.
let speechStatusMountCount = 0

function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const write = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  write(36, 'data'); view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return buf
}

export function useSpeechRecognition(onFinalTranscript: (text: string) => void, language = 'es'): SpeechRecognitionHook {
  const [isListening, setIsListening] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const languageRef = useRef(language)
  languageRef.current = language

  const statusCbRef = useRef<(status: 'loading' | 'ready') => void>(() => {})
  statusCbRef.current = (status) => setIsModelLoading(status === 'loading')

  React.useEffect(() => {
    speechStatusMountCount++
    // Indirect through the ref so the registered fn always points at the
    // current setState even after re-renders.
    window.speech?.onStatus?.((status) => statusCbRef.current(status))
    return () => {
      speechStatusMountCount--
      if (speechStatusMountCount <= 0) {
        speechStatusMountCount = 0
        window.speech?.removeStatusListener?.()
      }
    }
  }, [])

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      setIsListening(false)
    }
  }, [])

  const start = useCallback(async () => {
    if (mediaRecorderRef.current) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      console.warn('[voice] mic denied:', err)
      return
    }

    chunksRef.current = []
    const recorder = new MediaRecorder(stream)

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      mediaRecorderRef.current = null

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      chunksRef.current = []

      if (blob.size < 100) { setIsListening(false); return }

      setIsTranscribing(true)
      try {
        // Decode webm → WAV PCM (avoids ffmpeg dependency in whisper)
        const webmBuffer = await blob.arrayBuffer()
        const audioCtx = new AudioContext()
        const audioBuffer = await audioCtx.decodeAudioData(webmBuffer)
        audioCtx.close()
        const wavBuffer = encodeWAV(audioBuffer.getChannelData(0), audioBuffer.sampleRate)

        const text = await window.speech.transcribe(new Uint8Array(wavBuffer), languageRef.current)
        if (text) onFinalTranscript(text + ' ')
      } catch (err) {
        console.warn('[voice] failed:', err)
      }

      setIsTranscribing(false)
      setIsListening(false)
    }

    recorder.start(250)
    mediaRecorderRef.current = recorder
    setIsListening(true)
  }, [onFinalTranscript])

  const toggle = useCallback(() => {
    if (mediaRecorderRef.current) {
      stop()
    } else {
      void start()
    }
  }, [start, stop])

  return { isListening, isTranscribing, isModelLoading, interimTranscript: '', start, stop, toggle }
}
