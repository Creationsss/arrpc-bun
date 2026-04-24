export interface PortBindOptions<T> {
	portRange: [number, number];
	startPort?: number;
	tryBind: (port: number) => T;
	onPortInUse?: (port: number) => void;
	serverName: string;
}
