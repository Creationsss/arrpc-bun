import { rename, rm } from "node:fs/promises";
import { file, write } from "bun";
import { IGNORE_LIST_COLOR } from "./constants";
import { createLogger } from "./utils";

const log = createLogger("ignore-list", ...IGNORE_LIST_COLOR);

class IgnoreListManager {
	private ignoreSet: Set<string> = new Set();
	private filePath: string | null = null;
	private pendingOperation: Promise<void> | null = null;

	async initialize(filePath?: string): Promise<void> {
		if (filePath) {
			this.filePath = filePath;
			await this.loadFromFile();
		}
	}

	private async loadFromFile(): Promise<void> {
		if (!this.filePath) return;

		try {
			const f = file(this.filePath);
			if (await f.exists()) {
				const games = (await f.json()) as string[];

				if (!Array.isArray(games)) {
					log.info("invalid file format, expected array");
					return;
				}

				this.ignoreSet.clear();
				for (const game of games) {
					if (typeof game === "string") {
						this.ignoreSet.add(this.normalize(game));
					}
				}

				log.info(`loaded ${this.ignoreSet.size} entries from file`);
			}
		} catch (error) {
			log.error("failed to load from file:", error);
		}
	}

	private async saveToFile(): Promise<void> {
		if (!this.filePath) return;

		const tmpPath = `${this.filePath}.tmp`;
		try {
			const games = Array.from(this.ignoreSet);
			await write(tmpPath, JSON.stringify(games, null, 2));
			await rename(tmpPath, this.filePath);
		} catch (error) {
			log.error("failed to save to file:", error);
			await rm(tmpPath, { force: true }).catch(() => {});
		}
	}

	private normalize(value: string): string {
		return value.toLowerCase().trim();
	}

	private async withLock<T>(operation: () => Promise<T>): Promise<T> {
		while (this.pendingOperation) {
			await this.pendingOperation;
		}
		let resolve: (() => void) | undefined;
		this.pendingOperation = new Promise<void>((r) => {
			resolve = r;
		});
		try {
			return await operation();
		} finally {
			this.pendingOperation = null;
			resolve?.();
		}
	}

	async add(games: string[]): Promise<void> {
		return this.withLock(async () => {
			for (const game of games) {
				if (game && typeof game === "string") {
					this.ignoreSet.add(this.normalize(game));
				}
			}
			await this.saveToFile();
		});
	}

	async remove(games: string[]): Promise<void> {
		return this.withLock(async () => {
			for (const game of games) {
				if (game && typeof game === "string") {
					this.ignoreSet.delete(this.normalize(game));
				}
			}
			await this.saveToFile();
		});
	}

	async clear(): Promise<void> {
		return this.withLock(async () => {
			this.ignoreSet.clear();
			await this.saveToFile();
		});
	}

	getAll(): string[] {
		return Array.from(this.ignoreSet);
	}

	async reload(): Promise<{
		success: boolean;
		count?: number;
		error?: string;
	}> {
		if (!this.filePath) {
			return { success: false, error: "No file configured" };
		}

		return this.withLock(async () => {
			try {
				await this.loadFromFile();
				return { success: true, count: this.ignoreSet.size };
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error
							? error.message
							: "Unknown error",
				};
			}
		});
	}

	shouldIgnore(
		appId?: string,
		executable?: string,
		gameName?: string,
	): boolean {
		if (this.ignoreSet.size === 0) return false;

		if (appId && this.ignoreSet.has(this.normalize(appId))) {
			return true;
		}

		if (executable) {
			const execName = executable.split(/[/\\]/).pop() || executable;
			if (this.ignoreSet.has(this.normalize(execName))) {
				return true;
			}
		}

		if (gameName) {
			const normalizedName = this.normalize(gameName);
			for (const ignored of this.ignoreSet) {
				if (
					normalizedName.includes(ignored) ||
					ignored.includes(normalizedName)
				) {
					return true;
				}
			}
		}

		return false;
	}

	shouldIgnoreClientId(clientId: string): boolean {
		return this.ignoreSet.has(this.normalize(clientId));
	}
}

export const ignoreList = new IgnoreListManager();
