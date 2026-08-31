'use client'

import Image from 'next/image'
import { ChangeEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import { KidsLiveAudio, type KidsLivePhase } from './kids-audio'
import styles from './MakaronKids.module.css'

const SIDE_BARS = Array.from({ length: 18 }, (_, index) => index)
const BOTTOM_BARS = Array.from({ length: 30 }, (_, index) => index)
const VOICES = ['Kore', 'Aoede', 'Leda', 'Sulafat'] as const

type LiveSession = Awaited<ReturnType<InstanceType<typeof import('@google/genai').GoogleGenAI>['live']['connect']>>

interface SelectedPicture {
  url: string
  data: string
  mimeType: string
}

function MicIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <rect x="17" y="7" width="14" height="25" rx="7" fill="currentColor" />
      <path d="M11 24a13 13 0 0 0 26 0M24 37v7M17 44h14" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 15h8l3-5h10l3 5h8a4 4 0 0 1 4 4v19a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V19a4 4 0 0 1 4-4Z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
      <circle cx="24" cy="28" r="8" fill="none" stroke="currentColor" strokeWidth="3.5" />
    </svg>
  )
}

function ParentIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="18" cy="17" r="6" fill="currentColor" />
      <circle cx="33" cy="21" r="5" fill="currentColor" opacity=".72" />
      <path d="M7 39c1-8 5-12 11-12s10 4 11 12M26 39c.6-6 3-9 7-9 4.4 0 7 3 8 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function SparkMark() {
  return <Image src="/brand/makaron-spark-mark-192.webp" alt="" width={62} height={62} priority />
}

function readPicture(file: File): Promise<SelectedPicture> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve({ url: result, data: result.slice(comma + 1), mimeType: file.type || 'image/jpeg' })
    }
    reader.readAsDataURL(file)
  })
}

export default function MakaronKids() {
  const { t } = useLocale()
  const [phase, setPhase] = useState<KidsLivePhase>('idle')
  const [level, setLevel] = useState(0)
  const [parentOpen, setParentOpen] = useState(false)
  const [voice, setVoice] = useState<(typeof VOICES)[number]>('Kore')
  const [picture, setPicture] = useState<SelectedPicture | null>(null)
  const [inputTranscript, setInputTranscript] = useState('')
  const [outputTranscript, setOutputTranscript] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const sessionRef = useRef<LiveSession | null>(null)
  const audioRef = useRef<KidsLiveAudio | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const parentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopLive = useCallback(async () => {
    await audioRef.current?.stop()
    audioRef.current = null
    sessionRef.current?.close()
    sessionRef.current = null
    setPhase('idle')
    setLevel(0)
  }, [])

  useEffect(() => () => {
    void audioRef.current?.stop()
    sessionRef.current?.close()
  }, [])

  const startLive = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') {
      await stopLive()
      return
    }

    setPhase('connecting')
    setErrorMessage('')
    try {
      const tokenResponse = await fetch('/api/kids/live-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice }),
      })
      if (!tokenResponse.ok) throw new Error(`Token request failed (${tokenResponse.status})`)
      const tokenData = await tokenResponse.json() as { token: string; model: string }
      const { GoogleGenAI, Modality } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey: tokenData.token, httpOptions: { apiVersion: 'v1beta' } })
      const audio = new KidsLiveAudio({
        onLevel: setLevel,
        onPhase: setPhase,
        onMessage: (message) => {
          const input = message.serverContent?.inputTranscription?.text
          const output = message.serverContent?.outputTranscription?.text
          if (input) setInputTranscript((current) => `${current}${input}`.slice(-600))
          if (output) setOutputTranscript((current) => `${current}${output}`.slice(-600))
        },
      })
      audioRef.current = audio
      const session = await ai.live.connect({
        model: tokenData.model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => undefined,
          onmessage: (message) => audio.handleMessage(message),
          onerror: (event) => {
            console.error('[MakaronKids] Live session error:', event.message)
            setErrorMessage(event.message)
            setPhase('error')
          },
          onclose: () => {
            if (sessionRef.current) setPhase('idle')
          },
        },
      })
      sessionRef.current = session
      await audio.start(session)
      if (picture) audio.sendImage(picture.data, picture.mimeType)
    } catch (error) {
      console.error('[MakaronKids] Could not start live voice:', error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setPhase('error')
      await audioRef.current?.stop()
      audioRef.current = null
      sessionRef.current?.close()
      sessionRef.current = null
    }
  }, [phase, picture, stopLive, voice])

  const handlePicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const nextPicture = await readPicture(file)
    setPicture(nextPicture)
    audioRef.current?.sendImage(nextPicture.data, nextPicture.mimeType)
    event.target.value = ''
  }

  const beginParentHold = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    parentTimerRef.current = setTimeout(() => setParentOpen(true), 900)
  }

  const cancelParentHold = () => {
    if (parentTimerRef.current) clearTimeout(parentTimerRef.current)
    parentTimerRef.current = null
  }

  const phaseLabel = t(`kids.phase.${phase}` as Parameters<typeof t>[0])
  const active = phase === 'listening' || phase === 'speaking'
  const dynamicLevel = phase === 'speaking' ? 0.72 : level

  return (
    <main className={styles.stage} data-phase={phase} style={{ '--voice-level': dynamicLevel } as React.CSSProperties}>
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.spark}><SparkMark /></div>
      <button
        type="button"
        className={styles.parentGate}
        aria-label={t('kids.parent.hold')}
        onPointerDown={beginParentHold}
        onPointerUp={cancelParentHold}
        onPointerCancel={cancelParentHold}
        onPointerLeave={cancelParentHold}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setParentOpen(true)
        }}
      >
        <ParentIcon />
        <span className={styles.holdRing} aria-hidden="true" />
      </button>

      <section className={styles.pictureShell} aria-label={t('kids.picture')}>
        <div className={styles.picture}>
          {picture ? (
            // A user-selected blob/data URL cannot use the Next image optimizer.
            <img src={picture.url} alt={t('kids.selectedPicture')} className={styles.pictureImage} />
          ) : (
            <Image
              src="/kids/moon-garden.png"
              alt={t('kids.samplePicture')}
              fill
              priority
              sizes="(orientation: landscape) 88vw, 94vw"
              className={styles.pictureImage}
            />
          )}
          <div className={styles.pictureVignette} aria-hidden="true" />
        </div>
        <div className={`${styles.sideWave} ${styles.leftWave}`} aria-hidden="true">
          {SIDE_BARS.map((bar) => <i key={bar} style={{ '--bar': bar, '--rest': `${12 + (bar % 5) * 4}px` } as React.CSSProperties} />)}
        </div>
        <div className={`${styles.sideWave} ${styles.rightWave}`} aria-hidden="true">
          {SIDE_BARS.map((bar) => <i key={bar} style={{ '--bar': bar, '--rest': `${12 + (bar % 5) * 4}px` } as React.CSSProperties} />)}
        </div>
        <div className={styles.bottomWave} aria-hidden="true">
          {BOTTOM_BARS.map((bar) => <i key={bar} style={{ '--bar': bar, '--rest': `${12 + (bar % 7) * 3}px` } as React.CSSProperties} />)}
        </div>
      </section>

      <div className={styles.wizard} data-speaking={phase === 'speaking'} aria-hidden="true">
        <Image src="/kids/pixel-wizard-wave.png" alt="" fill priority sizes="28vw" />
      </div>

      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type="file"
        accept="image/*"
        onChange={handlePicture}
        aria-label={t('kids.choosePicture')}
      />
      <button
        type="button"
        className={styles.cameraButton}
        onClick={() => fileInputRef.current?.click()}
        aria-label={t('kids.choosePicture')}
      >
        <CameraIcon />
      </button>
      <button
        type="button"
        className={styles.micButton}
        onClick={() => void startLive()}
        aria-label={active ? t('kids.stopTalking') : t('kids.startTalking')}
        aria-pressed={active}
      >
        <span className={styles.micHalo} aria-hidden="true" />
        <MicIcon />
        {phase === 'connecting' ? <span className={styles.spinner} aria-hidden="true" /> : null}
      </button>

      <div className={styles.srStatus} role="status" aria-live="polite">{phaseLabel}</div>

      {parentOpen ? (
        <div className={styles.parentBackdrop} role="presentation" onPointerDown={() => setParentOpen(false)}>
          <section className={styles.parentPanel} role="dialog" aria-modal="true" aria-labelledby="kids-parent-title" onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h1 id="kids-parent-title">{t('kids.parent.title')}</h1>
                <p>{t('kids.parent.subtitle')}</p>
              </div>
              <button type="button" onClick={() => setParentOpen(false)} aria-label={t('kids.parent.close')}>×</button>
            </header>
            <div className={styles.parentRow}>
              <div>
                <strong>{t('kids.parent.connection')}</strong>
                <span>{phaseLabel}</span>
              </div>
              <span className={styles.statusDot} data-active={active} />
            </div>
            <fieldset>
              <legend>{t('kids.parent.voice')}</legend>
              <div className={styles.voiceGrid}>
                {VOICES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    data-selected={voice === option}
                    onClick={() => {
                      if (option !== voice) void stopLive()
                      setVoice(option)
                    }}
                  >
                    <span aria-hidden="true">{option === 'Kore' ? '●' : option === 'Aoede' ? '◆' : option === 'Leda' ? '■' : '▲'}</span>
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className={styles.transcript}>
              <strong>{t('kids.parent.lastHeard')}</strong>
              <p>{inputTranscript || t('kids.parent.empty')}</p>
              <strong>{t('kids.parent.lastReply')}</strong>
              <p>{outputTranscript || t('kids.parent.empty')}</p>
            </div>
            {errorMessage ? <p className={styles.error}>{t('kids.parent.error')}: {errorMessage}</p> : null}
            <p className={styles.operatorNote}>{t('kids.parent.operator')}</p>
          </section>
        </div>
      ) : null}
    </main>
  )
}
