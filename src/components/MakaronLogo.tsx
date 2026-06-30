import type { CSSProperties } from 'react'



type SparkProps = {
  size?: number | string
  className?: string
  style?: CSSProperties
  title?: string
}

export function MakaronSpark({
  size = 32,
  className,
  style,
  title = 'Makaron Spark',
}: SparkProps) {
  return (
    <img
      src="/brand/makaron-spark-mark-192.webp"
      srcSet="/brand/makaron-spark-mark-192.webp 192w, /brand/makaron-spark-mark-256.webp 256w"
      sizes="64px"
      alt={title}
      className={className}
      style={{
        display: 'block',
        width: size,
        height: size,
        objectFit: 'contain',
        mixBlendMode: 'screen',
        ...style,
      }}
    />
  )
}

type LogoProps = {
  markSize?: number | string
  textClassName?: string
  className?: string
  style?: CSSProperties
}

export const MAKARON_WORDMARK_STYLE: CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
  fontWeight: 600,
  letterSpacing: '0.005em',
  color: '#fff',
  lineHeight: 1,
}

export default function MakaronLogo({ markSize = 48, textClassName, className, style }: LogoProps) {
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, ...style }}>
      <MakaronSpark size={markSize} />
      <div className={textClassName} style={MAKARON_WORDMARK_STYLE}>
        Makaron
      </div>
    </div>
  )
}
