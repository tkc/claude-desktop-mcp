/**
 * シェル操作を可能にするModel Context Protocol(MCP)サーバーの実装
 * このサーバーは、シェルコマンド実行機能を提供します
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn, SpawnOptions, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// コマンドライン引数からベースディレクトリを取得
const baseDir = process.argv[2] || process.cwd();
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

// サーバーのセットアップ
const server = new McpServer(new StdioServerTransport());

// デバッグログ
function log(...args: any[]) {
  if (verbose) {
    console.error(...args);
  }
}

log(`Base directory for shell commands: ${baseDir}`);

// 環境変数の設定（実行ユーザーと同じ環境を使用するため）
function getShellEnv(): NodeJS.ProcessEnv {
  // 現在のプロセスの環境変数をコピー
  const env = { ...process.env };

  // PATH変数を確保
  if (!env.PATH) {
    // 一般的なPATH設定
    env.PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

    // ユーザー固有のパスを追加
    const homeDir = os.homedir();
    env.PATH += `:${path.join(homeDir, '.local/bin')}`;
    env.PATH += `:${path.join(homeDir, 'bin')}`;

    // nvm, bun, deno, cargo などの一般的な場所
    env.PATH += `:${path.join(homeDir, '.nvm/current/bin')}`;
    env.PATH += `:${path.join(homeDir, '.bun/bin')}`;
    env.PATH += `:${path.join(homeDir, '.deno/bin')}`;
    env.PATH += `:${path.join(homeDir, '.cargo/bin')}`;
  }

  return env;
}

// シェルコマンド実行
server.tool(
  'run_command',
  'Runs a shell command and returns the output',
  'Use this to execute shell commands for tasks like installing dependencies, running scripts, or checking system information.',
  {
    parameters: z.object({
      command: z.string().describe('The shell command to run'),
      workingDir: z
        .string()
        .optional()
        .describe('Optional working directory for the command. Default is the base directory.'),
      timeout: z
        .number()
        .optional()
        .describe('Optional timeout in milliseconds. Default is 30000 (30 seconds).'),
    }),
    returns: z.string().describe('The command output (stdout and stderr)'),
  },
  async ({ command, workingDir = '', timeout = 30000 }) => {
    // 作業ディレクトリの設定
    const cwd = workingDir ? path.resolve(baseDir, workingDir) : baseDir;

    // 安全性チェック
    if (!cwd.startsWith(baseDir)) {
      return `Error: Working directory must be within the base directory`;
    }

    if (!fs.existsSync(cwd)) {
      return `Error: Working directory '${workingDir}' does not exist`;
    }

    log(`Running command: ${command}`);
    log(`Working directory: ${cwd}`);

    // コマンドのシェルでの実行
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | null = null;

      // 実行ユーザーと同じ環境変数を使用
      const env = getShellEnv();

      const options: SpawnOptions = {
        cwd,
        env,
        shell: true,
      };

      const process = spawn(command, [], options);

      // タイムアウトの設定
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          process.kill();
          resolve(`Command timed out after ${timeout}ms`);
        }, timeout);
      }

      // 標準出力の処理
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // 標準エラー出力の処理
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // プロセス終了時の処理
      process.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (code === 0) {
          // 成功した場合
          resolve(stdout || 'Command executed successfully (no output)');
        } else {
          // エラーが発生した場合
          const errorOutput = stderr || stdout || 'No error output';
          resolve(`Command failed with exit code ${code}:\n${errorOutput}`);
        }
      });

      // エラー発生時の処理
      process.on('error', (err) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(`Failed to execute command: ${err.message}`);
      });
    });
  }
);

// 環境変数の取得
server.tool(
  'get_env',
  'Gets the value of an environment variable',
  'Use this to check environment variables that might affect command execution.',
  {
    parameters: z.object({
      name: z.string().describe('The name of the environment variable'),
    }),
    returns: z
      .string()
      .describe('The value of the environment variable or a message if it is not set'),
  },
  async ({ name }) => {
    const env = getShellEnv();
    const value = env[name];

    if (value === undefined) {
      return `Environment variable '${name}' is not set`;
    }

    return value;
  }
);

// サーバーの起動
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error('Error starting MCP server:', error);
});
