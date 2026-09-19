/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  }

  // 尝试从缓存读取（仅当 Upstash/Redis 可用时）
  const cached = await db.getCachedSearchResults(query);
  if (cached && cached.results.length > 0) {
    return NextResponse.json(
      { results: cached.results, cached: true },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=60',
          'CDN-Cache-Control': 'public, s-maxage=60',
          'Vercel-CDN-Cache-Control': 'public, s-maxage=60',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig.filter((site) => !site.disabled);

  // 追踪每个源的成功/失败
  const sourceHealthUpdate: Array<{
    sourceKey: string;
    success: boolean;
    health?: {
      score: number;
      failCount: number;
      lastSuccess: number;
      lastFail: number;
      pingTime: number;
      loadSpeed: string;
      quality: string;
      updatedAt: number;
    };
  }> = [];

  // 添加超时控制和错误处理，避免慢接口拖累整体响应
  const searchPromises = apiSites.map(async (site) => {
    const sourceKey = site.key;
    try {
      const result = await Promise.race([
        searchFromApi(site, query),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
        ),
      ]);
      // 成功：更新健康分
      const existing = await db.getSourceHealth(sourceKey);
      const now = Date.now();
      sourceHealthUpdate.push({
        sourceKey,
        success: true,
        health: {
          score: existing ? Math.min(100, (existing as any).score + 5) : 80,
          failCount: 0,
          lastSuccess: now,
          lastFail: (existing as any)?.lastFail || 0,
          pingTime: (existing as any)?.pingTime || 0,
          loadSpeed: (existing as any)?.loadSpeed || '未知',
          quality: (existing as any)?.quality || '未知',
          updatedAt: now,
        },
      });
      return result;
    } catch (err) {
      console.warn(`搜索失败 ${site.name}:`, (err as Error).message);
      // 失败：增加失败计数，降低健康分
      const existing = await db.getSourceHealth(sourceKey);
      const now = Date.now();
      const failCount = ((existing as any)?.failCount || 0) + 1;
      sourceHealthUpdate.push({
        sourceKey,
        success: false,
        health: {
          score: existing ? Math.max(0, (existing as any).score - 10) : 30,
          failCount,
          lastSuccess: (existing as any)?.lastSuccess || 0,
          lastFail: now,
          pingTime: (existing as any)?.pingTime || 0,
          loadSpeed: (existing as any)?.loadSpeed || '未知',
          quality: (existing as any)?.quality || '未知',
          updatedAt: now,
        },
      });
      return [];
    }
  });

  try {
    const results = await Promise.all(searchPromises);
    const successResults = results.filter(
      (r): r is any[] => Array.isArray(r) && r.length > 0
    );
    let flattenedResults = successResults.flat();
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    // 异步更新源健康分（不阻塞返回）
    Promise.all(
      sourceHealthUpdate.map(({ sourceKey, health }) =>
        db.setSourceHealth(sourceKey, health as any)
      )
    ).catch((_) => {
      /* ignore */
    });

    // 缓存搜索结果
    if (flattenedResults.length > 0) {
      db.setCachedSearchResults(query, flattenedResults).catch((_) => {
        /* ignore */
      });
    }

    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
