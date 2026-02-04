import { PrismaClient } from '@prisma/client';
import { fetchAndStoreArticles } from '@/lib/rssParser';

const prisma = new PrismaClient();

/**
 * Test script to create a few blog posts with the new format
 * Run with: npx tsx src/scripts/test-blog-format.ts
 */
async function main() {
  console.log('🧪 Testing new blog format...\n');

  try {
    // Get system author
    const systemAuthor = await prisma.user.findUnique({
      where: { email: 'editorial@newsweb.com' },
    });

    if (!systemAuthor) {
      console.error('❌ System author not found. Please run: npm run db:seed');
      return;
    }

    // Delete old articles from The Hindu to make room for testing
    console.log('🗑️  Deleting old articles from The Hindu to test fresh imports...\n');
    await prisma.article.deleteMany({
      where: {
        sourceName: 'The Hindu',
      },
    });

    // Get a couple of news sources for testing
    const sources = await prisma.newsSource.findMany({
      where: {
        active: true,
        name: { in: ['The Hindu', 'Times of India'] },
        category: 'news',
      },
      take: 2,
    });

    console.log(`📰 Testing with ${sources.length} sources\n`);

    for (const source of sources) {
      console.log(`\nProcessing: ${source.name}`);
      console.log('='.repeat(60));

      const result = await fetchAndStoreArticles(
        source.url,
        source.id,
        source.name,
        source.category,
        systemAuthor.id,
        2 // Just 2 articles per source for testing
      );

      console.log(`✅ Stored: ${result.stored}, Skipped: ${result.skipped}`);

      if (result.errors.length > 0) {
        console.log(`⚠️  Errors: ${result.errors.join(', ')}`);
      }
    }

    // Show the newly created articles
    console.log('\n' + '='.repeat(60));
    console.log('📝 Newly Created Blog Posts:');
    console.log('='.repeat(60));

    const recentArticles = await prisma.article.findMany({
      where: {
        aiRephrased: true,
      },
      include: {
        category: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    for (const article of recentArticles) {
      console.log(`\n📌 ${article.title}`);
      console.log(`   Category: ${article.category.name}`);
      console.log(`   Length: ${article.content.length} characters`);
      console.log(`   AI Rephrased: ${article.aiRephrased ? '✅ Yes' : '❌ No'}`);
      console.log(`   Excerpt: ${article.excerpt?.substring(0, 150)}...`);
    }

    console.log('\n✅ Test completed successfully!');
    console.log('\n💡 Visit http://localhost:3000 to see the blog posts');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
