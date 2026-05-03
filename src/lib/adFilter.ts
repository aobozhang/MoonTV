/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

/**
 * M3U8 广告过滤模块
 *
 * 广告段常见特征：
 * 1. 时长极短（≤2s 的片段几乎可以确定是广告）
 * 2. 时长均匀（大量完全相同的值，如全部是 3.00s）
 * 3. 短片段占比过高（≤5s 超过 15% 时）
 * 4. DISCONTINUITY 标记（段边界有编辑痕迹，需结合时长判断）
 */

export interface AdFilterResult {
  filteredM3U8: string;
  stats: {
    totalSegments: number;
    removedSegments: number;
    adLikelihood: number; // 0-100
    removedIndexes: number[];
  };
}

export interface SegmentInfo {
  duration: number;
  isAd: boolean;
  lineIndex: number;
}

// 阈值配置
const THRESHOLDS = {
  /** 时长 ≤ 此值认为是广告片段（秒） */
  AD_DURATION_MAX: 2.0,
  /** 时长 ≤ 此值认为是可疑短片段（秒） */
  SUSPICIOUS_DURATION_MAX: 5.0,
  /** 短片段超过此比例则整体判定为有广告 */
  SHORT_SEGMENT_RATIO_THRESHOLD: 0.15,
  /** 相同时长连续段超过此数量认为是轮播广告 */
  CONSECUTIVE_SAME_DURATION_THRESHOLD: 3,
};

/**
 * 解析 m3u8 内容，提取所有切片段的信息
 */
function parseSegments(lines: string[]): SegmentInfo[] {
  const segments: SegmentInfo[] = [];
  let currentDuration: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/^#EXTINF:([\d.]+)/);
      if (match) {
        currentDuration = parseFloat(match[1]);
      }
    } else if (
      !line.startsWith('#') &&
      line !== '' &&
      currentDuration !== null
    ) {
      segments.push({
        duration: currentDuration,
        isAd: false,
        lineIndex: i,
      });
      currentDuration = null;
    }
  }

  return segments;
}

/**
 * 判断单个片段是否为广告
 */
function detectAdSegments(segments: SegmentInfo[]): boolean[] {
  if (segments.length === 0) return [];

  const adFlags = segments.map(() => false);

  // 策略1：极短片段检测（≤2s）
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].duration <= THRESHOLDS.AD_DURATION_MAX) {
      adFlags[i] = true;
    }
  }

  // 策略2：短片段比例过高（≤5s 超过 15%）
  const shortCount = segments.filter(
    (s) => s.duration <= THRESHOLDS.SUSPICIOUS_DURATION_MAX
  ).length;
  const shortRatio = shortCount / segments.length;
  if (shortRatio > THRESHOLDS.SHORT_SEGMENT_RATIO_THRESHOLD) {
    for (let i = 0; i < segments.length; i++) {
      if (
        segments[i].duration <= THRESHOLDS.SUSPICIOUS_DURATION_MAX &&
        !adFlags[i]
      ) {
        adFlags[i] = true;
      }
    }
  }

  // 策略3：连续相同精确时长检测（广告轮播特征）
  let consecutiveSameCount = 1;
  for (let i = 1; i < segments.length; i++) {
    if (Math.abs(segments[i].duration - segments[i - 1].duration) < 0.001) {
      consecutiveSameCount++;
      if (
        consecutiveSameCount >= THRESHOLDS.CONSECUTIVE_SAME_DURATION_THRESHOLD
      ) {
        for (let k = i - consecutiveSameCount + 1; k <= i; k++) {
          if (segments[k].duration <= THRESHOLDS.SUSPICIOUS_DURATION_MAX) {
            adFlags[k] = true;
          }
        }
      }
    } else {
      consecutiveSameCount = 1;
    }
  }

  return adFlags;
}

/**
 * 计算广告可能性评分
 */
function calculateAdLikelihood(
  segments: SegmentInfo[],
  adFlags: boolean[]
): number {
  if (segments.length === 0) return 0;

  const adCount = adFlags.filter(Boolean).length;
  const adRatio = adCount / segments.length;
  let likelihood = Math.round(adRatio * 100);

  const shortCount = segments.filter(
    (s) => s.duration <= THRESHOLDS.SUSPICIOUS_DURATION_MAX
  ).length;
  const shortRatio = shortCount / segments.length;
  if (shortRatio > 0.15) {
    likelihood = Math.max(likelihood, Math.round(shortRatio * 100));
  }

  return Math.min(100, likelihood);
}

/**
 * 过滤 m3u8 内容中的广告片段
 */
export function filterAdsFromM3U8(
  m3u8Content: string,
  enableFilter = true
): AdFilterResult {
  if (!m3u8Content || !enableFilter) {
    return {
      filteredM3U8: m3u8Content || '',
      stats: {
        totalSegments: 0,
        removedSegments: 0,
        adLikelihood: 0,
        removedIndexes: [],
      },
    };
  }

  const lines = m3u8Content.split('\\n');
  const segments = parseSegments(lines);

  if (segments.length === 0) {
    return {
      filteredM3U8: m3u8Content,
      stats: {
        totalSegments: 0,
        removedSegments: 0,
        adLikelihood: 0,
        removedIndexes: [],
      },
    };
  }

  const adFlags = detectAdSegments(segments);
  const adLikelihood = calculateAdLikelihood(segments, adFlags);
  const removedIndexes: number[] = segments
    .map((s, i) => (adFlags[i] ? s.lineIndex : -1))
    .filter((idx) => idx !== -1);

  const linesToRemove = new Set<number>();

  for (const segLineIdx of removedIndexes) {
    linesToRemove.add(segLineIdx);
    for (let i = segLineIdx - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith('#EXTINF:')) {
        linesToRemove.add(i);
        if (i > 0 && lines[i - 1].includes('#EXT-X-DISCONTINUITY')) {
          linesToRemove.add(i - 1);
        }
        break;
      }
      if (lines[i].trim() !== '' && !lines[i].trim().startsWith('#')) {
        break;
      }
    }
  }

  const filteredLines = lines
    .map((line, i) => (linesToRemove.has(i) ? null : line))
    .filter((line) => line !== null);

  return {
    filteredM3U8: filteredLines.join('\\n'),
    stats: {
      totalSegments: segments.length,
      removedSegments: adFlags.filter(Boolean).length,
      adLikelihood,
      removedIndexes,
    },
  };
}

/**
 * 检测 m3u8 是否有广告（不修改内容）
 */
export function detectAds(m3u8Content: string): number {
  if (!m3u8Content) return 0;

  const lines = m3u8Content.split('\\n');
  const segments = parseSegments(lines);
  if (segments.length === 0) return 0;

  const adFlags = detectAdSegments(segments);
  return calculateAdLikelihood(segments, adFlags);
}
