import { join } from "node:path";
import { file } from "bun";
import embeddedDetectable from "../detectable.json";
import embeddedFixes from "../detectable_fixes.json";
import type { User } from "./types/user.d.ts";

async function loadJson<T>(
	path: string,
	fallback: T,
	isValid?: (data: unknown) => boolean,
): Promise<T> {
	const f = file(path);
	if (!(await f.exists())) return fallback;

	try {
		const data = (await f.json()) as T;
		if (isValid && !isValid(data)) return fallback;
		return data;
	} catch {
		return fallback;
	}
}

export async function getDetectableDb() {
	const dataDir = process.env.ARRPC_DATA_DIR;
	if (dataDir) {
		return loadJson(
			join(dataDir, "detectable.json"),
			embeddedDetectable,
			(data) => Array.isArray(data) && data.length > 0,
		);
	}
	return embeddedDetectable;
}

const appNameCache = new Map<string, string | null>();

async function fetchAppNameFromDiscord(
	appId: string,
): Promise<string | undefined> {
	try {
		const response = await fetch(
			`https://discord.com/api/v10/applications/${appId}/rpc`,
		);
		if (!response.ok) return undefined;

		const data = (await response.json()) as { name?: string };
		return data.name;
	} catch {
		return undefined;
	}
}

export async function getAppNameById(
	appId: string,
): Promise<string | undefined> {
	if (appNameCache.has(appId)) {
		return appNameCache.get(appId) ?? undefined;
	}

	const db = (await getDetectableDb()) as Array<{ id: string; name: string }>;
	for (const app of db) {
		if (app.id === appId) {
			appNameCache.set(appId, app.name);
			return app.name;
		}
	}

	// Fallback: fetch from Discord API
	const name = await fetchAppNameFromDiscord(appId);
	if (name) {
		appNameCache.set(appId, name);
		return name;
	}

	appNameCache.set(appId, null);
	return undefined;
}

export async function getCustomDb() {
	const dataDir = process.env.ARRPC_DATA_DIR;
	if (dataDir) {
		return loadJson(
			join(dataDir, "detectable_fixes.json"),
			embeddedFixes,
			(data) => Array.isArray(data),
		);
	}
	return embeddedFixes;
}

export const ENV_DEBUG = "ARRPC_DEBUG";
export const ENV_NO_PROCESS_SCANNING = "ARRPC_NO_PROCESS_SCANNING";
export const ENV_NO_STEAM = "ARRPC_NO_STEAM";
export const ENV_NO_STEAM_OBSERVER = "ARRPC_NO_STEAM_OBSERVER";
export const ENV_BRIDGE_PORT = "ARRPC_BRIDGE_PORT";
export const ENV_BRIDGE_HOST = "ARRPC_BRIDGE_HOST";
export const ENV_WEBSOCKET_HOST = "ARRPC_WEBSOCKET_HOST";
export const ENV_NO_BRIDGE = "ARRPC_NO_BRIDGE";
export const ENV_STATE_FILE = "ARRPC_STATE_FILE";
export const ENV_DATA_DIR = "ARRPC_DATA_DIR";
export const ENV_PARENT_MONITOR = "ARRPC_PARENT_MONITOR";
export const ENV_IGNORE_LIST_FILE = "ARRPC_IGNORE_LIST_FILE";
export const ENV_USER_ID = "ARRPC_USER_ID";
export const ENV_USER_USERNAME = "ARRPC_USER_USERNAME";
export const ENV_USER_GLOBAL_NAME = "ARRPC_USER_GLOBAL_NAME";
export const ENV_USER_DISCRIMINATOR = "ARRPC_USER_DISCRIMINATOR";
export const ENV_USER_AVATAR = "ARRPC_USER_AVATAR";

export const CLI_ARG_NO_PROCESS_SCANNING = "--no-process-scanning";
export const CLI_ARG_LIST_DATABASE = "--list-database";
export const CLI_ARG_LIST_DETECTED = "--list-detected";

export const STATE_FILE_PREFIX = "arrpc-state";
export const STATE_FILE_MAX_INDEX = 9;

export const BRIDGE_PORT_RANGE: [number, number] = [1337, 1347];
export const BRIDGE_PORT_RANGE_HYPERV: [number, number] = [60000, 60020];
export const BRIDGE_REFRESH_INTERVAL_MS = 30_000;
export const MAX_CACHED_ACTIVITIES = 50;
export const WEBSOCKET_PORT_RANGE: [number, number] = [6463, 6472];
export const WEBSOCKET_PORT_RANGE_HYPERV: [number, number] = [60100, 60120];
export const DEFAULT_LOCALHOST = "127.0.0.1";

export const IPC_MAX_RETRIES = 9;
export const SOCKET_AVAILABILITY_TIMEOUT = 1000;
export const IPC_HEADER_SIZE = 8;
export const IPC_MESSAGE_TYPE_MAX = 5;
export const MAX_IPC_PAYLOAD = 1024 * 1024;
export const IPC_SOCKET_NAME = "discord-ipc";
export const WINDOWS_IPC_PIPE_PATH = "\\\\?\\pipe\\discord-ipc";
export const UNIX_TEMP_DIR_FALLBACK = "/tmp";

export const WS_DEFAULT_ENCODING = "json";

export const RPC_PROTOCOL_VERSION = 1;
export const DEFAULT_VERSION = "unknown";
export const DEFAULT_SOCKET_ID = "0";
export const TIMESTAMP_PRECISION_THRESHOLD = 2;
export const TIMESTAMP_SECONDS_MAX = 10_000_000_000;
export const TIMESTAMP_MILLISECONDS_MAX = 10_000_000_000_000;
export const TIMESTAMP_MICROSECONDS_MAX = 10_000_000_000_000_000;
export const ACTIVITY_FLAG_INSTANCE = 1 << 0;

export const DISCORD_CDN_HOST = "cdn.discordapp.com";
export const DISCORD_API_ENDPOINT = "//discord.com/api";
export const DISCORD_ENVIRONMENT = "production";
export const ALLOWED_DISCORD_ORIGINS: readonly string[] = [
	"https://discord.com",
	"https://ptb.discord.com",
	"https://canary.discord.com",
];

export const PROCESS_SCAN_INTERVAL = 5000;
export const PATH_VARIATIONS_CACHE_MAX = 1000;
export const SCAN_RESULTS_CACHE_MAX = 500;
export const LOST_GAME_MISS_THRESHOLD = 2;
export const EXECUTABLE_ARCH_SUFFIXES = ["64", ".x64", "x64", "_64"] as const;
export const EXECUTABLE_EXACT_MATCH_PREFIX = ">";
export const LINUX_PROC_DIR = "/proc";
export const CMDLINE_NULL_SEPARATOR = "\0";
export const VALID_PLATFORMS = ["win32", "linux", "darwin"];

export const ANTI_CHEAT_EXECUTABLES = [
	"easyanticheat",
	"eac_launcher",
	"easyanticheat_eos",
	"battleye",
	"beclient",
	"nprotect",
	"xigncode",
	"gameguard",
	"vanguard",
	"anticheattoolkit",
];

export const STEAM_RUNTIME_PATHS = [
	"SteamLinuxRuntime",
	"Proton",
	"pressure-vessel",
	"steam-runtime",
	"compatibilitytools.d",
];

export const STEAM_LOOKUP_REBUILD_COOLDOWN_MS = 60_000;

export const STEAM_RESOLVED_PATH_CACHE_MAX = 1000;
export const STEAM_SKU_DISTRIBUTOR = "steam";
export const STEAM_LAUNCH_MARKER = "SteamLaunch";
export const STEAM_LAUNCH_APPID_REGEX = /^AppId=(\d{1,9})$/i;

export const STEAM_PATH_INDICATORS_LINUX = [
	"/.steam/",
	"/.local/share/steam/",
	"/steamapps/",
] as const;

export const STEAM_PATH_INDICATORS_WINDOWS_DARWIN = [
	"/steam/",
	"/steamapps/",
] as const;

export const DARWIN_APP_BOUNDARY_REGEX = /\.app(?=[/\s]|$)/i;

export function isSteamPath(pathLower: string): boolean {
	const normalizedPath = pathLower.replaceAll("\\", "/");
	const indicators =
		process.platform === "linux"
			? STEAM_PATH_INDICATORS_LINUX
			: STEAM_PATH_INDICATORS_WINDOWS_DARWIN;
	return indicators.some((indicator) => normalizedPath.includes(indicator));
}

export const SYSTEM_EXECUTABLES = new Set([
	"system",
	"registry",
	"smss.exe",
	"csrss.exe",
	"wininit.exe",
	"services.exe",
	"lsass.exe",
	"svchost.exe",
	"dwm.exe",
	"conhost.exe",
	"taskhost.exe",
	"winlogon.exe",
	"fontdrvhost.exe",
	"sihost.exe",
	"ctfmon.exe",
	"taskhostw.exe",
	"runtimebroker.exe",
	"searchindexer.exe",
	"searchprotocolhost.exe",
]);

export const ARRPC_BRAND_COLOR: [number, number, number] = [88, 101, 242];
export const SERVER_COLOR: [number, number, number] = [87, 242, 135];
export const BRIDGE_COLOR: [number, number, number] = [87, 242, 135];
export const IPC_COLOR: [number, number, number] = [254, 231, 92];
export const WEBSOCKET_COLOR: [number, number, number] = [235, 69, 158];
export const PROCESS_COLOR: [number, number, number] = [237, 66, 69];
export const STEAM_COLOR: [number, number, number] = [150, 100, 200];
export const CLI_COLOR: [number, number, number] = [100, 200, 255];
export const STATE_COLOR: [number, number, number] = [255, 200, 100];
export const IGNORE_LIST_COLOR: [number, number, number] = [255, 150, 50];

export const LOG_COLOR_WARN: [number, number, number] = [255, 200, 0];
export const LOG_COLOR_ERROR: [number, number, number] = [255, 80, 80];
export const LOG_COLOR_TIMESTAMP: [number, number, number] = [128, 128, 128];

export enum IPCMessageType {
	HANDSHAKE = 0,
	FRAME = 1,
	CLOSE = 2,
	PING = 3,
	PONG = 4,
}

export enum IPCCloseCode {
	CLOSE_NORMAL = 1000,
	CLOSE_UNSUPPORTED = 1003,
	CLOSE_ABNORMAL = 1006,
}

export enum IPCErrorCode {
	INVALID_CLIENTID = 4000,
	INVALID_ORIGIN = 4001,
	RATELIMITED = 4002,
	TOKEN_REVOKED = 4003,
	INVALID_VERSION = 4004,
	INVALID_ENCODING = 4005,
	INVALID_INVITE = 4011,
	INVALID_GUILD_TEMPLATE = 4017,
}

export enum RPCCommand {
	DISPATCH = "DISPATCH",
	SET_ACTIVITY = "SET_ACTIVITY",
	SUBSCRIBE = "SUBSCRIBE",
	UNSUBSCRIBE = "UNSUBSCRIBE",
	INVITE_BROWSER = "INVITE_BROWSER",
	GUILD_TEMPLATE_BROWSER = "GUILD_TEMPLATE_BROWSER",
	DEEP_LINK = "DEEP_LINK",
	CONNECTIONS_CALLBACK = "CONNECTIONS_CALLBACK",
}

export const RPC_GENERIC_ERROR_CODE = 1000;

export enum RPCEvent {
	READY = "READY",
	ERROR = "ERROR",
}

export enum ActivityType {
	PLAYING = 0,
	STREAMING = 1,
	LISTENING = 2,
	WATCHING = 3,
	CUSTOM = 4,
	COMPETING = 5,
}

export const DEFAULT_USER: User = {
	id: "1045800378228281345",
	username: "arrpc",
	discriminator: "0",
	global_name: "arRPC",
	avatar: "cfefa4d9839fb4bdf030f91c2a13e95c",
	avatar_decoration_data: null,
	bot: false,
	flags: 0,
	premium_type: 0,
};
