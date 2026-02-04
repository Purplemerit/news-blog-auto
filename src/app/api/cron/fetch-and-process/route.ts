import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAndStoreMultipleSources } from '@/lib/rssParser';

// Maximum execution time for Vercel serverless functions (5 minutes for Pro tier)
export const maxDuration = 300;

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * Scheduled cron job to fetch RSS feeds and create blog posts
 * Runs every 12 hours via Vercel Cron
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Validate cron secret for security
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Create processing log entry
  let processingLog;
  try {
    processingLog = await prisma.processingLog.create({
      data: {
        jobType: 'scheduled_fetch',
        status: 'started',
        metadata: JSON.stringify({
          startTime: new Date().toISOString(),
          trigger: 'cron',
        }),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to create processing log', details: error.message },
      { status: 500 }
    );
  }

  try {
    // Get system author (Editorial Team)
    let systemAuthor = await prisma.user.findUnique({
      where: { email: 'editorial@newsweb.com' },
    });

    // Create system author if it doesn't exist
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

    // Fetch all active news sources
    const newsSources = await prisma.newsSource.findMany({
      where: { active: true },
      orderBy: [{ country: 'asc' }, { category: 'asc' }],
    });

    if (newsSources.length === 0) {
      await prisma.processingLog.update({
        where: { id: processingLog.id },
        data: {
          status: 'success',
          articlesCount: 0,
          completedAt: new Date(),
          metadata: JSON.stringify({
            message: 'No active news sources found',
            duration: Date.now() - startTime,
          }),
        },
      });

      return NextResponse.json({
        success: true,
        message: 'No active news sources to process',
        stored: 0,
        skipped: 0,
      });
    }

    // Configure article limits based on tier
    const TIER_1_COUNTRIES = ['UNITED_STATES', 'UNITED_KINGDOM', 'INDIA'];
    const TIER_2_COUNTRIES = ['CANADA', 'AUSTRALIA', 'GERMANY', 'FRANCE', 'JAPAN', 'SINGAPORE'];

    const getArticleLimit = (country: string): number => {
      if (TIER_1_COUNTRIES.includes(country)) return 15;
      if (TIER_2_COUNTRIES.includes(country)) return 10;
      return 5; // Tier 3
    };

    // Group sources by country for tiered processing
    const sourcesByCountry = newsSources.reduce((acc, source) => {
      if (!acc[source.country]) {
        acc[source.country] = [];
      }
      acc[source.country].push(source);
      return acc;
    }, {} as Record<string, typeof newsSources>);

    // Process sources with appropriate limits
    const sourcesToProcess = Object.entries(sourcesByCountry).flatMap(([country, sources]) => {
      const limit = getArticleLimit(country);
      return sources.map(source => ({
        url: source.url,
        id: source.id,
        name: source.name,
        category: source.category,
        country,
        articleLimit: Math.ceil(limit / sources.length), // Distribute limit across sources
      }));
    });

    console.log(`Processing ${sourcesToProcess.length} news sources from ${Object.keys(sourcesByCountry).length} countries`);

    // Calculate max articles per source (to stay within time limits)
    const maxArticlesPerSource = parseInt(process.env.ARTICLES_PER_CATEGORY || '10');

    // Process all sources
    const result = await fetchAndStoreMultipleSources(
      sourcesToProcess.map(s => ({
        url: s.url,
        id: s.id,
        name: s.name,
        category: s.category,
      })),
      systemAuthor.id,
      maxArticlesPerSource
    );

    const duration = Date.now() - startTime;

    // Update processing log with results
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
          sourcesProcessed: sourcesToProcess.length,
          sourceResults: result.sourceResults,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Processed ${sourcesToProcess.length} sources in ${Math.round(duration / 1000)}s`,
      stored: result.totalStored,
      skipped: result.totalSkipped,
      errors: result.allErrors.length,
      duration: `${Math.round(duration / 1000)}s`,
      sourceResults: result.sourceResults,
    });

  } catch (error: any) {
    console.error('Cron job error:', error);

    // Update processing log with failure
    await prisma.processingLog.update({
      where: { id: processingLog.id },
      data: {
        status: 'failed',
        errors: JSON.stringify([error.message]),
        completedAt: new Date(),
        metadata: JSON.stringify({
          duration: Date.now() - startTime,
          error: error.message,
          stack: error.stack,
        }),
      },
    });

    return NextResponse.json(
      {
        success: false,
        error: 'Cron job failed',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
