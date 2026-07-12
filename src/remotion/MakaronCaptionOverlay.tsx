import React from 'react';
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { MakaronWordCaption } from '@/lib/caption-cues';

export interface MakaronCaptionOverlayProps {
  words?: MakaronWordCaption[];
  wordsPerPage?: number;
  fontSize?: number;
  color?: string;
  highlightColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  bottom?: number;
  maxWidth?: string | number;
  joiner?: string | 'auto';
}

function separator(words: MakaronWordCaption[], joiner: string | 'auto'): string {
  if (joiner !== 'auto') return joiner;
  return words.some(item => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(item.word)) ? '' : ' ';
}

const CaptionPage: React.FC<Required<Omit<MakaronCaptionOverlayProps, 'words' | 'wordsPerPage'>> & {
  words: MakaronWordCaption[];
  pageStartMs: number;
}> = ({ words, pageStartMs, fontSize, color, highlightColor, backgroundColor, fontFamily, bottom, maxWidth, joiner }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = pageStartMs + frame / fps * 1000;
  const entrance = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const gap = separator(words, joiner);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: bottom, pointerEvents: 'none' }}>
      <div style={{
        opacity: entrance,
        transform: `translateY(${interpolate(entrance, [0, 1], [20, 0])}px)`,
        backgroundColor,
        borderRadius: 8,
        padding: '14px 28px',
        maxWidth,
        textAlign: 'center',
      }}>
        <span style={{ fontSize, fontWeight: 700, fontFamily, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
          {words.map((item, index) => {
            const active = item.startMs <= currentMs && item.endMs > currentMs;
            const past = item.endMs <= currentMs;
            return (
              <React.Fragment key={`${item.startMs}-${index}`}>
                <span style={{
                  color: active ? highlightColor : past ? color : `${color}99`,
                  textShadow: active ? `0 0 20px ${highlightColor}66, 0 2px 4px rgba(0,0,0,.5)` : '0 2px 4px rgba(0,0,0,.5)',
                }}>{item.word}</span>
                {index < words.length - 1 ? gap : ''}
              </React.Fragment>
            );
          })}
        </span>
      </div>
    </AbsoluteFill>
  );
};

export const MakaronCaptionOverlay: React.FC<MakaronCaptionOverlayProps> = ({
  words = [],
  wordsPerPage = 7,
  fontSize = 42,
  color = '#F8FAFC',
  highlightColor = '#C4A7FF',
  backgroundColor = 'rgba(10, 10, 14, 0.76)',
  fontFamily = 'Inter, system-ui, sans-serif',
  bottom = 80,
  maxWidth = '82%',
  joiner = 'auto',
}) => {
  const { fps } = useVideoConfig();
  const pages = [] as MakaronWordCaption[][];
  for (let index = 0; index < words.length; index += wordsPerPage) pages.push(words.slice(index, index + wordsPerPage));

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const startMs = page[0]?.startMs ?? 0;
        const endMs = pages[index + 1]?.[0]?.startMs ?? (page[page.length - 1]?.endMs ?? startMs) + 500;
        return (
          <Sequence key={`${startMs}-${index}`} from={Math.round(startMs / 1000 * fps)} durationInFrames={Math.max(1, Math.round((endMs - startMs) / 1000 * fps))}>
            <CaptionPage
              words={page}
              pageStartMs={startMs}
              fontSize={fontSize}
              color={color}
              highlightColor={highlightColor}
              backgroundColor={backgroundColor}
              fontFamily={fontFamily}
              bottom={bottom}
              maxWidth={maxWidth}
              joiner={joiner}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
