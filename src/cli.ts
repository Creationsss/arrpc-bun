import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, file } from "bun";
import {
	BRIDGE_PORT_RANGE,
	BRIDGE_PORT_RANGE_HYPERV,
	CLI_COLOR,
	DEFAULT_LOCALHOST,
	ENV_BRIDGE_HOST,
	ENV_BRIDGE_PORT,
	getDetectableDb,
	STATE_FILE_MAX_INDEX,
	STATE_FILE_PREFIX,
} from "./constants";
import { createLogger, print, printError } from "./logger";
import { isHyperVEnabled } from "./platform";
import type {
	ActivityPayload,
	DetectableApp,
	GameDisplayInfo,
	StateFileContent,
} from "./types";
import { formatDuration, getPortRange } from "./utils";

const log = createLogger("cli", ...CLI_COLOR);

async function readStateFile(): Promise<StateFileContent | null> {
	const tempDir = tmpdir();

	for (let i = 0; i <= STATE_FILE_MAX_INDEX; i++) {
		const path = join(tempDir, `${STATE_FILE_PREFIX}-${i}`);
		const f = file(path);

		if (await f.exists()) {
			try {
				const content = (await f.json()) as StateFileContent;
				const age = Date.now() - content.timestamp;
				if (age < 10000) {
					return content;
				}
			} catch {}
		}
	}

	return null;
}

async function getBridgePort(): Promise<{ host: string; port: number }> {
	const hostname = env[ENV_BRIDGE_HOST] || DEFAULT_LOCALHOST;

	if (env[ENV_BRIDGE_PORT]) {
		const envPort = Number.parseInt(env[ENV_BRIDGE_PORT], 10);
		if (!Number.isNaN(envPort)) {
			return { host: hostname, port: envPort };
		}
	}

	const useHyperVRange = isHyperVEnabled();
	const portRange = getPortRange(
		BRIDGE_PORT_RANGE,
		BRIDGE_PORT_RANGE_HYPERV,
		useHyperVRange,
	);

	for (let port = portRange[0]; port <= portRange[1]; port++) {
		try {
			const ws = new WebSocket(`ws://${hostname}:${port}`);
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					ws.close();
					reject(new Error("timeout"));
				}, 1000);

				ws.onopen = () => {
					clearTimeout(timeout);
					ws.close();
					resolve();
				};

				ws.onerror = () => {
					clearTimeout(timeout);
					reject(new Error("connection failed"));
				};
			});
			return { host: hostname, port };
		} catch {}
	}

	throw new Error(
		`Could not connect to arrpc bridge. Is arrpc running?\nTried ports ${portRange[0]}-${portRange[1]} on ${hostname}`,
	);
}

export async function listDatabase(): Promise<void> {
	print("Loading detectable games database...\n");

	const db = (await getDetectableDb()) as DetectableApp[];

	print(`Total games in database: ${db.length.toLocaleString()}\n`);

	const platforms = {
		win32: 0,
		linux: 0,
		darwin: 0,
		multiplatform: 0,
	};

	for (const app of db) {
		if (!app.executables || app.executables.length === 0) {
			continue;
		}

		const appPlatforms = new Set(
			app.executables
				.map((exe) => exe.os || "multiplatform")
				.filter(
					(os) => os === "win32" || os === "linux" || os === "darwin",
				),
		);

		if (appPlatforms.size === 0 || appPlatforms.size > 1) {
			platforms.multiplatform++;
		} else {
			const platform = Array.from(appPlatforms)[0] as
				| "win32"
				| "linux"
				| "darwin";
			platforms[platform]++;
		}
	}

	print("Games by platform:");
	print(`  Windows:        ${platforms.win32.toLocaleString()}`);
	print(`  Linux:          ${platforms.linux.toLocaleString()}`);
	print(`  macOS:          ${platforms.darwin.toLocaleString()}`);
	print(`  Multi-platform: ${platforms.multiplatform.toLocaleString()}`);
	print("");

	print("Example games (first 10):");
	for (let i = 0; i < Math.min(10, db.length); i++) {
		const app = db[i];
		if (!app) continue;
		const exeCount = app.executables?.length || 0;
		const platforms = app.executables
			?.map((exe) => exe.os || "all")
			.filter((v, i, a) => a.indexOf(v) === i)
			.join(", ");
		print(
			`  ${i + 1}. ${app.name} (${exeCount} executables, platforms: ${platforms || "all"})`,
		);
	}

	print("\nTo see currently detected games, run with --list-detected");
}

export async function listDetected(): Promise<void> {
	const stateFile = await readStateFile();
	if (stateFile && stateFile.activities.length > 0) {
		print("Reading from arrpc state file...\n");
		displayDetectedGames(stateFile);
		return;
	}

	print("Connecting to arrpc bridge...\n");

	let bridgeInfo: { host: string; port: number };
	try {
		bridgeInfo = await getBridgePort();
	} catch (error) {
		const err = error as Error;
		printError(`Error: ${err.message}`);
		printError("\nNo state file found and bridge is not available.");
		printError("Make sure arrpc is running.");
		process.exit(1);
	}

	log.info(
		`found bridge at ${bridgeInfo.host}:${bridgeInfo.port}, connecting...`,
	);

	const ws = new WebSocket(`ws://${bridgeInfo.host}:${bridgeInfo.port}`);

	const detected = new Map<string, ActivityPayload>();

	await new Promise<void>((resolve) => {
		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(
					event.data as string,
				) as ActivityPayload;
				if (data.activity) {
					detected.set(data.socketId, data);
				} else {
					detected.delete(data.socketId);
				}
			} catch (error) {
				log.error("failed to parse message:", error);
			}
		};

		ws.onopen = () => {
			log.info("connected, waiting for activity data...");

			setTimeout(() => {
				ws.close();
				resolve();
			}, 500);
		};

		ws.onerror = (error) => {
			printError("WebSocket error:", error);
			process.exit(1);
		};

		ws.onclose = () => {
			resolve();
		};
	});

	displayDetectedGamesFromMap(detected);
}

function displayDetectedGamesList(games: GameDisplayInfo[]): void {
	print("\nCurrently detected games:\n");

	if (games.length === 0) {
		print("  No games currently detected.");
		print(
			"\n  Tip: Start a game and run this command again to see it detected.",
		);
		return;
	}

	for (let i = 0; i < games.length; i++) {
		const game = games[i];
		if (!game) continue;

		print(`  ${i + 1}. ${game.name}`);
		print(`     App ID: ${game.appId}`);
		print(`     PID: ${game.pid}`);
		print(`     Socket: ${game.socketId}`);
		if (game.startTime) {
			print(`     Duration: ${formatDuration(game.startTime)}`);
		}
		print("");
	}
}

function displayDetectedGames(stateFile: StateFileContent): void {
	const games: GameDisplayInfo[] = stateFile.activities.map((activity) => ({
		name: activity.name,
		appId: activity.applicationId,
		pid: activity.pid,
		socketId: activity.socketId,
		startTime: activity.startTime,
	}));
	displayDetectedGamesList(games);
}

function displayDetectedGamesFromMap(
	detected: Map<string, ActivityPayload>,
): void {
	const games: GameDisplayInfo[] = [];
	for (const [socketId, payload] of detected) {
		const { activity, pid } = payload;
		if (!activity) continue;

		games.push({
			name: (activity as { name?: string }).name || "Unknown",
			appId: (activity as { application_id?: string }).application_id,
			pid: pid ?? 0,
			socketId,
			startTime: (activity as { timestamps?: { start?: number } })
				.timestamps?.start,
		});
	}
	displayDetectedGamesList(games);
}
