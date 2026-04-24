import type { Socket as NetSocket } from "node:net";
import type { RPCMessage } from "./rpc.d.ts";

export interface ExtendedSocket extends NetSocket {
	send?: (msg: RPCMessage) => void;
	close?: (code?: number, message?: string) => void;
	clientId?: string;
	clientName?: string;
	encoding?: string;
	socketId?: number;
	lastPid?: number;
	_handshook?: boolean;
}

export interface ExtendedWebSocket {
	send: (msg: RPCMessage | string) => void;
	clientId?: string;
	clientName?: string;
	encoding?: string;
	socketId?: number;
	lastPid?: number;
}

export interface WSData {
	clientId: string;
	encoding: string;
	origin: string;
}

export interface Handlers {
	connection: (socket: ExtendedSocket | ExtendedWebSocket) => void;
	message: (
		socket: ExtendedSocket | ExtendedWebSocket,
		msg: RPCMessage,
	) => void;
	close: (socket: ExtendedSocket | ExtendedWebSocket) => void;
	activity: (
		socketId: string,
		activity: unknown,
		pid: number,
		name?: string,
	) => void;
}
