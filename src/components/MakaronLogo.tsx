import type { CSSProperties } from 'react'

/* eslint-disable @next/next/no-img-element */

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
      src="/brand/makaron-spark-mark.png"
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

export default function MakaronLogo({ markSize = 48, textClassName, className, style }: LogoProps) {
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, ...style }}>
      <MakaronSpark size={markSize} />
      <div className={textClassName} style={{ fontWeight: 800, color: '#fff', lineHeight: 1 }}>
        Makaron
      </div>
    </div>
  )
}
