export interface ThirdPartySku {
	distributor: string;
	id?: string;
}

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
	third_party_skus?: ThirdPartySku[];
	[key: string]: unknown;
}

export type ProcessInfo = [number, string, string[], string?];

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

export interface SteamAppInfo {
	appid: string;
	name: string;
}
