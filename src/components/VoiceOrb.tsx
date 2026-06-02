import React from 'react'

interface VoiceOrbProps {
  isListening: boolean
  interimTranscript: string
  onClick: () => void
}

export default function VoiceOrb({ isListening, interimTranscript, onClick }: VoiceOrbProps) {
  const size = isListening ? '56px' : '36px'

  return (
    <div style={{
      position: 'fixed',
      bottom: '80px',
      right: '24px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'auto',
    }}>
      <div
        onClick={onClick}
        title={isListening ? 'Click to stop' : 'Click to speak'}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 35%, #a78bfa, #7c3aed)',
          opacity: isListening ? 1 : 0.4,
          animation: isListening ? 'voice-orb-pulse 1.4s ease-in-out infinite' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'width 0.2s, height 0.2s, opacity 0.2s',
        }}
      >
        <svg
          width={isListening ? '24' : '16'}
          height={isListening ? '24' : '16'}
          viewBox="0 0 24 24"
          fill="white"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
        </svg>
      </div>
      {isListening && interimTranscript && (
        <div style={{
          maxWidth: '200px',
          background: 'rgba(0,0,0,0.75)',
          color: '#e2e8f0',
          fontSize: '12px',
          padding: '4px 8px',
          borderRadius: '6px',
          textAlign: 'center',
          backdropFilter: 'blur(4px)',
          wordBreak: 'break-word',
        }}>
          {interimTranscript}
        </div>
      )}
    </div>
  )
}
