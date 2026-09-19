/* eslint-disable no-console */

import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { SourceHealth } from '@/lib/types';

export const runtime = 'edge';

// GET: 获取源健康分
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceKey = searchParams.get('key');

  if (!sourceKey) {
    return NextResponse.json({ error: '缺少 sourceKey' }, { status: 400 });
  }

  try {
    const health = await db.getSourceHealth(sourceKey);
    return NextResponse.json({ health });
  } catch (err) {
    console.error('获取源健康分失败:', err);
    return NextResponse.json({ error: '获取源健康分失败' }, { status: 500 });
  }
}

// PUT: 更新源健康分
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { sourceKey, health } = body as {
      sourceKey: string;
      health: SourceHealth;
    };

    if (!sourceKey || !health) {
      return NextResponse.json(
        { error: '缺少 sourceKey 或 health' },
        { status: 400 }
      );
    }

    await db.setSourceHealth(sourceKey, health);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('更新源健康分失败:', err);
    return NextResponse.json({ error: '更新源健康分失败' }, { status: 500 });
  }
}
