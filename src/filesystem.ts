/**
 * ファイルシステム操作を可能にするModel Context Protocol(MCP)サーバー
 * このサーバーは、Claude Desktopからローカルファイルシステムへのアクセスを提供します
 */

// 必要なパッケージのインポート
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // MCPサーバーのコアクラス
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'; // 標準入出力を使用した通信
import { z } from 'zod'; // バリデーション用ライブラリ
import * as fs from 'fs'; // ファイルシステム操作
import * as path from 'path'; // パス操作ユーティリティ
import * as diffLib from 'diff'; // テキスト差分生成
import * as minimatch from 'minimatch'; // ファイルパターンマッチング

// コマンドライン引数からベースディレクトリを取得（未指定の場合は現在のディレクトリを使用）
const baseDir = process.argv[2] || process.cwd();
console.error(`Base directory: ${baseDir}`); // デバッグ情報として出力

// MCPサーバーインスタンスの作成
// StdioServerTransportを使用して、標準入出力経由でClaudeと通信
const server = new McpServer(new StdioServerTransport());

/**
 * ファイルパスを正規化し、安全性をチェックする関数
 * @param filePath ユーザー指定のファイルパス
 * @returns 正規化されたフルパス
 * @throws ベースディレクトリ外へのアクセス試行時にエラーをスロー
 */
function normalizePath(filePath: string): string {
  // パスの結合と正規化（相対パスを絶対パスに変換など）
  const normalizedPath = path.normalize(path.resolve(baseDir, filePath));

  // ベースディレクトリの範囲外へのアクセスを防止（パストラバーサル攻撃対策）
  if (!normalizedPath.startsWith(baseDir)) {
    throw new Error(`Access denied: ${filePath} is outside the base directory`);
  }

  return normalizedPath;
}

// ツール1: ファイル一覧の取得
// glob パターンに一致するファイルを検索し、リストとして返す
server.tool(
  'list_files', // ツール名
  'Lists files matching the given glob pattern within the base directory', // ツールの説明
  'Use this to find files in the filesystem that match specific patterns. Useful for locating source code files, configurations, or data files.', // 使用方法のガイド
  {
    // 入力パラメータの定義とバリデーション
    parameters: z.object({
      pattern: z
        .string()
        .describe("Glob pattern to match files (e.g., '**/*.ts' for all TypeScript files)"),
      directory: z.string().optional().describe('Optional subdirectory to search within'),
    }),
    // 戻り値の型定義
    returns: z.string().describe('List of matching files'),
  },
  // 実際の処理を行う非同期関数
  async ({ pattern, directory = '.' }) => {
    try {
      // 検索ディレクトリのパスを正規化
      const searchDir = normalizePath(directory);

      // 指定されたディレクトリが存在し、ディレクトリであることを確認
      if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
        return `Error: Directory '${directory}' does not exist or is not a directory`;
      }

      /**
       * ディレクトリ内のすべてのファイルを再帰的に取得する関数
       * @param dir 検索するディレクトリ
       * @param filesList 結果を蓄積する配列
       * @returns 見つかったファイルパスの配列
       */
      const getAllFiles = (dir: string, filesList: string[] = []): string[] => {
        // ディレクトリ内のファイルとサブディレクトリを列挙
        const files = fs.readdirSync(dir);

        // 各ファイル/ディレクトリに対する処理
        files.forEach((file) => {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
            // ディレクトリの場合は再帰的に処理
            getAllFiles(filePath, filesList);
          } else {
            // ファイルの場合はリストに追加（ベースディレクトリからの相対パスに変換）
            const relativePath = path.relative(baseDir, filePath);
            filesList.push(relativePath);
          }
        });

        return filesList;
      };

      // すべてのファイルを取得してパターンマッチング
      const allFiles = getAllFiles(searchDir);
      const matchingFiles = allFiles.filter((file) => minimatch.default(file, pattern));

      // 結果の返却
      if (matchingFiles.length === 0) {
        return `No files matching pattern '${pattern}' found in '${directory}'`;
      }

      return matchingFiles.join('\n'); // 一致したファイルのリストを改行区切りで返す
    } catch (error) {
      // エラーハンドリングと適切なエラーメッセージの返却
      if (error instanceof Error) {
        return `Error listing files: ${error.message}`;
      }
      return 'An unknown error occurred while listing files';
    }
  }
);

// ツール2: ファイル読み込み
// 指定されたファイルの内容を読み取って返す
server.tool(
  'read_file', // ツール名
  'Reads the content of a file', // ツールの説明
  'Use this to read the contents of files for analysis, understanding code, or retrieving data.', // 使用方法のガイド
  {
    // 入力パラメータの定義
    parameters: z.object({
      path: z.string().describe('Path to the file to read'),
    }),
    // 戻り値の型定義
    returns: z.string().describe('Content of the file'),
  },
  // 実際の処理を行う非同期関数
  async ({ path: filePath }) => {
    try {
      // ファイルパスの正規化
      const normalizedPath = normalizePath(filePath);

      // ファイルの存在確認
      if (!fs.existsSync(normalizedPath)) {
        return `Error: File '${filePath}' does not exist`;
      }

      // 指定されたパスがファイルであることを確認
      if (!fs.statSync(normalizedPath).isFile()) {
        return `Error: '${filePath}' is not a file`;
      }

      // ファイル内容の読み込みと返却
      const content = fs.readFileSync(normalizedPath, 'utf8');
      return content;
    } catch (error) {
      // エラーハンドリング
      if (error instanceof Error) {
        return `Error reading file: ${error.message}`;
      }
      return 'An unknown error occurred while reading the file';
    }
  }
);

// ツール3: ファイル書き込み
// 指定されたパスにコンテンツを書き込む（新規作成または上書き）
server.tool(
  'write_file', // ツール名
  'Writes content to a file', // ツールの説明
  'Use this to create new files or overwrite existing files. Useful for code generation or modifications.', // 使用方法のガイド
  {
    // 入力パラメータの定義
    parameters: z.object({
      path: z.string().describe('Path to the file to write'),
      content: z.string().describe('Content to write to the file'),
    }),
    // 戻り値の型定義
    returns: z.string().describe('Result of the operation'),
  },
  // 実際の処理を行う非同期関数
  async ({ path: filePath, content }) => {
    try {
      // ファイルパスの正規化
      const normalizedPath = normalizePath(filePath);

      // 親ディレクトリが存在するか確認し、存在しなければ再帰的に作成
      const directory = path.dirname(normalizedPath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }

      // ファイル内容の書き込み
      fs.writeFileSync(normalizedPath, content, 'utf8');
      return `File '${filePath}' has been written successfully`;
    } catch (error) {
      // エラーハンドリング
      if (error instanceof Error) {
        return `Error writing file: ${error.message}`;
      }
      return 'An unknown error occurred while writing the file';
    }
  }
);

// ツール4: ファイル編集（差分表示付き）
// 既存ファイルを新しい内容で更新し、変更内容の差分を表示する
server.tool(
  'edit_file', // ツール名
  'Edits an existing file with the provided content and shows diff', // ツールの説明
  'Use this to modify existing files while seeing the changes. Great for code modifications, bug fixes, or refactoring.', // 使用方法のガイド
  {
    // 入力パラメータの定義
    parameters: z.object({
      path: z.string().describe('Path to the file to edit'),
      content: z.string().describe('New content for the file'),
    }),
    // 戻り値の型定義
    returns: z.string().describe('Diff of the changes and result of the operation'),
  },
  // 実際の処理を行う非同期関数
  async ({ path: filePath, content: newContent }) => {
    try {
      // ファイルパスの正規化
      const normalizedPath = normalizePath(filePath);

      // ファイルの存在確認
      if (!fs.existsSync(normalizedPath)) {
        return `Error: File '${filePath}' does not exist`;
      }

      // 元の内容の読み込み
      const oldContent = fs.readFileSync(normalizedPath, 'utf8');

      // 差分の生成（unified diff形式）
      // createPatchは「元のファイル名」「新しいファイル名」「元の内容」「新しい内容」「元のヘッダ」「新しいヘッダ」を受け取る
      const diff = diffLib.createPatch(filePath, oldContent, newContent, 'Old', 'New');

      // 新しい内容でファイルを上書き
      fs.writeFileSync(normalizedPath, newContent, 'utf8');

      // 結果と差分を返却
      return `File '${filePath}' has been edited successfully.\n\nChanges:\n${diff}`;
    } catch (error) {
      // エラーハンドリング
      if (error instanceof Error) {
        return `Error editing file: ${error.message}`;
      }
      return 'An unknown error occurred while editing the file';
    }
  }
);

// ツール5: ファイル削除
// 指定されたファイルを削除する
server.tool(
  'delete_file', // ツール名
  'Deletes a file', // ツールの説明
  'Use this to remove files that are no longer needed.', // 使用方法のガイド
  {
    // 入力パラメータの定義
    parameters: z.object({
      path: z.string().describe('Path to the file to delete'),
    }),
    // 戻り値の型定義
    returns: z.string().describe('Result of the operation'),
  },
  // 実際の処理を行う非同期関数
  async ({ path: filePath }) => {
    try {
      // ファイルパスの正規化
      const normalizedPath = normalizePath(filePath);

      // ファイルの存在確認
      if (!fs.existsSync(normalizedPath)) {
        return `Error: File '${filePath}' does not exist`;
      }

      // 指定されたパスがファイルであることを確認
      if (!fs.statSync(normalizedPath).isFile()) {
        return `Error: '${filePath}' is not a file`;
      }

      // ファイルの削除
      fs.unlinkSync(normalizedPath);
      return `File '${filePath}' has been deleted successfully`;
    } catch (error) {
      // エラーハンドリング
      if (error instanceof Error) {
        return `Error deleting file: ${error.message}`;
      }
      return 'An unknown error occurred while deleting the file';
    }
  }
);

// サーバーの起動
// StdioServerTransport インスタンスを作成し、サーバーと接続
// これにより、標準入出力を通じてClaudeとの通信が確立される
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error('Error starting MCP server:', error);
});
