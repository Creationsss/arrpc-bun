# Features

Complete feature overview of arRPC-Bun implementation.

## Transport Protocols

- **IPC Transport** - Unix sockets (Linux/macOS) / Windows named pipes
- **WebSocket Transport** - Discord RPC protocol over WebSocket
  - Ports 6463-6472 (standard)
  - Ports 60100-60120 (Hyper-V/WSL)
- **Bridge Server** - WebSocket bridge for web clients
  - Ports 1337-1347 (standard)
  - Ports 60000-60020 (Hyper-V/WSL)
- **Multi-socket Support** - Multiple simultaneous client connections

## Discord RPC Commands

- [x] `SET_ACTIVITY` - Set/update Rich Presence activity
- [x] `INVITE_BROWSER` - Open Discord invite in browser
- [x] `GUILD_TEMPLATE_BROWSER` - Open guild template in browser
- [x] `DEEP_LINK` - Handle Discord deep links
- [x] `CONNECTIONS_CALLBACK` - Connection status callbacks
- [ ] `AUTHORIZE` - OAuth2 authorization flow
- [ ] `AUTHENTICATE` - User authentication
- [ ] `GET_GUILDS` - Retrieve user's guilds
- [ ] `GET_GUILD` - Get specific guild information
- [ ] `GET_CHANNELS` - Retrieve guild channels
- [ ] `GET_CHANNEL` - Get specific channel information
- [ ] `SUBSCRIBE` - Subscribe to RPC events
- [ ] `UNSUBSCRIBE` - Unsubscribe from RPC events
- [ ] `SET_USER_VOICE_SETTINGS` - Modify voice settings
- [ ] `SELECT_VOICE_CHANNEL` - Join/leave voice channels
- [ ] `SELECT_TEXT_CHANNEL` - Switch text channels
- [ ] `GET_VOICE_SETTINGS` - Retrieve voice settings
- [ ] `SET_CERTIFIED_DEVICES` - Set certified audio devices
- [ ] `CAPTURE_SHORTCUT` - Register keyboard shortcuts

## Rich Presence Activity Features

### Core Fields
- [x] `application_id` - Application ID
- [x] `name` - Activity name
- [x] `details` - Activity details (primary text)
- [x] `state` - Activity state (secondary text)
- [x] `type` - Activity type (Playing = 0)
- [x] `instance` - Instance flag for game invites

### Timestamps
- [x] `timestamps.start` - Start time (auto-normalized from seconds/ms/μs)
- [x] `timestamps.end` - End time (auto-normalized)

### Assets (Images)
- [x] `assets.large_image` - Large image key/URL
- [x] `assets.large_text` - Large image hover text
- [x] `assets.small_image` - Small image key/URL
- [x] `assets.small_text` - Small image hover text

### Party (Multiplayer)
- [x] `party.id` - Party ID
- [x] `party.size` - Party size [current, max]

### Secrets (Join/Spectate)
- [x] `secrets.join` - Join secret for invites
- [x] `secrets.spectate` - Spectate secret
- [x] `secrets.match` - Match secret

### Buttons
- [x] `buttons` - Up to 2 clickable buttons with labels and URLs
- [x] `metadata.button_urls` - Button URL metadata

## Platform Features

### Process Detection
- **Windows** - Process enumeration via Windows API (FFI)
  - Full process path resolution
  - Command-line argument parsing
  - System process filtering
  - Failed open caching for performance
- **Linux** - `/proc` filesystem scanning
  - Batch processing (50 processes/batch)
  - Wine process detection
  - Anti-cheat executable filtering
- **macOS** - `ps` command parsing
  - `.app` bundle detection
  - Wine/Parallels support
  - Command-line argument extraction

### Steam Integration
- **Steam AppID observer** - matches games by Steam AppID instead of executable name
  - Resolves ~17,500 Steam AppIDs to Discord applications via `third_party_skus`
  - AppID sourced from `appmanifest_*.acf` install paths (all platforms)
  - AppID sourced from `reaper SteamLaunch AppId=` command line (Linux/macOS)
  - Runs after executable matching, so first-party matches keep priority
  - Disable with `ARRPC_NO_STEAM_OBSERVER`
- Steam library detection (all platforms)
  - VDF parser for `libraryfolders.vdf`
  - App manifest parsing
  - Wine path normalization (Z:\ drive)
  - Steam runtime process filtering
  - Batch manifest processing
  - Multi-library support
  - Steam app lookup caching

### Game Database
- Discord's detectable games database
- Custom game database support (`detectable_fixes.json`)
- Smart matching system
  - Executable matching (exact & fuzzy)
  - Path variation matching
  - Command-line argument matching
  - Platform-specific executables
  - macOS `.app_name` support
  - Indexed lookups for performance

## Additional Features

### Configuration
- Environment variable configuration
  - Debug logging (`ARRPC_DEBUG`)
  - Disable Steam support (`ARRPC_NO_STEAM`)
  - Custom data directory
  - State file export (`/tmp/arrpc-state-{0-9}`)
  - Ignore list with file persistence

### Process Management
- Parent process monitoring
- Graceful shutdown handling
- Automatic restart detection

### Network & Compatibility
- Hyper-V & WSL support (Windows)
- Origin validation (Discord domains only)
- Custom host configuration
- Port conflict resolution

### CLI Utilities
- Database management
  - `--list-database` - View detectable games
  - `--list-detected` - View active games
  - `bun run update-db` - Update game database
- Runtime options
  - `--no-process-scanning` - Disable auto-detection

### RPC Events
- [x] Connection events (`READY`, `ERROR`)
- [x] Activity updates
- [ ] Voice state/settings updates
- [ ] Notifications
- [ ] Messages
- [ ] Guild/channel updates

## Not Supported (yet?)

These features require Discord client integration and are intentionally not implemented:

- User authentication & OAuth2
- Voice channel control
- Text channel switching
- Guild/channel queries
- Message sending/receiving
- User settings modification
- Event subscriptions
- Keyboard shortcut capture
- Overlay integration
