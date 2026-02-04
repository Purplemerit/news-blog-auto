import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchAndStoreMultipleSources } from '@/lib/rssParser';

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

/**
 * Manual trigger endpoint for admins to test blog post fetching
 * POST /api/admin/trigger-fetch
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin role
    const session = await auth();

    if (!session || !session.user || (session.user as any).role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin access required' },
        { status: 401 }
      );
    }

    const startTime = Date.now();

    // Parse request body for optional filters
    const body = await request.json().catch(() => ({}));
    const {
      country,
      category,
      sourceIds,
      limit = 10,
    } = body;

    // Create processing log
    const processingLog = await prisma.processingLog.create({
      data: {
        jobType: 'manual_trigger',
        status: 'started',
        metadata: JSON.stringify({
          startTime: new Date().toISOString(),
          trigger: 'admin',
          admin: session.user.email,
          filters: { country, category, sourceIds, limit },
        }),
      },
    });

    // Get system author
    let systemAuthor = await prisma.user.findUnique({
      where: { email: 'editorial@newsweb.com' },
    });

    if (!systemAuthor) {
      systemAuthor = await prisma.user.create({
        data: {
          email: 'editorial@newsweb.com',
          name: 'Editorial Team',
          role: 'SYSTEM',
          password: null,
        },
      });
    }

    // Build query filters
    const whereClause: any = { active: true };

    if (country) whereClause.country = country;
    if (category) whereClause.category = category;
    if (sourceIds && Array.isArray(sourceIds)) {
      whereClause.id = { in: sourceIds };
    }

    // Fetch news sources based on filters
    const newsSources = await prisma.newsSource.findMany({
      where: whereClause,
      take: 50, // Limit to 50 sources to prevent timeout
    });

    if (newsSources.length === 0) {
      await prisma.processingLog.update({
        where: { id: processingLog.id },
        data: {
          status: 'success',
          articlesCount: 0,
          completedAt: new Date(),
          metadata: JSON.stringify({
            message: 'No matching news sources found',
            filters: { country, category, sourceIds },
            duration: Date.now() - startTime,
          }),
        },
      });

      return NextResponse.json({
        success: true,
        message: 'No matching news sources found',
        stored: 0,
        skipped: 0,
        sources: 0,
      });
    }

    console.log(`Manual trigger: Processing ${newsSources.length} sources`);

    // Process sources
    const result = await fetchAndStoreMultipleSources(
      newsSources.map(s => ({
        url: s.url,
        id: s.id,
        name: s.name,
        category: s.category,
      })),
      systemAuthor.id,
      limit
    );

    const duration = Date.now() - startTime;

    // Update processing log
    await prisma.processingLog.update({
      where: { id: processingLog.id },
      data: {
        status: result.allErrors.length > 0 ? 'partial' : 'success',
        articlesCount: result.totalStored,
        errors: result.allErrors.length > 0 ? JSON.stringify(result.allErrors) : null,
        completedAt: new Date(),
        metadata: JSON.stringify({
          duration,
          stored: result.totalStored,
          skipped: result.totalSkipped,
          sourcesProcessed: newsSources.length,
          sourceResults: result.sourceResults,
          filters: { country, category, sourceIds, limit },
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Processed ${newsSources.length} sources in ${Math.round(duration / 1000)}s`,
      stored: result.totalStored,
      skipped: result.totalSkipped,
      errors: result.allErrors.length,
      errorMessages: result.allErrors.slice(0, 10), // Return first 10 errors
      duration: `${Math.round(duration / 1000)}s`,
      sourceResults: result.sourceResults,
      processingLogId: processingLog.id,
    });

  } catch (error: any) {
    console.error('Manual trigger error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process manual trigger',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * Get manual trigger status
 * GET /api/admin/trigger-fetch
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();

    if (!session || !session.user || (session.user as any).role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin access required' },
        { status: 401 }
      );
    }

    // Get recent processing logs
    const recentLogs = await prisma.processingLog.findMany({
      where: {
        jobType: 'manual_trigger',
      },
      orderBy: { startedAt: 'desc' },
      take: 10,
    });

    return NextResponse.json({
      success: true,
      recentJobs: recentLogs.map(log => ({
        id: log.id,
        status: log.status,
        articlesCount: log.articlesCount,
        startedAt: log.startedAt,
        completedAt: log.completedAt,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
        errors: log.errors ? JSON.parse(log.errors) : null,
      })),
    });

  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get trigger status',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
