'use client'

import { useEffect, useRef } from 'react'
import { useSnow } from '@/lib/snow-context'
import { useTheme } from '@/lib/theme-context'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  freqx: number
  freqy: number
  size: number
  phasex: number
  phasey: number
  rotation: number
  rotationSpeed: number
  hue: number
  shape: 'snow' | 'petal' | 'leaf'
}

export type SeasonMode = 'winter' | 'spring' | 'autumn'

export function getSeasonMode(date = new Date()): SeasonMode {
  const month = date.getMonth() // 0 = январь … 11 = декабрь
  // Зима: декабрь–февраль. Весна: март–май. Осень: июнь–ноябрь.
  // Летних месяцев (июнь–август) отдельного режима нет — летом не учатся,
  // поэтому лето сразу «предиктит» осень (осенний семестр).
  if (month === 11 || month <= 1) return 'winter'
  if (month >= 2 && month <= 4) return 'spring'
  return 'autumn'
}

export function SnowEffect() {
  const { snowEnabled } = useSnow()
  const { scheme } = useTheme()
  const seasonMode = getSeasonMode()
  const isBrightTheme = scheme === 'light'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const profileRef = useRef<{ particleCount: number; pixelRatio: number }>({ particleCount: 120, pixelRatio: 1 })
  const startTimeRef = useRef<number>(0)
  const runningRef = useRef<boolean>(false)
  const visibleRef = useRef<boolean>(true)
  const opacityRef = useRef<number>(0)
  const targetOpacityRef = useRef<number>(0)
  const frameRef = useRef<number>(0)
  const seasonRef = useRef<SeasonMode>('autumn')
  const brightThemeRef = useRef<boolean>(isBrightTheme)

  useEffect(() => {
    brightThemeRef.current = isBrightTheme
  }, [isBrightTheme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    seasonRef.current = seasonMode

    const nav = navigator as Navigator & {
      deviceMemory?: number
      hardwareConcurrency?: number
      connection?: { saveData?: boolean }
    }

    const computeProfile = () => {
      const width = window.innerWidth
      const saveData = nav.connection?.saveData === true
      const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4
      const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4
      const constrained = saveData || lowMemory || lowCpu
      const particleCount = constrained
        ? 70
        : width < 640
          ? 100
          : width < 1024
            ? 140
            : 220
      const pixelRatio = Math.min(window.devicePixelRatio || 1, constrained ? 1 : 1.5)
      profileRef.current = { particleCount, pixelRatio }
      return profileRef.current
    }

    const resetParticles = (count: number) => {
      particlesRef.current = []
      for (let i = 0; i < count; i++) {
        const season = seasonRef.current
        // Осенние листья падают чуть быстрее и активнее вращаются/качаются,
        // чем весенние лепестки; цвет — тёплый оранжево-янтарный (hue 25–48).
        const isWinter = season === 'winter'
        const isAutumn = season === 'autumn'
        particlesRef.current.push({
          x: Math.random(),
          y: Math.random(),
          vx: isWinter ? Math.random() - 0.5 : (Math.random() - 0.5) * (isAutumn ? 0.85 : 0.65),
          vy: isWinter ? (1 + Math.random() * 10) / 10 : (isAutumn ? 1.8 : 1.4 + Math.random() * 8) / 10 + (isAutumn ? Math.random() * 0.9 : 0),
          freqx: 1 + Math.random() * 5,
          freqy: 1 + Math.random() * 5,
          size: isWinter ? 0.1 + Math.random() * 1.4 : (isAutumn ? 1.4 : 1.2) + Math.random() * 2.2,
          phasex: Math.random() * 2 * Math.PI,
          phasey: Math.random() * 2 * Math.PI,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * (isWinter ? 0.01 : isAutumn ? 0.05 : 0.03),
          hue: isWinter ? 0 : isAutumn ? 25 + Math.random() * 23 : 330 + Math.random() * 35,
          shape: isWinter ? 'snow' : isAutumn ? 'leaf' : 'petal',
        })
      }
    }

    const resize = () => {
      const profile = computeProfile()
      canvas.width = Math.round(window.innerWidth * profile.pixelRatio)
      canvas.height = Math.round(window.innerHeight * profile.pixelRatio)
      resetParticles(profile.particleCount)
    }

    window.addEventListener('resize', resize)
    resize()

    const stopLoop = () => {
      runningRef.current = false
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }

    const startLoop = () => {
      if (runningRef.current || !visibleRef.current) return
      runningRef.current = true
      startTimeRef.current = performance.now()
      frameRef.current = requestAnimationFrame(render)
    }

    const render = () => {
      if (!runningRef.current || !visibleRef.current) return

      opacityRef.current += (targetOpacityRef.current - opacityRef.current) * 0.05

      if (opacityRef.current <= 0.01 && targetOpacityRef.current === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        stopLoop()
        return
      }

      const width = canvas.width
      const height = canvas.height
      const now = performance.now()

      // Time normalization (16ms = ~1 frame at 60fps)
      const delta = (now - startTimeRef.current) / 16

      ctx.globalAlpha = opacityRef.current
      ctx.clearRect(0, 0, width, height)

      for (const p of particlesRef.current) {
        const gx = p.x * width
        const gy = p.y * height

        const stepX = (2 * p.vx) / p.size / width
        const stepY = (2 * p.vy) / p.size / height

        const wobbleX = (width / 200) * Math.sin(p.freqx * now * stepY + p.phasex)
        const wobbleY = (height / 200) * Math.sin(p.freqy * now * stepX + p.phasey)
        const drawX = gx + wobbleX
        const drawY = gy + wobbleY

        if (p.shape === 'snow') {
          ctx.fillStyle = 'rgba(255,255,255,0.92)'
          ctx.beginPath()
          ctx.arc(
            drawX,
            drawY,
            p.size * profileRef.current.pixelRatio,
            0,
            2 * Math.PI
          )
          ctx.fill()
        } else if (p.shape === 'leaf') {
          // Осенний лист: вытянутая заострённая форма с центральной прожилкой.
          const size = p.size * profileRef.current.pixelRatio
          ctx.save()
          ctx.translate(drawX, drawY)
          ctx.rotate(p.rotation)
          ctx.fillStyle = brightThemeRef.current
            ? `hsla(${p.hue}, 78%, 48%, 0.9)`
            : `hsla(${p.hue}, 82%, 60%, 0.8)`
          ctx.beginPath()
          ctx.moveTo(0, -size * 1.15)
          ctx.bezierCurveTo(size * 0.72, -size * 0.5, size * 0.72, size * 0.6, 0, size * 1.1)
          ctx.bezierCurveTo(-size * 0.72, size * 0.6, -size * 0.72, -size * 0.5, 0, -size * 1.15)
          ctx.fill()
          // прожилка
          ctx.strokeStyle = brightThemeRef.current
            ? `hsla(${p.hue}, 60%, 32%, 0.55)`
            : `hsla(${p.hue}, 55%, 40%, 0.5)`
          ctx.lineWidth = Math.max(0.5, size * 0.12)
          ctx.beginPath()
          ctx.moveTo(0, -size * 1.05)
          ctx.lineTo(0, size)
          ctx.stroke()
          ctx.restore()
        } else {
          const size = p.size * profileRef.current.pixelRatio
          ctx.save()
          ctx.translate(drawX, drawY)
          ctx.rotate(p.rotation)
          ctx.fillStyle = brightThemeRef.current
            ? `hsla(${p.hue}, 72%, 66%, 0.92)`
            : `hsla(${p.hue}, 85%, 84%, 0.78)`
          ctx.beginPath()
          ctx.moveTo(0, -size * 0.9)
          ctx.bezierCurveTo(size * 0.8, -size * 0.6, size * 0.9, size * 0.35, 0, size)
          ctx.bezierCurveTo(-size * 0.95, size * 0.35, -size * 0.75, -size * 0.6, 0, -size * 0.9)
          ctx.fill()
          ctx.restore()
        }

        p.x += stepX * delta
        p.y += stepY * delta
        p.rotation += p.rotationSpeed * delta

        p.x = (p.x + 1) % 1
        p.y = (p.y + 1) % 1
      }

      startTimeRef.current = now
      frameRef.current = requestAnimationFrame(render)
    }

    const handleVisibilityChange = () => {
      visibleRef.current = document.visibilityState === 'visible'
      if (!visibleRef.current) {
        stopLoop()
        return
      }
      if (snowEnabled || opacityRef.current > 0.01) {
        startLoop()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    visibleRef.current = document.visibilityState === 'visible'

    if (snowEnabled) {
      targetOpacityRef.current = 1
      startLoop()
    } else {
      targetOpacityRef.current = 0
    }

    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopLoop()
    }
  }, [seasonMode, snowEnabled])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{
        opacity: (seasonMode === 'spring' || seasonMode === 'autumn') && isBrightTheme ? 0.82 : 0.5,
        mixBlendMode: seasonMode === 'winter' ? 'screen' : isBrightTheme ? 'normal' : 'lighten',
        zIndex: 9999,
      }}
    />
  )
}
