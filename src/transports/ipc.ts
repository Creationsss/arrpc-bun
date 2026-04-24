import { createConnection, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { env, file } from "bun";
import {
	ENV_DEBUG,
	getAppNameById,
	IPC_COLOR,
	IPC_HEADER_SIZE,
	IPC_MAX_RETRIES,
	IPC_MESSAGE_TYPE_MAX,
	IPC_SOCKET_NAME,
	IPCCloseCode,
	IPCErrorCode,
	IPCMessageType,
	RPC_PROTOCOL_VERSION,
	SOCKET_AVAILABILITY_TIMEOUT,
	UNIX_TEMP_DIR_FALLBACK,
	WINDOWS_IPC_PIPE_PATH,
} from "../constants";
import { ignoreList } from "../ignore-list";
import { stateManager } from "../state";
import type { ExtendedSocket, Handlers, RPCMessage } from "../types";
import { createLogger } from "../utils";

const log = createLogger("ipc", ...IPC_COLOR);

function getSocketPath(): string {
	return process.platform === "win32"
		? WINDOWS_IPC_PIPE_PATH
		: join(
				env.XDG_RUNTIME_DIR ||
					env.TMPDIR ||
					env.TMP ||
					env.TEMP ||
					UNIX_TEMP_DIR_FALLBACK,
				IPC_SOCKET_NAME,
			);
}

let uniqueId = 0;

function encode(type: number, data: unknown): Buffer {
	const dataStr = JSON.stringify(data);
	const dataSize = Buffer.byteLength(dataStr);

	const buf = Buffer.allocUnsafe(dataSize + IPC_HEADER_SIZE);
	buf.writeInt32LE(type, 0);
	buf.writeInt32LE(dataSize, 4);
	buf.write(dataStr, IPC_HEADER_SIZE, dataSize);

	return buf;
}

function read(socket: ExtendedSocket): void {
	while (true) {
		let resp = socket.read(IPC_HEADER_SIZE);
		if (!resp) return;

		resp = Buffer.from(resp);
		const type = resp.readInt32LE(0);
		const dataSize = resp.readInt32LE(4);

		if (type < 0 || type > IPC_MESSAGE_TYPE_MAX)
			throw new Error("invalid type");

		const data = socket.read(dataSize);
		if (!data) throw new Error("failed reading data");

		const parsedData = JSON.parse(Buffer.from(data).toString());

		switch (type) {
			case IPCMessageType.PING:
				socket.emit("ping", parsedData);
				socket.write(encode(IPCMessageType.PONG, parsedData));
				break;

			case IPCMessageType.PONG:
				socket.emit("pong", parsedData);
				break;

			case IPCMessageType.HANDSHAKE:
				if (socket._handshook) throw new Error("already handshook");
				socket._handshook = true;
				socket.emit("handshake", parsedData);
				break;

			case IPCMessageType.FRAME:
				if (!socket._handshook)
					throw new Error("need to handshake first");
				socket.emit("request", parsedData);
				break;

			case IPCMessageType.CLOSE:
				socket.end();
				socket.destroy();
				return;
		}
	}
}

async function socketIsAvailable(socket: Socket): Promise<boolean> {
	socket.pause();
	socket.on("readable", () => {
		try {
			read(socket as ExtendedSocket);
		} catch (e: unknown) {
			log.info("error whilst reading", e);

			socket.end(
				encode(IPCMessageType.CLOSE, {
					code: IPCCloseCode.CLOSE_UNSUPPORTED,
					message: e instanceof Error ? e.message : "Unknown error",
				}),
			);
			socket.destroy();
		}
	});

	const stop = () => {
		try {
			socket.end();
			socket.destroy();
		} catch (e: unknown) {
			if (env[ENV_DEBUG]) log.info("error stopping socket", e);
		}
	};

	const possibleOutcomes = Promise.race([
		new Promise((res) => socket.on("error", res)),
		new Promise((_res, rej) =>
			socket.on("pong", () => rej("socket ponged")),
		),
		new Promise((_res, rej) =>
			setTimeout(() => rej("timed out"), SOCKET_AVAILABILITY_TIMEOUT),
		),
	]).then(
		() => true,
		(e) => e,
	);

	socket.write(encode(IPCMessageType.PING, ++uniqueId));

	const outcome = await possibleOutcomes;
	stop();
	if (env[ENV_DEBUG]) {
		log.info(
			"checked if socket is available:",
			outcome === true,
			outcome === true ? "" : `- reason: ${outcome}`,
		);
	}

	return outcome === true;
}

async function getAvailableSocket(tries = 0): Promise<string> {
	if (tries > IPC_MAX_RETRIES) {
		throw new Error(`ran out of tries to find socket ${tries}`);
	}

	const path = `${getSocketPath()}-${tries}`;
	const socket = createConnection(path);

	if (env[ENV_DEBUG]) log.info("checking", path);

	if (await socketIsAvailable(socket)) {
		if (process.platform !== "win32") {
			try {
				await file(path).unlink();
			} catch (e: unknown) {
				if (env[ENV_DEBUG]) log.info("error unlinking socket", e);
			}
		}
		return path;
	}

	log.info(`not available, trying again (attempt ${tries + 1})`);
	return getAvailableSocket(tries + 1);
}

export default class IPCServer {
	private handlers!: Handlers;

	private constructor() {}

	static async create(handlers: Handlers): Promise<IPCServer> {
		const ipcServer = new IPCServer();
		ipcServer.handlers = handlers;

		ipcServer.onConnection = ipcServer.onConnection.bind(ipcServer);
		ipcServer.onMessage = ipcServer.onMessage.bind(ipcServer);

		const server = createServer(ipcServer.onConnection);
		server.on("error", (e) => {
			log.info("server error", e);
		});

		const socketPath = await getAvailableSocket();

		return new Promise((resolve) => {
			server.listen(socketPath, () => {
				log.info("listening at", socketPath);
				stateManager.setIpcServer(socketPath);
				resolve(ipcServer);
			});
		});
	}

	onConnection(socket: Socket): void {
		const extSocket = socket as ExtendedSocket;
		log.info("new connection!");

		socket.pause();
		socket.on("readable", () => {
			try {
				read(extSocket);
			} catch (e: unknown) {
				log.info("error whilst reading", e);

				socket.end(
					encode(IPCMessageType.CLOSE, {
						code: IPCCloseCode.CLOSE_UNSUPPORTED,
						message:
							e instanceof Error ? e.message : "Unknown error",
					}),
				);
				socket.destroy();
			}
		});

		socket.once(
			"handshake",
			async (params: { v?: string; client_id?: string }) => {
				if (env[ENV_DEBUG]) log.info("handshake:", params);

				const ver = Number.parseInt(
					params.v ?? String(RPC_PROTOCOL_VERSION),
					10,
				);
				const clientId = params.client_id ?? "";

				extSocket.close = (
					code: number = IPCCloseCode.CLOSE_NORMAL,
					message = "",
				) => {
					socket.end(
						encode(IPCMessageType.CLOSE, {
							code,
							message,
						}),
					);
					socket.destroy();
				};

				if (ver !== RPC_PROTOCOL_VERSION) {
					log.info("unsupported version requested", ver);
					extSocket.close?.(IPCErrorCode.INVALID_VERSION);
					return;
				}

				if (clientId === "") {
					log.info("client id required");
					extSocket.close?.(IPCErrorCode.INVALID_CLIENTID);
					return;
				}

				if (ignoreList.shouldIgnoreClientId(clientId)) {
					log.info("client id is ignored:", clientId);
					extSocket.close?.(IPCErrorCode.TOKEN_REVOKED);
					return;
				}

				let closed = false;
				const handleClose = (reason: string) => {
					if (closed) return;
					closed = true;
					log.info("socket closed:", reason);
					this.handlers.close(extSocket);
				};

				socket.on("error", (e) => {
					log.info("socket error", e);
					handleClose("error");
				});

				socket.on("end", () => {
					handleClose("end");
				});

				socket.on("close", () => {
					handleClose("close");
				});

				socket.on("request", this.onMessage.bind(this, extSocket));

				extSocket.send = (msg: RPCMessage) => {
					if (env[ENV_DEBUG]) log.info("sending", msg);
					socket.write(encode(IPCMessageType.FRAME, msg));
				};

				extSocket.clientId = clientId;
				extSocket.clientName = await getAppNameById(clientId);

				this.handlers.connection(extSocket);
			},
		);
	}

	onMessage(socket: ExtendedSocket, msg: RPCMessage): void {
		if (env[ENV_DEBUG]) log.info("message", msg);

		if (!msg?.cmd) {
			log.info("invalid payload - missing cmd");
			return;
		}

		this.handlers.message(socket, msg);
	}
}
