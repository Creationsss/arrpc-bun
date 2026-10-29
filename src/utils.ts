import {
	TIMESTAMP_MICROSECONDS_MAX,
	TIMESTAMP_MILLISECONDS_MAX,
	TIMESTAMP_SECONDS_MAX,
} from "./constants";
import type { PortBindOptions } from "./types";

export { createLogger, logger, print, printError } from "./logger";

function parseTimestampToMs(value: unknown): number | null {
	let raw: number;
	if (typeof value === "number") {
		raw = value;
	} else if (typeof value === "string") {
		raw = Number(value);
	} else {
		return null;
	}

	if (!Number.isFinite(raw) || raw < 0) return null;

	if (raw < TIMESTAMP_SECONDS_MAX) return Math.floor(raw * 1000);
	if (raw < TIMESTAMP_MILLISECONDS_MAX) return Math.floor(raw);
	if (raw < TIMESTAMP_MICROSECONDS_MAX) return Math.floor(raw / 1_000);
	return Math.floor(raw / 1_000_000);
}

export function normalizeTimestamps(
	timestamps: Record<string, unknown> | undefined,
): void {
	if (!timestamps) return;

	for (const key of Object.keys(timestamps)) {
		const ms = parseTimestampToMs(timestamps[key]);
		if (ms !== null) {
			timestamps[key] = ms;
		}
	}
}

export function formatDuration(startTime: number): string {
	const elapsed = Date.now() - startTime;
	const minutes = Math.floor(elapsed / 60000);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) {
		return `running for ${hours}h ${minutes % 60}m`;
	}
	return `running for ${minutes}m`;
}

export function setCapped<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
	map.set(key, value);

	if (map.size > max) {
		const oldest = map.keys().next().value as K;
		map.delete(oldest);
	}
}

export interface LazyLookup<T> {
	get(): T | null;
	builtAt(): number;
	ensure(): Promise<T>;
	invalidate(): void;
}

export function createLazyLookup<T>(
	build: () => Promise<T>,
	empty: () => T,
	onError?: (error: unknown) => void,
): LazyLookup<T> {
	let value: T | null = null;
	let promise: Promise<T> | null = null;
	let builtAt = 0;

	return {
		get: () => value,
		builtAt: () => builtAt,
		ensure() {
			if (promise) return promise;

			promise = build()
				.catch((error) => {
					onError?.(error);
					return empty();
				})
				.then((built) => {
					value = built;
					builtAt = Date.now();
					return built;
				});

			return promise;
		},
		invalidate() {
			value = null;
			promise = null;
			builtAt = Date.now();
		},
	};
}

export function getPortRange(
	normalRange: [number, number],
	hyperVRange: [number, number],
	useHyperV: boolean,
): [number, number] {
	return useHyperV ? hyperVRange : normalRange;
}

export function tryBindToPort<T>(options: PortBindOptions<T>): {
	server: T;
	port: number;
} {
	const { portRange, startPort, tryBind, onPortInUse, serverName } = options;
	let port = startPort ?? portRange[0];

	while (port <= portRange[1]) {
		try {
			const server = tryBind(port);
			return { server, port };
		} catch (e) {
			const error = e as { code?: string };
			if (error.code === "EADDRINUSE") {
				onPortInUse?.(port);
				port++;
				continue;
			}
			throw e;
		}
	}

	throw new Error(
		`Failed to start ${serverName} - all ports in range ${portRange[0]}-${portRange[1]} are in use`,
	);
}
