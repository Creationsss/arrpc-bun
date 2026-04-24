import type { PortBindOptions } from "./types";

export { createLogger, logger, print, printError } from "./logger";

export function normalizeTimestamps(
	timestamps: Record<string, number> | undefined,
): void {
	if (!timestamps) return;

	for (const x in timestamps) {
		const key = x as keyof typeof timestamps;
		const value = timestamps[key];
		if (value) {
			if (value < 10000000000) {
				timestamps[key] = value * 1000;
			} else if (value > 10000000000000) {
				timestamps[key] = Math.floor(value / 1000);
			}
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
