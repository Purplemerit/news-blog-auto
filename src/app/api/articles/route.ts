import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/articles - Fetch blog articles from database
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const categoryParam = searchParams.get('category');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const featuredParam = searchParams.get('featured');

    const limit = Math.min(parseInt(limitParam || '50'), 100);
    const offset = parseInt(offsetParam || '0');

    // Build where clause
    const where: any = { published: true };

    if (categoryParam) {
      const category = await prisma.category.findUnique({
        where: { slug: categoryParam },
      });
      if (category) {
        where.categoryId = category.id;
      }
    }

    if (featuredParam === 'true') {
      where.featured = true;
    }

    // Fetch articles
    const articles = await prisma.article.findMany({
      where,
      include: {
        category: true,
        author: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const totalCount = await prisma.article.count({ where });

    // Transform for frontend
    const transformedArticles = articles.map(article => {
      const now = new Date();
      const diffMs = now.getTime() - article.createdAt.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

      let pubDate = '';
      if (diffHours < 1) {
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        pubDate = `${diffMinutes} minutes ago`;
      } else if (diffHours < 24) {
        pubDate = `${diffHours} hours ago`;
      } else {
        pubDate = article.createdAt.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }

      const words = article.content.split(/\s+/).length;
      const readTime = `${Math.ceil(words / 200)} Min`;

      return {
        id: article.id,
        title: article.title,
        slug: article.slug,
        link: `/article/${article.slug}`,
        pubDate,
        description: article.excerpt || article.content.substring(0, 200) + '...',
        content: article.content,
        excerpt: article.excerpt,
        image: article.image,
        category: article.category.name,
        categorySlug: article.category.slug,
        featured: article.featured,
        author: article.author.name || 'Editorial Team',
        authorImage: article.author.image,
        sourceName: article.sourceName,
        sourceUrl: article.sourceUrl,
        readTime,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      };
    });

    return NextResponse.json({
      success: true,
      articles: transformedArticles,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });

  } catch (error: any) {
    console.error('Error fetching articles:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch articles',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
