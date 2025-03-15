/**
 * Arxiv論文取得を可能にするModel Context Protocol(MCP)サーバーの実装
 * このサーバーは、ArxivからAI/ML/NLP関連の論文を取得してRSS形式で提供します
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parseArgs } from 'node:util';
import fs from 'fs';
import path from 'path';
import { Feed } from 'feed';
import * as cheerio from 'cheerio';
import { parseStringPromise } from 'xml2js';

// コマンドライン引数の解析
const { values } = parseArgs({
  options: {
    outputDir: {
      type: 'string',
      short: 'o',
      help: 'Output directory for RSS feed',
    },
    verbose: {
      type: 'boolean',
      short: 'v',
      count: true,
      default: false,
      help: 'Enable verbose logging',
    },
  },
  allowPositionals: true,
});

const outputDirectory = values.outputDir || process.cwd();
const verbose = values.verbose;

// 詳細度フラグに基づいてログレベルを設定
const logLevel = verbose ? 'debug' : 'info';
function log(level: string, ...args: any[]) {
  if (level === 'debug' && logLevel !== 'debug') return;
  console.error(`[${level.toUpperCase()}]`, ...args);
}

// デフォルト設定
const DEFAULT_CONFIG = {
  searchQuery: 'cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG+OR+cat:cs.NE',
  maxResults: 100,
  outputFile: 'arxiv-papers.xml',
  sortBy: 'submittedDate', // lastUpdatedDate or submittedDate or relevance
  sortOrder: 'descending', // ascending or descending
  cacheDir: './Users/takeshiiijima/github/claude-desktop-mcp/.cache',
  cacheExpiry: 3600000, // 1 hour in milliseconds
};

// 型定義
interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  published: Date;
  updated: Date;
  authors: string[];
  link: string;
  pdfLink: string;
  categories: string[];
}

interface FetchConfig {
  searchQuery?: string;
  maxResults?: number;
  sortBy?: string;
  sortOrder?: string;
  outputFile?: string;
}

/**
 * ArxivデータマネージャクラスS
 */
class ArxivManager {
  private config: typeof DEFAULT_CONFIG;
  private outputDir: string;

  /**
   * コンストラクタ
   */
  constructor(outputDir: string, configOverrides: Partial<typeof DEFAULT_CONFIG> = {}) {
    this.outputDir = outputDir;
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this.ensureCacheDirectory();
  }

  /**
   * Arxiv APIから論文を取得
   */
  async fetchArxivPapers(options: FetchConfig = {}): Promise<ArxivPaper[]> {
    const searchQuery = options.searchQuery || this.config.searchQuery;
    const maxResults = options.maxResults || this.config.maxResults;
    const sortBy = options.sortBy || this.config.sortBy;
    const sortOrder = options.sortOrder || this.config.sortOrder;

    const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=${sortOrder}`;

    log('info', `Fetching papers from Arxiv API: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'mcp-arxiv/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch from Arxiv API: ${response.status} ${response.statusText}`
        );
      }

      const xml = await response.text();
      const result = await parseStringPromise(xml, { explicitArray: false });

      if (!result.feed || !result.feed.entry) {
        return [];
      }

      const entries = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];

      return entries.map((entry) => {
        // 複数の著者を処理
        const authors = Array.isArray(entry.author)
          ? entry.author.map((author: any) => author.name)
          : [entry.author.name];

        // 複数のカテゴリを処理
        const categories = Array.isArray(entry.category)
          ? entry.category.map((cat: any) => cat.$.term)
          : [entry.category.$.term];

        // PDFリンクを検索
        const links = Array.isArray(entry.link) ? entry.link : [entry.link];
        const pdfLink = links.find((link: any) => link.$.title === 'pdf')?.$.href || '';

        return {
          id: entry.id,
          title: entry.title.replace(/\\n/g, ' ').trim(),
          summary: entry.summary.replace(/\\n/g, ' ').trim(),
          published: new Date(entry.published),
          updated: new Date(entry.updated),
          authors,
          link: entry.id,
          pdfLink,
          categories,
        };
      });
    } catch (error) {
      log('error', 'Error fetching papers:', error);
      return [];
    }
  }

  /**
   * 論文からRSSフィードを生成
   */
  generateRSSFeed(papers: ArxivPaper[]): Feed {
    const siteURL = 'https://arxiv.org/';
    const date = new Date();

    const feed = new Feed({
      title: 'Arxiv Papers - AI, ML, and NLP',
      description:
        'Latest research papers from Arxiv in AI, Machine Learning, and Natural Language Processing',
      id: siteURL,
      link: siteURL,
      language: 'en',
      updated: date,
      generator: 'mcp-arxiv',
      copyright: 'All content copyright Arxiv.org', // 著作権情報を追加
      feedLinks: {
        rss: `${siteURL}rss`,
      },
      author: {
        name: 'Arxiv Papers Bot',
        link: siteURL,
      },
    });

    papers.forEach((paper) => {
      feed.addItem({
        title: paper.title,
        id: paper.id,
        link: paper.link,
        description: paper.summary,
        content: this.generateHTMLContent(paper),
        author: paper.authors.map((name) => ({ name })),
        date: paper.published,
        category: paper.categories.map((cat) => ({ name: cat })),
      });
    });

    return feed;
  }

  /**
   * 論文のHTML形式コンテンツを生成
   */
  private generateHTMLContent(paper: ArxivPaper): string {
    return `
      <h2>${paper.title}</h2>
      <p><strong>Authors:</strong> ${paper.authors.join(', ')}</p>
      <p><strong>Published:</strong> ${paper.published.toDateString()}</p>
      <p><strong>Categories:</strong> ${paper.categories.join(', ')}</p>
      <p><strong>Links:</strong> <a href="${paper.link}">Abstract</a> | <a href="${paper.pdfLink}">PDF</a></p>
      <h3>Abstract</h3>
      <p>${paper.summary}</p>
    `;
  }

  /**
   * キャッシュディレクトリが存在しない場合は作成
   */
  private ensureCacheDirectory(): void {
    if (!fs.existsSync(this.config.cacheDir)) {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
      log('info', `Created cache directory: ${this.config.cacheDir}`);
    }
  }

  /**
   * データをキャッシュに保存
   */
  saveToCache(data: ArxivPaper[]): void {
    const filePath = path.join(this.config.cacheDir, 'arxiv-papers.json');

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        timestamp: Date.now(),
        data,
      })
    );

    log('info', `Saved data to cache: ${filePath}`);
  }

  /**
   * キャッシュからデータを読み込み
   */
  loadFromCache(): ArxivPaper[] | null {
    const filePath = path.join(this.config.cacheDir, 'arxiv-papers.json');

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const cache = JSON.parse(content);

      // キャッシュが有効期限切れかチェック
      if (Date.now() - cache.timestamp > this.config.cacheExpiry) {
        log('info', 'Cache expired');
        return null;
      }

      log('info', `Loaded data from cache: ${filePath}`);
      return cache.data;
    } catch (error) {
      log('error', 'Failed to load from cache:', error);
      return null;
    }
  }

  /**
   * RSS取得と保存をメインで実行
   */
  async fetchAndSaveRSS(options: FetchConfig = {}): Promise<{
    success: boolean;
    message: string;
    papersCount: number;
  }> {
    try {
      // キャッシュから読み込みを試行
      let papers = this.loadFromCache();

      // キャッシュにない場合はArxivから取得
      if (!papers) {
        papers = await this.fetchArxivPapers(options);

        if (papers.length > 0) {
          this.saveToCache(papers);
        } else {
          return {
            success: false,
            message: 'No papers fetched from Arxiv',
            papersCount: 0,
          };
        }
      }

      if (papers && papers.length > 0) {
        // RSSフィードを生成
        const feed = this.generateRSSFeed(papers);
        const rssContent = feed.rss2();

        // 出力ディレクトリが存在することを確認
        if (!fs.existsSync(this.outputDir)) {
          fs.mkdirSync(this.outputDir, { recursive: true });
        }

        // 出力ファイル名
        const outputFile = options.outputFile || this.config.outputFile;
        const outputPath = path.join(this.outputDir, outputFile);

        // ファイルに保存
        fs.writeFileSync(outputPath, rssContent);

        return {
          success: true,
          message: `RSS feed saved to ${outputPath}`,
          papersCount: papers.length,
        };
      } else {
        return {
          success: false,
          message: 'No papers to process',
          papersCount: 0,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Error: ${errorMessage}`,
        papersCount: 0,
      };
    }
  }
}

// 出力ディレクトリが有効かチェック
if (!fs.existsSync(outputDirectory)) {
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
    log('info', `Created output directory: ${outputDirectory}`);
  } catch (error) {
    log('error', `Failed to create output directory: ${error}`);
    process.exit(1);
  }
}

// Arxivマネージャインスタンスを作成
const arxivManager = new ArxivManager(outputDirectory);

// ツール入力用のZodスキーマを定義
const ArxivFetchSchema = z.object({
  search_query: z.string().optional().describe('Arxiv検索クエリ（例: cat:cs.AI+OR+cat:cs.CL）'),
  max_results: z.number().optional().default(100).describe('取得する最大論文数'),
  sort_by: z
    .enum(['submittedDate', 'lastUpdatedDate', 'relevance'])
    .optional()
    .default('submittedDate')
    .describe('ソート基準'),
  sort_order: z
    .enum(['ascending', 'descending'])
    .optional()
    .default('descending')
    .describe('ソート順序'),
  output_file: z.string().optional().default('arxiv-papers.xml').describe('出力ファイル名'),
});

const ArxivGetCachedSchema = z.object({});

// Arxivツール名をenumオブジェクトとして定義
const ArxivTools = {
  FETCH: 'arxiv_fetch',
  GET_CACHED: 'arxiv_get_cached',
} as const;

// MCPサーバーを初期化
const server = new McpServer({
  name: 'mcp-arxiv',
  version: '1.0.0',
});

// Arxivツールを定義
server.tool(
  ArxivTools.FETCH,
  'Fetches latest AI/ML/NLP research papers from Arxiv and saves them as an RSS feed. Use this to get updates on recent research in artificial intelligence, machine learning, and natural language processing. The RSS feed can be imported into any feed reader. You can customize the search query, number of results, and sorting options.',
  ArxivFetchSchema.shape,
  async (args) => {
    try {
      const result = await arxivManager.fetchAndSaveRSS({
        searchQuery: args.search_query,
        maxResults: args.max_results,
        sortBy: args.sort_by,
        sortOrder: args.sort_order,
        outputFile: args.output_file,
      });

      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `${result.message}\nProcessed ${result.papersCount} papers.`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  ArxivTools.GET_CACHED,
  'Retrieves papers already cached by the arxiv_fetch tool without making new API calls. This is useful for browsing previously fetched papers without waiting for the API or to avoid rate limiting. The cached papers are typically from the most recent fetch operation.',
  ArxivGetCachedSchema.shape,
  async () => {
    try {
      const papers = arxivManager.loadFromCache();

      if (!papers || papers.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No papers in cache. Use arxiv_fetch first to download papers.',
            },
          ],
          isError: true,
        };
      }

      const papersList = papers
        .map(
          (paper, index) =>
            `${index + 1}. ${paper.title}\n   Authors: ${paper.authors.join(', ')}\n   Categories: ${paper.categories.join(', ')}\n   Link: ${paper.link}\n`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${papers.length} papers in cache:\n\n${papersList}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// サーバーを起動
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('info', `Arxiv MCP Server started (Output directory: ${outputDirectory})`);
  } catch (error) {
    log('error', `Server error: ${error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
