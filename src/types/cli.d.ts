export interface GameDisplayInfo {
	name: string;
	appId: string | undefined;
	pid: number;
	socketId: string;
	startTime: number | null | undefined;
}
