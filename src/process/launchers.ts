import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { env, file } from "bun";
import {
	ENV_DEBUG,
	ENV_NO_LAUNCHERS,
	LAUNCHER_COLOR,
	LAUNCHER_REFRESH_INTERVAL_MS,
	LAUNCHER_RESOLVED_PATH_CACHE_MAX,
	loadJson,
} from "../constants";
import { createLazyLookup, createLogger, setCapped } from "../utils";
import { findByInstallPath, normalizeInstallComparePath } from "./install-path";

const log = createLogger("launchers", ...LAUNCHER_COLOR);

const home = homedir();

const heroicConfigDirs = [
	join(home, ".config", "heroic"),
	join(
		home,
		".var",
		"app",
		"com.heroicgameslauncher.hgl",
		"config",
		"heroic",
	),
];

const lutrisDatabases = [
	join(home, ".local", "share", "lutris", "pga.db"),
	join(home, ".var", "app", "net.lutris.Lutris", "data", "lutris", "pga.db"),
];

const resolvedPathCache: Map<string, string | null> = new Map();

function cacheResolution(processPath: string, resolved: string | null): void {
	setCapped(
		resolvedPathCache,
		processPath,
		resolved,
		LAUNCHER_RESOLVED_PATH_CACHE_MAX,
	);
}

function readJson<T>(path: string): Promise<T | null> {
	return loadJson<T | null>(path, null);
}

function addGame(
	lookup: Map<string, string>,
	installPath: unknown,
	title: unknown,
	source: string,
): void {
	if (typeof installPath !== "string" || typeof title !== "string") return;
	if (!installPath || !title) return;
	if (lookup.has(installPath)) return;

	lookup.set(installPath, title);

	if (env[ENV_DEBUG]) {
		log.info(`  ${source}: ${title} -> ${installPath}`);
	}
}

async function loadHeroicEpic(
	lookup: Map<string, string>,
	configDir: string,
): Promise<void> {
	const installed = await readJson<
		Record<string, { install_path?: string; title?: string }>
	>(join(configDir, "legendaryConfig", "legendary", "installed.json"));
	if (!installed) return;

	for (const game of Object.values(installed)) {
		addGame(lookup, game?.install_path, game?.title, "heroic/epic");
	}
}

async function loadHeroicGog(
	lookup: Map<string, string>,
	configDir: string,
): Promise<void> {
	const store = await readJson<{
		installed?: Array<{ install_path?: string; appName?: string }>;
	}>(join(configDir, "gog_store", "installed.json"));
	if (!store?.installed) return;

	const library = await readJson<{
		games?: Array<{ app_name?: string; title?: string }>;
	}>(join(configDir, "store_cache", "gog_library.json"));

	const titles = new Map<string, string>();
	for (const game of library?.games ?? []) {
		if (game?.app_name && game?.title)
			titles.set(game.app_name, game.title);
	}

	for (const game of store.installed) {
		const title = game?.appName ? titles.get(game.appName) : undefined;
		addGame(lookup, game?.install_path, title, "heroic/gog");
	}
}

async function loadHeroicSideload(
	lookup: Map<string, string>,
	configDir: string,
): Promise<void> {
	const library = await readJson<{
		games?: Array<{ title?: string; install?: { executable?: string } }>;
	}>(join(configDir, "sideload_apps", "library.json"));
	if (!library?.games) return;

	for (const game of library.games) {
		const executable = game?.install?.executable;
		if (!executable) continue;
		addGame(lookup, dirname(executable), game?.title, "heroic/sideload");
	}
}

function loadLutris(lookup: Map<string, string>, dbPath: string): void {
	let db: Database | undefined;
	try {
		db = new Database(dbPath, { readonly: true });
		const rows = db
			.query(
				"select name, directory, executable from games where installed = 1",
			)
			.all() as Array<{
			name: string | null;
			directory: string | null;
			executable: string | null;
		}>;

		for (const row of rows) {
			if (!row.name) continue;

			addGame(lookup, row.directory, row.name, "lutris");

			if (!row.executable) continue;

			const executableDir = dirname(row.executable);
			if (!row.directory || !executableDir.startsWith(row.directory)) {
				addGame(lookup, executableDir, row.name, "lutris");
			}
		}
	} catch (error) {
		if (env[ENV_DEBUG]) log.info(`failed to read ${dbPath}:`, error);
	} finally {
		db?.close();
	}
}

async function buildLauncherLookup(): Promise<Map<string, string>> {
	if (env[ENV_DEBUG]) log.info("building launcher lookup table...");

	const lookup = new Map<string, string>();

	for (const configDir of heroicConfigDirs) {
		await loadHeroicEpic(lookup, configDir);
		await loadHeroicGog(lookup, configDir);
		await loadHeroicSideload(lookup, configDir);
	}

	for (const dbPath of lutrisDatabases) {
		if (await file(dbPath).exists()) loadLutris(lookup, dbPath);
	}

	if (lookup.size > 0) {
		log.info("built launcher lookup with", lookup.size, "games");
	} else if (env[ENV_DEBUG]) {
		log.info("no launcher games found");
	}

	return lookup;
}

const launcherLookup = createLazyLookup(
	() => buildLauncherLookup(),
	() => new Map<string, string>(),
	(error) => {
		if (env[ENV_DEBUG]) log.info("failed to build lookup:", error);
	},
);

export function initLauncherLookup(): void {
	if (env[ENV_NO_LAUNCHERS]) {
		if (env[ENV_DEBUG]) {
			log.info("launcher detection disabled via ARRPC_NO_LAUNCHERS");
		}
		return;
	}

	if (!launcherLookup.get()) launcherLookup.ensure();
}

async function maybeRefresh(): Promise<void> {
	if (Date.now() - launcherLookup.builtAt() < LAUNCHER_REFRESH_INTERVAL_MS) {
		return;
	}

	launcherLookup.invalidate();
	resolvedPathCache.clear();
	await launcherLookup.ensure();
}

export async function resolveLauncherApp(
	processPath: string,
): Promise<string | null> {
	if (env[ENV_NO_LAUNCHERS]) return null;

	if (resolvedPathCache.has(processPath)) {
		return resolvedPathCache.get(processPath) ?? null;
	}

	if (!launcherLookup.get()) await launcherLookup.ensure();
	await maybeRefresh();

	const lookup = launcherLookup.get();
	if (!lookup || lookup.size === 0) return null;

	const normalizedPath = normalizeInstallComparePath(processPath);
	const hit = findByInstallPath(lookup, normalizedPath);

	if (!hit) {
		cacheResolution(processPath, null);
		return null;
	}

	const resolved = join(hit.installPath, `${hit.value}.app_name`);

	if (env[ENV_DEBUG]) {
		log.info(`detected launcher game: "${hit.value}"`);
		log.info(`  process path: ${processPath}`);
		log.info(`  resolved to: ${resolved}`);
	}

	cacheResolution(processPath, resolved);
	return resolved;
}
