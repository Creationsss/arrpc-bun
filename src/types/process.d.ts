export interface DetectableApp {
	id: string;
	name: string;
	executables?: Array<{
		name: string;
		is_launcher?: boolean;
		arguments?: string;
		os?: string;
	}>;
	aliases?: string[];
	hook?: boolean;
	[key: string]: unknown;
}

export type ProcessInfo = [number, string, string[]];

export interface Native {
	getProcesses: () => Promise<ProcessInfo[]>;
}

export interface GameState {
	name: string;
	pid: number;
	timestamp: number;
	missedScans: number;
}

export interface SteamLibrary {
	path: string;
	apps: string[];
}
