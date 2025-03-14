# Claude Desktop MCP Server

A filesystem Model Context Protocol (MCP) server implementation for Claude Desktop. This server provides filesystem capabilities to Claude, allowing it to read, write, and manipulate files on your system.

## Features

- List files with glob pattern matching
- Read file contents
- Write to files
- Edit files with diff output
- Delete files
- Secure path normalization to prevent directory traversal attacks

## Prerequisites

- [Bun](https://bun.sh) v1.2.5 or later

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/claude-desktop-mcp.git
cd claude-desktop-mcp
bun install
```

## Usage

Run the MCP server:

```bash
bun run index.ts [base-directory]
```

If no base directory is provided, the current working directory will be used.

## Available Tools

The server exposes the following tools:

- `list_files`: Lists files matching a glob pattern
- `read_file`: Reads the content of a file
- `write_file`: Writes content to a file
- `edit_file`: Edits an existing file with the provided content and shows diff
- `delete_file`: Deletes a file

## Security

The server implements path normalization and validation to ensure that operations are restricted to the specified base directory, preventing directory traversal attacks.

## License

MIT

## Acknowledgments

- Based on the [Model Context Protocol](https://modelcontextprotocol.io/) specification
- Built with [Bun](https://bun.sh) JavaScript runtime
