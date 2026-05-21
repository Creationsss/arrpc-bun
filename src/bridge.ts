import { env, type Server, type ServerWebSocket, serve } from "bun";
import {
	BRIDGE_COLOR,
	BRIDGE_PORT_RANGE,
	BRIDGE_PORT_RANGE_HYPERV,
	BRIDGE_REFRESH_INTERVAL_MS,
	DEFAULT_LOCALHOST,
	ENV_BRIDGE_HOST,
	ENV_BRIDGE_PORT,
	ENV_DEBUG,
	ENV_NO_BRIDGE,
	MAX_CACHED_ACTIVITIES,
} from "./constants";
import { ignoreList } from "./ignore-list";
import { isHyperVEnabled } from "./platform";
import { stateManager } from "./state";
import type {
	ActivityPayload,
	BridgeMessage,
	BridgeRequestType,
	User,
} from "./types";
import { resetUser, setUser } from "./user";
import { createLogger, getPortRange, tryBindToPort } from "./utils";

const log = createLogger("bridge", ...BRIDGE_COLOR);

const REQUEST_TIMEOUT_MS = 5000;

const lastMsg = new Map<string, ActivityPayload>();
const clients = new Set<ServerWebSocket<unknown>>();
let bridgeServer: Server<unknown> | undefined;
let nonceCounter = 0;

interface PendingRequest {
	resolve: (ok: boolean) => void;
	timer: ReturnType<typeof setTimeout>;
}

const pendingRequests = new Map<string, PendingRequest>();

function settleRequest(nonce: string, ok: boolean): void {
	const pending = pendingRequests.get(nonce);
	if (!pending) return;
	clearTimeout(pending.timer);
	pendingRequests.delete(nonce);
	pending.resolve(ok);
}

export function request(
	type: BridgeRequestType,
	data: unknown,
	callback: (ok: boolean) => void,
): void {
	if (clients.size === 0) {
		if (env[ENV_DEBUG]) {
			log.info(`no bridge clients to handle ${type}, replying false`);
		}
		callback(false);
		return;
	}

	const nonce = String(++nonceCounter);
	const timer = setTimeout(() => {
		if (env[ENV_DEBUG]) {
			log.info(`request ${type} (${nonce}) timed out`);
		}
		settleRequest(nonce, false);
	}, REQUEST_TIMEOUT_MS);

	pendingRequests.set(nonce, { resolve: callback, timer });

	const payload = JSON.stringify({ type, nonce, data });
	for (const client of clients) {
		client.send(payload);
	}
}

async function handleMessage(
	ws: ServerWebSocket<unknown>,
	message: BridgeMessage,
): Promise<void> {
	if (env[ENV_DEBUG]) {
		log.info("received message:", message);
	}

	const respond = (type: string, data: unknown) => {
		ws.send(JSON.stringify({ type, data }));
	};

	try {
		switch (message.type) {
			case "IGNORE_GAMES": {
				const games = message.data?.games;
				if (Array.isArray(games)) {
					await ignoreList.add(games);
					respond("IGNORE_GAMES_ACK", {
						success: true,
						count: games.length,
					});
				}
				break;
			}

			case "UNIGNORE_GAMES": {
				const games = message.data?.games;
				if (Array.isArray(games)) {
					await ignoreList.remove(games);
					respond("UNIGNORE_GAMES_ACK", {
						success: true,
						count: games.length,
					});
				}
				break;
			}

			case "CLEAR_IGNORED_GAMES": {
				await ignoreList.clear();
				respond("CLEAR_IGNORED_GAMES_ACK", { success: true });
				break;
			}

			case "GET_IGNORED_GAMES": {
				const games = ignoreList.getAll();
				respond("IGNORED_GAMES", { games });
				break;
			}

			case "RELOAD_IGNORE_LIST": {
				const result = await ignoreList.reload();
				respond("IGNORE_LIST_RELOADED", result);
				break;
			}

			case "ACK_INVITE":
			case "ACK_GUILD_TEMPLATE":
			case "ACK_LINK": {
				if (typeof message.nonce !== "string") break;
				settleRequest(message.nonce, message.data?.ok === true);
				break;
			}

			case "SET_USER": {
				const data = message.data;
				if (!data || typeof data !== "object") break;
				const patch: Partial<User> = {};
				if (typeof data.id === "string") patch.id = data.id;
				if (typeof data.username === "string")
					patch.username = data.username;
				if (typeof data.global_name === "string")
					patch.global_name = data.global_name;
				if (typeof data.discriminator === "string")
					patch.discriminator = data.discriminator;
				if (typeof data.avatar === "string" || data.avatar === null)
					patch.avatar = data.avatar;
				if (typeof data.bot === "boolean") patch.bot = data.bot;
				if (typeof data.flags === "number") patch.flags = data.flags;
				if (typeof data.premium_type === "number")
					patch.premium_type = data.premium_type;
				const updated = setUser(patch);
				respond("SET_USER_ACK", { success: true, user: updated });
				break;
			}

			case "RESET_USER": {
				const updated = resetUser();
				respond("RESET_USER_ACK", { success: true, user: updated });
				break;
			}

			default:
				if (env[ENV_DEBUG]) {
					log.info("unknown message type:", message.type);
				}
		}
	} catch (err) {
		respond("ERROR", {
			message: err instanceof Error ? err.message : "Unknown error",
		});
	}
}

export function getPort(): number | undefined {
	return bridgeServer?.port;
}

function refreshClients(): void {
	if (clients.size === 0 || lastMsg.size === 0) return;

	if (env[ENV_DEBUG]) {
		log.info(
			"refreshing bridge clients, connected:",
			clients.size,
			"cached:",
			lastMsg.size,
		);
	}

	const serialized: string[] = [];
	for (const msg of lastMsg.values()) {
		serialized.push(JSON.stringify(msg));
	}

	for (const client of clients) {
		for (const json of serialized) {
			client.send(json);
		}
	}
}

export function send(msg: ActivityPayload): void {
	if (env[ENV_DEBUG]) {
		log.info(
			"sending to bridge, connected clients:",
			clients.size,
			"msg:",
			msg,
		);
	}

	if (msg.activity === null) {
		lastMsg.delete(msg.socketId);
	} else {
		lastMsg.set(msg.socketId, msg);

		if (lastMsg.size > MAX_CACHED_ACTIVITIES) {
			const firstKey = lastMsg.keys().next().value;
			if (firstKey) lastMsg.delete(firstKey);
		}
	}

	const msgStr = JSON.stringify(msg);
	for (const client of clients) {
		client.send(msgStr);
	}
}

export async function init(): Promise<void> {
	if (env[ENV_NO_BRIDGE]) {
		log.info("bridge disabled via ENV_NO_BRIDGE");
		return;
	}

	const useHyperVRange = isHyperVEnabled();
	const portRange = getPortRange(
		BRIDGE_PORT_RANGE,
		BRIDGE_PORT_RANGE_HYPERV,
		useHyperVRange,
	);

	if (useHyperVRange) {
		log.info("Hyper-V detected, using extended port range");
	}

	let startPort: number | undefined;
	if (env[ENV_BRIDGE_PORT]) {
		const envPort = Number.parseInt(env[ENV_BRIDGE_PORT], 10);
		if (Number.isNaN(envPort)) {
			throw new Error("invalid ARRPC_BRIDGE_PORT");
		}
		startPort = envPort;
	}

	const hostname = env[ENV_BRIDGE_HOST] || DEFAULT_LOCALHOST;

	const { server, port } = tryBindToPort({
		portRange,
		startPort,
		serverName: "bridge server",
		onPortInUse: (p) => log.info(p, "in use!"),
		tryBind: (p) =>
			serve<unknown>({
				port: p,
				hostname,
				fetch(req, srv) {
					const upgraded = srv.upgrade(req, { data: undefined });
					if (!upgraded) {
						return new Response("WebSocket upgrade failed", {
							status: 400,
						});
					}
					return undefined;
				},
				websocket: {
					open(ws) {
						log.info("client connected");

						for (const msg of lastMsg.values()) {
							if (msg && msg.activity != null) {
								ws.send(JSON.stringify(msg));
							}
						}

						clients.add(ws);
					},
					async message(ws, data) {
						try {
							const message = JSON.parse(
								typeof data === "string"
									? data
									: new TextDecoder().decode(data),
							) as BridgeMessage;
							await handleMessage(ws, message);
						} catch (err) {
							if (env[ENV_DEBUG]) {
								log.info("failed to parse message:", err);
							}
						}
					},
					close(ws) {
						log.info("client disconnected");
						clients.delete(ws);
					},
				},
			}),
	});

	bridgeServer = server;
	log.info("listening on", port);
	stateManager.setServer("bridge", { host: hostname, port });

	setInterval(refreshClients, BRIDGE_REFRESH_INTERVAL_MS);
}
