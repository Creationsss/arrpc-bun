import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { env, file, Glob } from "bun";
import {
	ENV_DEBUG,
	ENV_NO_STEAM,
	STEAM_COLOR,
	STEAM_LOOKUP_REBUILD_COOLDOWN_MS,
	STEAM_RUNTIME_PATHS,
} from "../constants";
import type { SteamLibrary } from "../types";
import { createLogger } from "../utils";

const log = createLogger("steam", ...STEAM_COLOR);

const defaultSteamPaths =
	process.platform === "darwin"
		? [resolve(homedir(), "Library", "Application Support", "Steam")]
		: process.platform === "win32"
			? [
					resolve(
						env["ProgramFiles(x86)"] ??
							join("C:", "Program Files (x86)"),
						"Steam",
					),
				]
			: [
					resolve(homedir(), ".steam", "steam"),
					resolve(homedir(), ".local", "share", "Steam"),
				];

function extractNestedBlock(content: string, startPos: number): string | null {
	let depth = 0;
	let start = -1;

	for (let i = startPos; i < content.length; i++) {
		if (content[i] === "{") {
			if (depth === 0) start = i + 1;
			depth++;
		} else if (content[i] === "}") {
			depth--;
			if (depth === 0 && start !== -1) {
				return content.substring(start, i);
			}
		}
	}

	return null;
}

async function scanLibraryManifests(steamappsPath: string): Promise<string[]> {
	const apps: string[] = [];
	const glob = new Glob("appmanifest_*.acf");

	for await (const manifestFile of glob.scan({ cwd: steamappsPath })) {
		const match = manifestFile.match(/appmanifest_(\d+)\.acf/);
		if (match?.[1]) {
			apps.push(match[1]);
		}
	}

	return apps;
}

async function parseSteamLibraries(): Promise<SteamLibrary[]> {
	const libraries: SteamLibrary[] = [];

	for (const steamPath of defaultSteamPaths) {
		const vdfPath = join(steamPath, "steamapps", "libraryfolders.vdf");

		if (env[ENV_DEBUG])
			log.info("checking for libraryfolders.vdf at", vdfPath);

		let content: string;
		try {
			content = await file(vdfPath).text();
		} catch (error) {
			if (env[ENV_DEBUG]) log.info("failed to read", vdfPath, error);
			continue;
		}

		const libraryIdMatches = content.matchAll(/"(\d+)"\s*\{/g);

		for (const match of libraryIdMatches) {
			const libraryId = match[1];
			if (!libraryId) continue;

			const libraryBlock = extractNestedBlock(
				content,
				match.index + match[0].length - 1,
			);
			if (!libraryBlock) continue;

			const pathMatch = libraryBlock.match(/"path"\s+"([^"]+)"/);
			if (!pathMatch?.[1]) continue;

			const libraryPath = pathMatch[1];
			const steamappsPath = join(libraryPath, "steamapps");

			try {
				const apps = await scanLibraryManifests(steamappsPath);
				if (apps.length > 0) {
					libraries.push({ path: libraryPath, apps });
				}
			} catch (error) {
				if (env[ENV_DEBUG])
					log.info("failed to scan library", steamappsPath, error);
			}
		}

		if (libraries.length > 0) {
			if (env[ENV_DEBUG]) {
				log.info(`found ${libraries.length} Steam libraries:`);
				for (const lib of libraries) {
					log.info(`  - ${lib.path} (${lib.apps.length} apps)`);
				}
			}
			break;
		}
	}

	if (libraries.length === 0 && env[ENV_DEBUG]) {
		log.info("no Steam libraries found");
	}

	return libraries;
}

async function parseAppManifest(
	manifestPath: string,
): Promise<{ name: string; installdir: string } | null> {
	try {
		const text = await file(manifestPath).text();
		const name = text.match(/"name"\s+"([^"]+)"/)?.[1];
		const installdir = text.match(/"installdir"\s+"([^"]+)"/)?.[1];

		if (name && installdir) {
			return { name, installdir };
		}
	} catch {}

	return null;
}

let steamAppLookup: Map<string, string> | null = null;
let steamAppLookupPromise: Promise<Map<string, string>> | null = null;
let steamAppLookupBuiltAt = 0;
const resolvedPathCache: Map<string, string | null> = new Map();

async function processBatched<T, R>(
	items: T[],
	batchSize: number,
	processor: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		const batchResults = await Promise.all(batch.map(processor));
		results.push(...batchResults);
	}
	return results;
}

async function processLibraryApps<T>(
	library: SteamLibrary,
	processor: (
		appid: string,
		steamappsPath: string,
		manifest: { name: string; installdir: string },
	) => T,
): Promise<T[]> {
	const steamappsPath = join(library.path, "steamapps");
	const results = await processBatched(library.apps, 50, async (appid) => {
		const manifestPath = join(steamappsPath, `appmanifest_${appid}.acf`);
		const manifest = await parseAppManifest(manifestPath);
		return manifest ? processor(appid, steamappsPath, manifest) : null;
	});
	return results.filter((r): r is T => r !== null);
}

async function buildSteamLookup(): Promise<Map<string, string>> {
	if (env[ENV_DEBUG]) log.info("building Steam app lookup table...");

	const libraries = await parseSteamLibraries();
	const lookup = new Map<string, string>();

	for (const library of libraries) {
		const results = await processLibraryApps(
			library,
			(_appid, steamappsPath, manifest) => {
				const installPath = join(
					steamappsPath,
					"common",
					manifest.installdir,
				);
				return [installPath, manifest.name] as [string, string];
			},
		);

		for (const [path, name] of results) {
			lookup.set(path, name);
		}
	}

	if (env[ENV_DEBUG]) {
		log.info(`built lookup table with ${lookup.size} Steam apps`);
	}

	return lookup;
}

function ensureSteamLookupPromise(): Promise<Map<string, string>> {
	if (steamAppLookupPromise) return steamAppLookupPromise;

	steamAppLookupPromise = buildSteamLookup()
		.catch((error) => {
			if (env[ENV_DEBUG]) {
				log.info("failed to build Steam lookup:", error);
			}
			return new Map<string, string>();
		})
		.then((lookup) => {
			steamAppLookup = lookup;
			steamAppLookupBuiltAt = Date.now();
			return lookup;
		});

	return steamAppLookupPromise;
}

async function maybeRebuildEmptyLookup(): Promise<void> {
	if (!steamAppLookup || steamAppLookup.size > 0) return;
	if (Date.now() - steamAppLookupBuiltAt < STEAM_LOOKUP_REBUILD_COOLDOWN_MS) {
		return;
	}

	if (env[ENV_DEBUG]) {
		log.info("Steam lookup empty; retrying build");
	}
	steamAppLookup = null;
	steamAppLookupPromise = null;
	await ensureSteamLookupPromise();
}

export function initSteamLookup(): void {
	if (env[ENV_NO_STEAM]) {
		if (env[ENV_DEBUG]) {
			log.info("Steam support disabled via ARRPC_NO_STEAM");
		}
		return;
	}

	if (!steamAppLookup) {
		ensureSteamLookupPromise();
	}
}

export async function resolveSteamApp(
	processPath: string,
): Promise<string | null> {
	if (env[ENV_NO_STEAM]) {
		return null;
	}

	if (resolvedPathCache.has(processPath)) {
		return resolvedPathCache.get(processPath) ?? null;
	}

	if (!steamAppLookup) {
		await ensureSteamLookupPromise();
		if (!steamAppLookup) {
			return null;
		}
	}

	await maybeRebuildEmptyLookup();

	let normalizedPath = processPath;
	const isWinePath =
		processPath.startsWith("Z:\\") || processPath.startsWith("z:\\");
	if (isWinePath) {
		normalizedPath = processPath.substring(2).replace(/\\/g, "/");
	}

	if (process.platform === "win32") {
		normalizedPath = normalizedPath.replace(/\//g, "\\").toLowerCase();
	}

	const isRuntimeProcess = STEAM_RUNTIME_PATHS.some((runtimePath) =>
		normalizedPath.includes(runtimePath),
	);
	if (isRuntimeProcess) {
		if (env[ENV_DEBUG]) {
			log.info(
				`skipping Steam runtime/infrastructure process: ${processPath}`,
			);
		}
		resolvedPathCache.set(processPath, null);
		return null;
	}

	const lookup = steamAppLookup;
	if (!lookup) return null;

	for (const [installPath, appName] of lookup) {
		const compareInstallPath =
			process.platform === "win32"
				? installPath.toLowerCase()
				: installPath;
		if (normalizedPath.startsWith(compareInstallPath)) {
			const resolvedPath = join(installPath, `${appName}.app_name`);
			if (env[ENV_DEBUG]) {
				if (isWinePath) {
					log.info(
						`normalized Wine path: ${processPath} -> ${normalizedPath}`,
					);
				}
				log.info(`detected Steam app: "${appName}"`);
				log.info(`  process path: ${processPath}`);
				log.info(`  resolved to: ${resolvedPath}`);
			}
			resolvedPathCache.set(processPath, resolvedPath);
			return resolvedPath;
		}
	}

	if (lookup.size > 0) {
		resolvedPathCache.set(processPath, null);
	}
	return null;
}
