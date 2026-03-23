import { env } from "bun";
import {
	ENV_DEBUG,
	EXECUTABLE_ARCH_SUFFIXES,
	EXECUTABLE_EXACT_MATCH_PREFIX,
	getCustomDb,
	getDetectableDb,
	PROCESS_COLOR,
	PROCESS_SCAN_INTERVAL,
} from "../constants";
import { ignoreList } from "../ignore-list";
import type { DetectableApp, Handlers, Native } from "../types";
import { createLogger } from "../utils";
import * as Natives from "./native/index";
import { initSteamLookup } from "./steam";

const log = createLogger("process", ...PROCESS_COLOR);

let DetectableDB: DetectableApp[] = [];
const executableIndex: Map<string, DetectableApp[]> = new Map();
let dbLoaded = false;

function mergeCustomEntries(
	customEntries: Partial<DetectableApp>[],
	source: string,
): void {
	for (const customEntry of customEntries) {
		if (!customEntry.id) continue;

		const existingEntry = DetectableDB.find(
			(entry) => entry.id === customEntry.id,
		);

		if (existingEntry) {
			if (customEntry.executables) {
				if (!existingEntry.executables) {
					existingEntry.executables = [];
				}
				existingEntry.executables.push(...customEntry.executables);
			}
			if (customEntry.name) existingEntry.name = customEntry.name;
			if (customEntry.aliases)
				existingEntry.aliases = customEntry.aliases;
		} else {
			DetectableDB.push({
				id: customEntry.id,
				name: customEntry.name || "Custom Game",
				executables: customEntry.executables || [],
				aliases: customEntry.aliases || [],
				hook: customEntry.hook ?? false,
				overlay: customEntry.overlay ?? false,
				overlay_warn: customEntry.overlay_warn ?? false,
				overlay_compatibility_hook:
					customEntry.overlay_compatibility_hook ?? false,
				overlay_methods: customEntry.overlay_methods ?? null,
				icon_hash: customEntry.icon_hash || "",
				themes: customEntry.themes || [],
			});
		}
	}

	log.info(`loaded ${source} with`, customEntries.length, "entries");
}

function buildExecutableIndex(): void {
	executableIndex.clear();

	for (const app of DetectableDB) {
		if (!app.executables) continue;

		for (const exe of app.executables) {
			const exeName = exe.name.toLowerCase();
			const key = exeName.startsWith(EXECUTABLE_EXACT_MATCH_PREFIX)
				? exeName.substring(1)
				: exeName;

			let appList = executableIndex.get(key);
			if (!appList) {
				appList = [];
				executableIndex.set(key, appList);
			}
			appList.push(app);
		}

		if (process.platform === "darwin") {
			const appKey = app.name.toLowerCase();
			let appList = executableIndex.get(appKey);
			if (!appList) {
				appList = [];
				executableIndex.set(appKey, appList);
			}
			appList.push(app);
		}
	}

	log.info("built executable index with", executableIndex.size, "keys");
}

async function loadDatabase(onComplete?: () => void): Promise<void> {
	try {
		DetectableDB = (await getDetectableDb()) as DetectableApp[];

		try {
			const customEntries =
				(await getCustomDb()) as Partial<DetectableApp>[];
			mergeCustomEntries(customEntries, "detectable_fixes.json");
		} catch {}

		buildExecutableIndex();
		dbLoaded = true;
		log.info("database loaded with", DetectableDB.length, "entries");

		if (onComplete) {
			onComplete();
		}
	} catch (error) {
		log.error("failed to load database:", error);
	}
}

const NativeImpl = (Natives as Record<string, Native>)[process.platform] as
	| Native
	| undefined;

function argsContainString(args: string[], target: string): boolean {
	const targetLower = target.toLowerCase();

	for (let i = 0; i < args.length; i++) {
		const argLower = args[i]?.toLowerCase() || "";
		if (argLower.includes(targetLower)) return true;
	}

	for (let i = 0; i < args.length - 1; i++) {
		let combined = args[i]?.toLowerCase() || "";
		for (let j = i + 1; j < args.length && j < i + 5; j++) {
			combined += ` ${args[j]?.toLowerCase() || ""}`;
			if (combined.includes(targetLower)) return true;
		}
	}

	return false;
}

const appNameRegex = /.app_name$/;
function matchesExecutable(
	executable: {
		name: string;
		is_launcher?: boolean;
		arguments?: string;
		os?: string;
	},
	toCompare: string[],
	args: string[] | null,
	checkLauncher: boolean,
	checkAppName: boolean,
	strictArgs: boolean,
): boolean {
	if (executable.is_launcher !== checkLauncher) return false;

	const firstChar = executable.name[0];
	const firstCompare = toCompare[0];

	if (!firstChar || !firstCompare) return false;

	if (checkAppName) {
		if (appNameRegex.test(firstCompare)) {
			const appName = firstCompare
				.replace(appNameRegex, "")
				.toLowerCase();
			const executableNameLower = executable.name.toLowerCase();
			return executableNameLower === appName;
		}
	}

	const nameMatches =
		firstChar === EXECUTABLE_EXACT_MATCH_PREFIX
			? executable.name.substring(1) === firstCompare
			: toCompare.some((y) => executable.name === y);

	if (!nameMatches) return false;

	if (args && executable.arguments) {
		const argsMatch = argsContainString(args, executable.arguments);
		if (strictArgs) {
			return argsMatch;
		}
		if (firstChar === EXECUTABLE_EXACT_MATCH_PREFIX && !argsMatch) {
			return false;
		}
	}

	return true;
}

interface GameState {
	name: string;
	pid: number;
	timestamp: number;
}

export default class ProcessServer {
	private handlers!: Handlers;
	private gameState: Map<string, GameState> = new Map();
	private pathCache: Map<
		number,
		{ path: string; normalized: string; variations: string[] }
	> = new Map();
	private isScanning = false;
	private ignoredGames: Set<string> = new Set();

	constructor(handlers: Handlers) {
		if (!NativeImpl) return;

		this.handlers = handlers;
		this.scan = this.scan.bind(this);

		initSteamLookup();

		loadDatabase(() => {
			if (env[ENV_DEBUG]) {
				log.info("database ready, triggering first scan");
			}
			this.scan();
		});

		setInterval(this.scan, PROCESS_SCAN_INTERVAL);

		log.info("started");
	}

	private pathVariationsCache: Map<string, string[]> = new Map();

	private scanResultsCache: Map<string, string[]> = new Map();

	private createScanCacheKey(
		pathVariations: string[],
		args: string[],
	): string {
		return `${pathVariations.join("|")}::${args.join("|")}`;
	}

	private generatePathVariations(normalizedPath: string): string[] {
		const cached = this.pathVariationsCache.get(normalizedPath);
		if (cached) return cached;

		const toCompare: string[] = [];
		const splitPath = normalizedPath.split("/");

		for (let i = 1; i <= splitPath.length; i++) {
			toCompare.push(splitPath.slice(-i).join("/"));
		}

		const baseLength = toCompare.length;
		for (let i = 0; i < baseLength; i++) {
			const p = toCompare[i];
			if (!p) continue;
			for (const suffix of EXECUTABLE_ARCH_SUFFIXES) {
				if (p.includes(suffix)) {
					toCompare.push(p.replace(suffix, ""));
				}
			}
		}

		this.pathVariationsCache.set(normalizedPath, toCompare);

		if (this.pathVariationsCache.size > 1000) {
			const firstKey = this.pathVariationsCache.keys().next().value;
			if (firstKey) this.pathVariationsCache.delete(firstKey);
		}

		return toCompare;
	}

	private handleDetectedGame(
		id: string,
		name: string,
		pid: number,
		_path: string,
		processedInThisScan: Set<string>,
		matchSource: string,
	): "ignored" | "already_processed" | "processed" {
		const shouldIgnore = ignoreList.shouldIgnore(id, _path, name);

		if (shouldIgnore) {
			if (env[ENV_DEBUG] && !this.ignoredGames.has(id)) {
				log.info("ignoring game:", name);
			}
			this.ignoredGames.add(id);
			return "ignored";
		}

		this.ignoredGames.delete(id);

		if (processedInThisScan.has(id)) {
			return "already_processed";
		}
		processedInThisScan.add(id);

		const state = this.gameState.get(id);
		const isNewDetection = !state;
		const oldPid = state?.pid;
		const pidChanged = oldPid !== pid;

		if (isNewDetection || pidChanged) {
			if (isNewDetection) {
				log.info("detected game!", name);
				if (env[ENV_DEBUG]) {
					log.info(`  game id: ${id}`);
					log.info(`  process pid: ${pid}`);
					log.info(`  process path: ${_path}`);
					log.info(`  matched: ${name} ${matchSource}`);
				}
			} else if (pidChanged) {
				log.info("game restarted!", name);
				if (env[ENV_DEBUG]) {
					log.info(`  old PID: ${oldPid}`);
					log.info(`  new PID: ${pid}`);
				}
			}

			const newTimestamp = Date.now();
			this.gameState.set(id, {
				name,
				pid,
				timestamp: newTimestamp,
			});

			this.handlers.activity(
				id,
				{
					application_id: id,
					name,
					timestamps: {
						start: newTimestamp,
					},
				},
				pid,
				name,
			);
		}

		return "processed";
	}

	private getCandidateApps(pathVariations: string[]): DetectableApp[] {
		const hasAppName = pathVariations.some((path) =>
			path.includes(".app_name"),
		);
		if (hasAppName) {
			return DetectableDB;
		}

		const candidateSet = new Set<DetectableApp>();

		for (const pathVar of pathVariations) {
			const apps = executableIndex.get(pathVar);
			if (apps) {
				for (const app of apps) {
					candidateSet.add(app);
				}
			}

			const lastSlash = pathVar.lastIndexOf("/");
			const filename =
				lastSlash >= 0 ? pathVar.substring(lastSlash + 1) : pathVar;
			const dotIndex = filename.lastIndexOf(".");
			if (dotIndex > 0) {
				const withoutExt = filename.substring(0, dotIndex);
				const appsNoExt = executableIndex.get(withoutExt);
				if (appsNoExt) {
					for (const app of appsNoExt) {
						candidateSet.add(app);
					}
				}
			}
		}

		return Array.from(candidateSet);
	}

	async scan(): Promise<void> {
		if (!NativeImpl || !dbLoaded) return;

		if (this.isScanning) {
			if (env[ENV_DEBUG]) {
				log.info("scan already in progress, skipping");
			}
			return;
		}

		this.isScanning = true;

		if (env[ENV_DEBUG]) {
			log.info("scan started");
		}

		try {
			const processes = await NativeImpl.getProcesses();
			const ids = new Set<string>();
			const activePids = new Set<number>();
			const processedInThisScan = new Set<string>();

			for (const [pid, _path, args] of processes) {
				activePids.add(pid);

				let cached = this.pathCache.get(pid);
				const normalizedPath = _path
					.toLowerCase()
					.replaceAll("\\", "/");

				if (!cached || cached.path !== _path) {
					const variations =
						this.generatePathVariations(normalizedPath);
					cached = {
						path: _path,
						normalized: normalizedPath,
						variations,
					};
					this.pathCache.set(pid, cached);
				}

				const toCompare = cached.variations;

				const cacheKey = this.createScanCacheKey(toCompare, args);
				const cachedResults = this.scanResultsCache.get(cacheKey);

				if (cachedResults) {
					for (const id of cachedResults) ids.add(id);

					for (const id of cachedResults) {
						const state = this.gameState.get(id);
						const name =
							state?.name ??
							DetectableDB.find((app) => app.id === id)?.name;
						if (!name) continue;

						this.handleDetectedGame(
							id,
							name,
							pid,
							_path,
							processedInThisScan,
							"(from cache)",
						);
					}
					continue;
				}

				const matchedIds: string[] = [];
				const candidateApps = this.getCandidateApps(toCompare);

				for (const { executables, id, name } of candidateApps) {
					let matched = false;

					if (
						matchesExecutable(
							{ name, is_launcher: false },
							toCompare,
							args,
							false,
							true,
							false,
						)
					) {
						matched = true;
					}

					if (!matched && executables) {
						for (const exe of executables) {
							if (
								matchesExecutable(
									exe,
									toCompare,
									args,
									false,
									false,
									true,
								) ||
								matchesExecutable(
									exe,
									toCompare,
									args,
									true,
									false,
									true,
								)
							) {
								matched = true;
								break;
							}
						}

						if (!matched) {
							for (const exe of executables) {
								if (
									matchesExecutable(
										exe,
										toCompare,
										args,
										false,
										false,
										false,
									) ||
									matchesExecutable(
										exe,
										toCompare,
										args,
										true,
										false,
										false,
									)
								) {
									matched = true;
									break;
								}
							}
						}
					}

					if (matched) {
						matchedIds.push(id);

						this.handleDetectedGame(
							id,
							name,
							pid,
							_path,
							processedInThisScan,
							"(in path variations)",
						);

						ids.add(id);
						break;
					}
				}

				if (matchedIds.length > 0) {
					this.scanResultsCache.set(cacheKey, matchedIds);
				}
			}

			if (this.scanResultsCache.size > 500) {
				const firstKey = this.scanResultsCache.keys().next().value;
				if (firstKey) this.scanResultsCache.delete(firstKey);
			}

			for (const cachedPid of this.pathCache.keys()) {
				if (!activePids.has(cachedPid)) {
					this.pathCache.delete(cachedPid);
				}
			}

			for (const [id, state] of this.gameState) {
				if (!ids.has(id)) {
					log.info("lost game!", state.name);
					this.handlers.activity(id, null, state.pid);
					this.gameState.delete(id);
				}
			}

			for (const id of this.ignoredGames) {
				if (!ids.has(id)) {
					this.ignoredGames.delete(id);
				}
			}
		} finally {
			if (env[ENV_DEBUG]) {
				log.info("scan completed");
			}
			this.isScanning = false;
		}
	}
}
