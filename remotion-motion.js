// Remotion & Hyperframes 모션그래픽 씬 생성기
// 순수 Canvas/SVG 및 FFmpeg 고속 파이프라인으로 번들러 없이 1080p/4K 30fps 모션그래픽 비디오 세그먼트를 합성한다.
const fs = require('fs');
const path = require('path');

// 6대 핵심 리모션 모션 프리셋 목록
const REMOTION_PRESETS = {
  'kenburns': { name: '기본 줌인 (Ken Burns)', icon: '🔍' },
  'remotion-starburst': { name: '스타버스트 광선 (Starburst #04)', icon: '✨' },
  'remotion-chart': { name: '데이터 차트 모션 (Bar Chart)', icon: '📊' },
  'remotion-compare': { name: '전/후 스펙 비교표 (Before vs After)', icon: '⚔️' },
  'remotion-rough': { name: '손그림 형광펜 판서 (Rough-Notation #12)', icon: '🖍️' },
  'remotion-code': { name: '맥OS 터미널 & 커서 (Mac Cursor #19)', icon: '💻' },
  'remotion-pip': { name: '다크 인포그래픽 + 원형 PIP (Mode B)', icon: '🎬' },
};

// SVG 기반 1080p 고화질 모션 그래픽 베이스 플레이트 생성
function renderMotionPlateSvg({motion, title, keyword, chartData, VW, VH, font = 'Do Hyeon'}) {
  const primary = '#F5C518'; // 시그니처 옐로우/골드
  const cyan = '#5BC8FF';
  const bgDark = '#0E1118';
  const cardBg = '#171B24';

  if (motion === 'remotion-chart') {
    // 3개 막대 데이터 차트 (기본: 30%, 65%, 100%)
    const rawVals = (chartData || '30, 65, 100').split(',').map((v) => Math.min(100, Math.max(10, parseFloat(v.trim()) || 50)));
    const vals = [rawVals[0] || 30, rawVals[1] || 65, rawVals[2] || 100];
    const labels = ['기존 방식', '타사 툴', '2GOSOO 스튜디오'];
    const colors = ['#64748B', '#38BDF8', primary];
    const barsW = Math.round(VW * 0.75);
    const startX = Math.round((VW - barsW) / 2);
    const maxBarH = Math.round(VH * 0.38);
    const baseY = Math.round(VH * 0.68);

    const barsSvg = vals.map((v, i) => {
      const h = Math.round((v / 100) * maxBarH);
      const x = startX + i * Math.round(barsW / 3) + 24;
      const w = Math.round(barsW / 3) - 48;
      const y = baseY - h;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${colors[i]}" opacity="0.9" />
          <text x="${x + w / 2}" y="${y - 16}" fill="${colors[i]}" font-family="${font}" font-size="38" font-weight="900" text-anchor="middle">${v}%</text>
          <text x="${x + w / 2}" y="${baseY + 44}" fill="#E2E8F0" font-family="${font}" font-size="30" font-weight="700" text-anchor="middle">${labels[i]}</text>
        </g>
      `;
    }).join('');

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">
        <rect width="${VW}" height="${VH}" fill="${bgDark}" />
        <circle cx="${VW * 0.5}" cy="${VH * 0.45}" r="${VW * 0.4}" fill="radial-gradient(circle, #1E293B 0%, transparent 70%)" opacity="0.4" />
        <text x="${VW / 2}" y="${Math.round(VH * 0.18)}" fill="#94A3B8" font-family="${font}" font-size="26" font-weight="800" text-anchor="middle" letter-spacing="4">REMOTION PERFORMANCE BENCHMARK</text>
        <text x="${VW / 2}" y="${Math.round(VH * 0.24)}" fill="#FFFFFF" font-family="${font}" font-size="52" font-weight="900" text-anchor="middle">${keyword || '압도적인 성능 격차'}</text>
        ${barsSvg}
      </svg>
    `;
  }

  if (motion === 'remotion-compare') {
    // Before vs After 2열 스펙 비교표
    const colW = Math.round(VW * 0.42);
    const colH = Math.round(VH * 0.52);
    const y = Math.round(VH * 0.32);
    const x1 = Math.round(VW * 0.06);
    const x2 = Math.round(VW * 0.52);

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">
        <rect width="${VW}" height="${VH}" fill="${bgDark}" />
        <text x="${VW / 2}" y="${Math.round(VH * 0.16)}" fill="#94A3B8" font-family="${font}" font-size="28" font-weight="800" text-anchor="middle" letter-spacing="4">FEATURE COMPARISON</text>
        <text x="${VW / 2}" y="${Math.round(VH * 0.23)}" fill="#FFFFFF" font-family="${font}" font-size="52" font-weight="900" text-anchor="middle">${keyword || '단 1초 만에 확인하는 차이'}</text>

        <!-- Before Card -->
        <rect x="${x1}" y="${y}" width="${colW}" height="${colH}" rx="20" fill="${cardBg}" stroke="#334155" stroke-width="2" />
        <rect x="${x1 + 24}" y="${y + 24}" width="100" height="34" rx="6" fill="#475569" />
        <text x="${x1 + 74}" y="${y + 48}" fill="#FFFFFF" font-family="${font}" font-size="20" font-weight="800" text-anchor="middle">BEFORE</text>
        <text x="${x1 + 32}" y="${y + 115}" fill="#F87171" font-family="${font}" font-size="34" font-weight="900">✕ 무거운 클라우드</text>
        <text x="${x1 + 32}" y="${y + 180}" fill="#94A3B8" font-family="${font}" font-size="26" font-weight="600">· 영상 1개 올리는데 20분</text>
        <text x="${x1 + 32}" y="${y + 235}" fill="#94A3B8" font-family="${font}" font-size="26" font-weight="600">· 매달 결제되는 구독 요금</text>
        <text x="${x1 + 32}" y="${y + 290}" fill="#94A3B8" font-family="${font}" font-size="26" font-weight="600">· 인터넷 끊기면 작업 중단</text>

        <!-- After Card -->
        <rect x="${x2}" y="${y}" width="${colW}" height="${colH}" rx="20" fill="#141E2E" stroke="${primary}" stroke-width="3" />
        <rect x="${x2 + 24}" y="${y + 24}" width="90" height="34" rx="6" fill="${primary}" />
        <text x="${x2 + 69}" y="${y + 48}" fill="#0A0F1D" font-family="${font}" font-size="20" font-weight="900" text-anchor="middle">AFTER</text>
        <text x="${x2 + 32}" y="${y + 115}" fill="${primary}" font-family="${font}" font-size="34" font-weight="900">✔ 100% 로컬 스튜디오</text>
        <text x="${x2 + 32}" y="${y + 180}" fill="#E2E8F0" font-family="${font}" font-size="26" font-weight="700">· 0.1초 즉시 파일 연결</text>
        <text x="${x2 + 32}" y="${y + 235}" fill="#E2E8F0" font-family="${font}" font-size="26" font-weight="700">· 평생 무료 + 위스퍼 내장</text>
        <text x="${x2 + 32}" y="${y + 290}" fill="#E2E8F0" font-family="${font}" font-size="26" font-weight="700">· 오프라인에서도 무제한 제작</text>
      </svg>
    `;
  }

  if (motion === 'remotion-code') {
    // 맥OS 터미널 창 + 코드 타이핑
    const winW = Math.round(VW * 0.82);
    const winH = Math.round(VH * 0.54);
    const wx = Math.round((VW - winW) / 2);
    const wy = Math.round(VH * 0.28);

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">
        <rect width="${VW}" height="${VH}" fill="${bgDark}" />
        <text x="${VW / 2}" y="${Math.round(VH * 0.17)}" fill="${cyan}" font-family="${font}" font-size="44" font-weight="900" text-anchor="middle">@remotion/mac-cursors #19</text>

        <!-- macOS Window -->
        <rect x="${wx}" y="${wy}" width="${winW}" height="${winH}" rx="16" fill="#0B0F19" stroke="#334155" stroke-width="2" />
        <circle cx="${wx + 26}" cy="${wy + 24}" r="7" fill="#EF4444" />
        <circle cx="${wx + 48}" cy="${wy + 24}" r="7" fill="#F59E0B" />
        <circle cx="${wx + 70}" cy="${wy + 24}" r="7" fill="#10B981" />
        <text x="${wx + winW / 2}" y="${wy + 30}" fill="#64748B" font-family="monospace" font-size="16" font-weight="700" text-anchor="middle">terminal ~ 2gosoo-vibe-studio</text>

        <!-- Code Lines -->
        <text x="${wx + 34}" y="${wy + 85}" fill="#38BDF8" font-family="monospace" font-size="24" font-weight="700">$ npm run render -- --scene=hero --fps=30</text>
        <text x="${wx + 34}" y="${wy + 135}" fill="#94A3B8" font-family="monospace" font-size="22">✔ whisper.cpp: 음성 단어 타임스탬프 0.2초 추출</text>
        <text x="${wx + 34}" y="${wy + 185}" fill="#94A3B8" font-family="monospace" font-size="22">✔ remotion-engine: 44종 모션그래픽 60fps 결합</text>
        <text x="${wx + 34}" y="${wy + 235}" fill="#94A3B8" font-family="monospace" font-size="22">✔ @remotion/sfx: whoosh &amp; ding 사운드 자동 믹스</text>
        <text x="${wx + 34}" y="${wy + 295}" fill="${primary}" font-family="monospace" font-size="26" font-weight="800">🚀 100% 무결점 데스크탑 MP4 사출 성공!</text>
      </svg>
    `;
  }

  if (motion === 'remotion-rough') {
    // 판서 형광펜 스타일
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">
        <rect width="${VW}" height="${VH}" fill="#0A1124" />
        <text x="${VW / 2}" y="${Math.round(VH * 0.22)}" fill="#94A3B8" font-family="${font}" font-size="28" font-weight="800" text-anchor="middle" letter-spacing="3">@REMOTION/ROUGH-NOTATION #12</text>
        <text x="${VW / 2}" y="${Math.round(VH * 0.38)}" fill="#FFFFFF" font-family="${font}" font-size="64" font-weight="900" text-anchor="middle">
          핵심은 <tspan fill="${primary}">단 1초</tspan> 만에 시선을 잡는 것
        </text>

        <!-- 형광펜 밑줄 효과 -->
        <path d="M ${VW * 0.2} ${VH * 0.44} Q ${VW * 0.5} ${VH * 0.46} ${VW * 0.8} ${VH * 0.43}" fill="none" stroke="${primary}" stroke-width="12" stroke-linecap="round" opacity="0.85" />

        <!-- 손그림 원형 강조 -->
        <ellipse cx="${VW * 0.5}" cy="${VH * 0.65}" rx="320" ry="85" fill="none" stroke="#7CF3C8" stroke-width="6" stroke-dasharray="8 6" />
        <text x="${VW / 2}" y="${Math.round(VH * 0.67)}" fill="#7CF3C8" font-family="${font}" font-size="46" font-weight="800" text-anchor="middle">${keyword || '핵심 공식 완벽 정리'}</text>
      </svg>
    `;
  }

  // 기본: remotion-starburst (만화·예능 방사형 광선 + 팝업)
  const raysCount = 20;
  const rayPaths = [];
  const cx = VW / 2;
  const cy = VH / 2;
  const r = Math.max(VW, VH);
  for (let i = 0; i < raysCount; i++) {
    const a1 = (i / raysCount) * Math.PI * 2;
    const a2 = ((i + 0.5) / raysCount) * Math.PI * 2;
    rayPaths.push(`M ${cx} ${cy} L ${cx + Math.cos(a1) * r} ${cy + Math.sin(a1) * r} L ${cx + Math.cos(a2) * r} ${cy + Math.sin(a2) * r} Z`);
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">
      <rect width="${VW}" height="${VH}" fill="${bgDark}" />
      <g opacity="0.18">
        ${rayPaths.map((d) => `<path d="${d}" fill="${primary}" />`).join('')}
      </g>
      <circle cx="${cx}" cy="${cy}" r="${Math.round(VW * 0.22)}" fill="${primary}" opacity="0.95" />
      <text x="${cx}" y="${cy - 20}" fill="#0A0F1D" font-family="${font}" font-size="34" font-weight="900" text-anchor="middle" letter-spacing="4">TOP HIGHLIGHT</text>
      <text x="${cx}" y="${cy + 45}" fill="#0A0F1D" font-family="${font}" font-size="64" font-weight="900" text-anchor="middle">${keyword || '시선 집중!'}</text>
    </svg>
  `;
}

module.exports = {REMOTION_PRESETS, renderMotionPlateSvg};
