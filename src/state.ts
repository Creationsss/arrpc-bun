import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "bun";
import {
	ENV_DEBUG,
	STATE_COLOR,
	STATE_FILE_MAX_INDEX,
	STATE_FILE_PREFIX,
} from "./constants";
import type {
	ActivityPayload,
	ServerInfo,
	Servers,
	StateFileContent,
} from "./types";
import { createLogger } from "./utils";

const log = createLogger("state", ...STATE_COLOR);

class StateManager {
	private activities = new Map<string, ActivityPayload>();
	private servers: Servers = {};
	private stateFilePath: string | null = null;
	private appVersion = "unknown";
	private writeDebounceTimer: Timer | null = null;
	private readonly DEBOUNCE_MS = 100;

	initialize(): void {
		const tempDir = tmpdir();

		for (let i = 0; i <= STATE_FILE_MAX_INDEX; i++) {
			const path = join(tempDir, `${STATE_FILE_PREFIX}-${i}`);

			if (existsSync(path)) {
				try {
					const content = JSON.parse(
						readFileSync(path, "utf-8"),
					) as StateFileContent;
					const age = Date.now() - content.timestamp;
					if (age > 10000) {
						this.stateFilePath = path;
						break;
					}
				} catch {
					this.stateFilePath = path;
					break;
				}
			} else {
				this.stateFilePath = path;
				break;
			}
		}

		if (!this.stateFilePath) {
			log.warn(`all state file slots in use (0-${STATE_FILE_MAX_INDEX})`);
			this.stateFilePath = join(
				tempDir,
				`${STATE_FILE_PREFIX}-${process.pid}`,
			);
		}

		if (env[ENV_DEBUG]) {
			log.info(`state file path: ${this.stateFilePath}`);
		}
	}

	setAppVersion(version: string): void {
		this.appVersion = version;
	}

	getStateFilePath(): string | null {
		return this.stateFilePath;
	}

	setServer(type: "bridge" | "websocket", info: ServerInfo): void {
		this.servers[type] = info;
		this.scheduleWrite();
	}

	setIpcServer(socketPath: string): void {
		this.servers.ipc = { socketPath };
		this.scheduleWrite();
	}

	update(payload: ActivityPayload): void {
		if (payload.activity) {
			this.activities.set(payload.socketId, payload);
		} else {
			this.activities.delete(payload.socketId);
		}
		this.scheduleWrite();
	}

	private scheduleWrite(): void {
		if (this.writeDebounceTimer) {
			clearTimeout(this.writeDebounceTimer);
		}
		this.writeDebounceTimer = setTimeout(() => {
			this.writeToFile();
		}, this.DEBOUNCE_MS);
	}

	private writeToFile(): void {
		if (!this.stateFilePath) return;

		const content: StateFileContent = {
			appVersion: this.appVersion,
			timestamp: Date.now(),
			servers: this.servers,
			activities: [],
		};

		for (const [socketId, payload] of this.activities) {
			if (!payload.activity) continue;

			const activity = payload.activity as {
				name?: string;
				application_id?: string;
				timestamps?: { start?: number };
			};

			content.activities.push({
				socketId,
				name: activity.name || "Unknown",
				applicationId: activity.application_id || "",
				pid: payload.pid ?? 0,
				startTime: activity.timestamps?.start || null,
			});
		}

		try {
			writeFileSync(
				this.stateFilePath,
				JSON.stringify(content, null, 2),
				"utf-8",
			);
			if (env[ENV_DEBUG]) {
				log.info(
					`wrote state file: ${content.activities.length} activities`,
				);
			}
		} catch (error) {
			log.error(`failed to write state file: ${error}`);
		}
	}

	cleanup(): void {
		if (this.writeDebounceTimer) {
			clearTimeout(this.writeDebounceTimer);
		}
		if (!this.stateFilePath) return;

		try {
			if (existsSync(this.stateFilePath)) {
				unlinkSync(this.stateFilePath);
				if (env[ENV_DEBUG]) {
					log.info("cleaned up state file");
				}
			}
		} catch (error) {
			log.error(`failed to cleanup state file: ${error}`);
		}
	}
}

export const stateManager = new StateManager();
