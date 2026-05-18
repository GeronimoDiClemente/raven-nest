import { exec, spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir, platform } from 'os'

const IS_WIN = platform() === 'win32'

// Persistent Python process — model loaded once, stays in memory
let whisperProc: ChildProcessWithoutNullStreams | null = null
let whisperReady = false
let pendingResolve: ((text: string) => void) | null = null
let pendingReject: ((err: Error) => void) | null = null
let stdoutBuf = ''
let statusCallback: ((status: 'loading' | 'ready') => void) | null = null

export function setWhisperStatusCallback(cb: (status: 'loading' | 'ready') => void): void {
  statusCallback = cb
}

const WHISPER_SERVER = `
import sys, json, warnings, wave, os
import numpy as np
warnings.filterwarnings('ignore')
import whisper

model = whisper.load_model('base')
sys.stdout.write('ready\\n')
sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        wav_path = req['path']
        language = req.get('language', 'es')
        with wave.open(wav_path, 'rb') as wf:
            sr = wf.getframerate()
            ch = wf.getnchannels()
            frames = wf.readframes(wf.getnframes())
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        if ch > 1:
            audio = audio.reshape(-1, ch).mean(axis=1)
        if sr != 16000:
            n = int(len(audio) * 16000 / sr)
            audio = np.interp(np.linspace(0, len(audio), n), np.arange(len(audio)), audio).astype(np.float32)
        result = model.transcribe(audio, language=language, task='transcribe', fp16=False)
        sys.stdout.write(json.dumps({'text': result['text'].strip()}) + '\\n')
    except Exception as e:
        sys.stdout.write(json.dumps({'error': str(e)}) + '\\n')
    finally:
        sys.stdout.flush()
        try:
            os.unlink(req['path'])
        except:
            pass
`

async function findPython(): Promise<string | null> {
  const candidates = IS_WIN ? ['python', 'python3'] : ['python3', 'python']
  for (const py of candidates) {
    const found = await new Promise<boolean>((resolve) => {
      const proc = exec(`${py} -c "import whisper"`, { timeout: 5000 }, (err) => resolve(!err))
      proc.on('error', () => resolve(false))
    })
    if (found) return py
  }
  return null
}

function startWhisperProcess(pythonCmd: string) {
  whisperProc = spawn(pythonCmd, ['-u', '-c', WHISPER_SERVER])
  stdoutBuf = ''
  statusCallback?.('loading')

  whisperProc.stdout.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString()
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      if (trimmed === 'ready') {
        whisperReady = true
        statusCallback?.('ready')
        continue
      }

      try {
        const msg = JSON.parse(trimmed)
        if (pendingResolve && pendingReject) {
          const resolve = pendingResolve
          const reject = pendingReject
          pendingResolve = null
          pendingReject = null
          if (msg.error) reject(new Error(msg.error))
          else resolve(msg.text ?? '')
        }
      } catch {}
    }
  })

  whisperProc.on('close', () => {
    whisperProc = null
    whisperReady = false
    stdoutBuf = ''
    if (pendingReject) {
      pendingReject(new Error('whisper process exited unexpectedly'))
      pendingResolve = null
      pendingReject = null
    }
  })

  whisperProc.on('error', (err: Error) => {
    whisperProc = null
    whisperReady = false
    stdoutBuf = ''
    if (pendingReject) {
      pendingReject(err)
      pendingResolve = null
      pendingReject = null
    }
  })
}

export function initWhisper(): void {
  findPython().then(py => { if (py) startWhisperProcess(py) }).catch(() => {})
}

export async function checkWhisperAvailable(): Promise<boolean> {
  return (await findPython()) !== null
}

export function transcribeAudio(audioBuffer: Buffer, language = 'es'): Promise<string> {
  return new Promise((resolve, reject) => {
    const TRANSCRIBE_TIMEOUT_MS = 60_000
    let transcribeTimer: NodeJS.Timeout | null = null

    const clearTranscribeTimer = () => {
      if (transcribeTimer) {
        clearTimeout(transcribeTimer)
        transcribeTimer = null
      }
    }

    const sendRequest = () => {
      if (!whisperProc) return reject(new Error('whisper process died'))
      if (pendingResolve) return reject(new Error('whisper busy'))
      const inputPath = join(tmpdir(), `nest-voice-${Date.now()}.wav`)
      try { writeFileSync(inputPath, audioBuffer) } catch (err) { return reject(err as Error) }
      pendingResolve = (text: string) => { clearTranscribeTimer(); resolve(text) }
      pendingReject = (err: Error) => { clearTranscribeTimer(); try { unlinkSync(inputPath) } catch {} reject(err) }
      whisperProc.stdin.write(JSON.stringify({ path: inputPath, language }) + '\n')
      transcribeTimer = setTimeout(() => {
        transcribeTimer = null
        const reject2 = pendingReject
        pendingResolve = null
        pendingReject = null
        stdoutBuf = ''
        if (whisperProc) {
          try { whisperProc.kill('SIGKILL') } catch {}
          whisperProc = null
        }
        whisperReady = false
        if (reject2) reject2(new Error('whisper transcription timed out after 60s'))
        else reject(new Error('whisper transcription timed out after 60s'))
      }, TRANSCRIBE_TIMEOUT_MS)
    }

    const READY_TIMEOUT_MS = 30_000
    const readyDeadline = Date.now() + READY_TIMEOUT_MS
    const waitForReady = () => {
      if (whisperReady) { sendRequest() }
      else if (Date.now() >= readyDeadline) { reject(new Error('whisper process did not start in time (30s timeout)')) }
      else { setTimeout(waitForReady, 500) }
    }

    if (!whisperProc) {
      findPython().then(py => {
        if (!py) return reject(new Error('whisper not found. Install with: pip install openai-whisper'))
        startWhisperProcess(py)
        waitForReady()
      }).catch(err => reject(err))
      return
    }

    waitForReady()
  })
}

export function shutdownWhisper(): void {
  if (whisperProc) {
    whisperProc.kill()
    whisperProc = null
    whisperReady = false
  }
}
