import type { ServerInfo } from "./activity.d.ts";

export interface Servers {
	bridge?: ServerInfo;
	websocket?: ServerInfo;
	ipc?: { socketPath: string };
}
