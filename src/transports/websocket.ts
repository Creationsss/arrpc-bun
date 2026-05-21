import { env, type Server, type ServerWebSocket, serve } from "bun";
import {
	ALLOWED_DISCORD_ORIGINS,
	DEFAULT_LOCALHOST,
	ENV_DEBUG,
	ENV_WEBSOCKET_HOST,
	getAppNameById,
	RPC_PROTOCOL_VERSION,
	WEBSOCKET_COLOR,
	WEBSOCKET_PORT_RANGE,
	WEBSOCKET_PORT_RANGE_HYPERV,
	WS_DEFAULT_ENCODING,
} from "../constants";
import { ignoreList } from "../ignore-list";
import { isHyperVEnabled } from "../platform";
import { stateManager } from "../state";
import type { ExtendedWebSocket, Handlers, RPCMessage, WSData } from "../types";
import { createLogger, getPortRange, tryBindToPort } from "../utils";

const log = createLogger("websocket", ...WEBSOCKET_COLOR);

export default class WSServer {
	private handlers!: Handlers;
	private server?: Server<unknown>;

	constructor(handlers: Handlers) {
		this.handlers = handlers;

		this.onConnection = this.onConnection.bind(this);
		this.onMessage = this.onMessage.bind(this);

		const useHyperVRange = isHyperVEnabled();
		const portRange = getPortRange(
			WEBSOCKET_PORT_RANGE,
			WEBSOCKET_PORT_RANGE_HYPERV,
			useHyperVRange,
		);

		if (useHyperVRange) {
			log.info("Hyper-V detected, using extended port range");
		}

		const hostname = env[ENV_WEBSOCKET_HOST] || DEFAULT_LOCALHOST;

		const { server, port } = tryBindToPort({
			portRange,
			serverName: "WebSocket server",
			onPortInUse: (p) => log.info(p, "in use!"),
			tryBind: (p) =>
				serve({
					port: p,
					hostname,
					fetch: (req, srv) => {
						const url = new URL(req.url);
						const params = url.searchParams;
						const ver = Number.parseInt(
							params.get("v") ?? String(RPC_PROTOCOL_VERSION),
							10,
						);
						const encoding =
							params.get("encoding") ?? WS_DEFAULT_ENCODING;
						const clientId = params.get("client_id") ?? "";
						const origin = req.headers.get("origin") ?? "";

						if (
							origin !== "" &&
							!ALLOWED_DISCORD_ORIGINS.includes(origin)
						) {
							log.info("disallowed origin", origin);
							return new Response("Disallowed origin", {
								status: 403,
							});
						}

						if (encoding !== WS_DEFAULT_ENCODING) {
							log.info(
								"unsupported encoding requested",
								encoding,
							);
							return new Response("Unsupported encoding", {
								status: 400,
							});
						}

						if (ver !== RPC_PROTOCOL_VERSION) {
							log.info("unsupported version requested", ver);
							return new Response("Unsupported version", {
								status: 400,
							});
						}

						if (
							clientId &&
							ignoreList.shouldIgnoreClientId(clientId)
						) {
							log.info("client id is ignored:", clientId);
							return new Response("Client ID is ignored", {
								status: 403,
							});
						}

						const upgraded = srv.upgrade(req, {
							data: { clientId, encoding, origin },
						});

						if (!upgraded) {
							return new Response("WebSocket upgrade failed", {
								status: 400,
							});
						}

						return undefined;
					},
					websocket: {
						open: (ws: ServerWebSocket<WSData>) =>
							this.onConnection(ws),
						message: (
							ws: ServerWebSocket<WSData>,
							message: string | Buffer,
						) => this.onMessage(ws, message),
						close: (ws: ServerWebSocket<WSData>) => {
							const extSocket =
								ws as unknown as ExtendedWebSocket;
							log.info("socket closed");
							this.handlers.close(extSocket);
						},
					},
				}),
		});

		log.info("listening on", port);
		this.server = server;
		stateManager.setServer("websocket", { host: hostname, port });
	}

	getPort(): number | undefined {
		return this.server?.port;
	}

	onConnection(ws: ServerWebSocket<WSData>): void {
		const extSocket = ws as unknown as ExtendedWebSocket;
		const { clientId, encoding } = ws.data;

		if (env[ENV_DEBUG]) {
			log.info(
				"new connection! clientId:",
				clientId,
				"encoding:",
				encoding,
			);
		}

		extSocket.clientId = clientId;
		extSocket.encoding = encoding;
		extSocket.clientName = "";
		extSocket.send = (msg: RPCMessage | string) => {
			if (env[ENV_DEBUG]) log.info("sending", msg);
			const data = typeof msg === "string" ? msg : JSON.stringify(msg);
			ws.send(data);
		};

		this.handlers.connection(extSocket);

		getAppNameById(clientId)
			.then((name) => {
				extSocket.clientName = name;
			})
			.catch((e) => {
				if (env[ENV_DEBUG]) log.info("getAppNameById failed:", e);
			});
	}

	onMessage(ws: ServerWebSocket<WSData>, msg: Buffer | string): void {
		const extSocket = ws as unknown as ExtendedWebSocket;

		try {
			const parsedMsg = JSON.parse(msg.toString()) as RPCMessage;
			if (env[ENV_DEBUG]) log.info("message", parsedMsg);
			this.handlers.message(extSocket, parsedMsg);
		} catch (e) {
			log.info("invalid payload - malformed JSON");
			if (env[ENV_DEBUG]) {
				log.info("error:", e);
			}
		}
	}
}
