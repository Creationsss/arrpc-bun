<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Creationsss/arrpc-bun/refs/heads/main/assets/logo.png" width=300>
    <img alt="arRPC" src="https://raw.githubusercontent.com/Creationsss/arrpc-bun/refs/heads/main/assets/logo.png" width=300>
  </picture> <br>
  <a href="https://choosealicense.com/licenses/mit/"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <a href="https://github.com/Creationsss/arrpc-bun/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/Creationsss/arrpc-bun"></a>
  <a href="https://www.npmjs.com/package/arrpc-bun"><img alt="npm version" src="https://img.shields.io/npm/v/arrpc-bun"></a>
  <a href="https://aur.archlinux.org/packages/arrpc-bun"><img alt="AUR version" src="https://img.shields.io/aur/version/arrpc-bun"></a>
  <a href="https://aur.archlinux.org/packages/arrpc-bun-bin"><img alt="AUR version (bin)" src="https://img.shields.io/aur/version/arrpc-bun-bin"></a>
  <h3>Open Discord RPC server for custom clients</h3>
  <h5>TypeScript + Bun</h5>
</div>

## About

arRPC is an open source implementation of Discord's local RPC servers. It allows applications with Discord Rich Presence support to display their status on Discord Web, custom clients, and other platforms that don't natively support RPC.

**TypeScript + Bun port** of the original [arRPC](https://github.com/OpenAsar/arrpc) by OpenAsar, featuring full type safety, Bun native APIs, and improved performance.

## Installation

### Pre-built Binaries
Download the latest release for your platform from [GitHub Releases](https://github.com/Creationsss/arrpc-bun/releases):
- Linux (x64, ARM64, musl variants)
- macOS (Intel, Apple Silicon)
- Windows (x64)

### bun
```bash
bun install -g arrpc-bun
```

## Quick Start

Install dependencies:
```bash
bun install
```

Run the server:
```bash
bun start
```

Update detectable games database:
```bash
bun run update-db
```

## Configuration

Configure using environment variables:

- `ARRPC_DEBUG` - Enable debug logging
- `ARRPC_NO_BRIDGE` - Disable bridge server (if not needed)
- `ARRPC_NO_PROCESS_SCANNING` - Disable automatic game detection
- `ARRPC_NO_STEAM` - Disable Steam game detection and lookup
- `ARRPC_NO_STEAM_OBSERVER` - Disable Steam AppID matching (keeps path-based Steam lookup)
- `ARRPC_NO_LAUNCHERS` - Disable Heroic and Lutris game detection
- `ARRPC_STATE_FILE` - Enable state file (stores active activities to `/tmp/arrpc-state-{0-9}`)
- `ARRPC_IGNORE_LIST_FILE` - Path to ignore list file (games to skip detection)
- `ARRPC_PARENT_MONITOR` - Monitor parent process and shutdown when parent dies
- `ARRPC_BRIDGE_PORT` - Bridge port (default: 1337)
- `ARRPC_BRIDGE_HOST` - Bridge hostname (default: `127.0.0.1`)
- `ARRPC_WEBSOCKET_HOST` - WebSocket hostname (default: `127.0.0.1`)
- `ARRPC_ALLOWED_ORIGINS` - Additional WebSocket origins, comma separated (`*` allows any)
- `ARRPC_DATA_DIR` - Custom data directory for detectable databases

Example:
```bash
ARRPC_DEBUG=1 bun start
```

## Features

**[View Complete Feature List](FEATURES.md)**

## License

MIT

Based on [arRPC](https://github.com/OpenAsar/arrpc) by OpenAsar
