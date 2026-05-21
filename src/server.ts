import { EventEmitter } from "node:events";
import { env } from "bun";
import {
	ACTIVITY_FLAG_INSTANCE,
	ActivityType,
	CLI_ARG_NO_PROCESS_SCANNING,
	DEFAULT_SOCKET_ID,
	DISCORD_API_ENDPOINT,
	DISCORD_CDN_HOST,
	DISCORD_ENVIRONMENT,
	ENV_DEBUG,
	ENV_NO_PROCESS_SCANNING,
	IPCErrorCode,
	RPC_GENERIC_ERROR_CODE,
	RPC_PROTOCOL_VERSION,
	RPCCommand,
	RPCEvent,
	SERVER_COLOR,
} from "./constants";
import ProcessServer from "./process/index";
import IPCServer from "./transports/ipc";
import WSServer from "./transports/websocket";
import type {
	ActivityPayload,
	DeepLinkArgs,
	ExtendedSocket,
	ExtendedWebSocket,
	Handlers,
	InviteArgs,
	RPCMessage,
	SetActivityArgs,
} from "./types";
import { getUser } from "./user";
import { createLogger, normalizeTimestamps } from "./utils";

const log = createLogger("server", ...SERVER_COLOR);

let socketId = 0;

function sendMessage(
	socket: ExtendedSocket | ExtendedWebSocket,
	msg: RPCMessage,
): void {
	if (socket.send) {
		socket.send(msg);
	}
}

export default class RPCServer extends EventEmitter {
	private processServer?: ProcessServer;
	private wsServer?: WSServer;
	private ipcServer?: IPCServer;

	private constructor() {
		super();
	}

	static async create(): Promise<RPCServer> {
		const server = new RPCServer();

		server.onConnection = server.onConnection.bind(server);
		server.onMessage = server.onMessage.bind(server);
		server.onClose = server.onClose.bind(server);
		server.onActivity = server.onActivity.bind(server);

		const handlers: Handlers = {
			connection: server.onConnection,
			message: server.onMessage,
			close: server.onClose,
			activity: server.onActivity,
		};

		server.wsServer = new WSServer(handlers);
		server.ipcServer = await IPCServer.create(handlers);

		if (
			!process.argv.includes(CLI_ARG_NO_PROCESS_SCANNING) &&
			!env[ENV_NO_PROCESS_SCANNING]
		) {
			server.processServer = new ProcessServer(handlers);
		}

		return server;
	}

	shutdown(): void {
		log.info("shutting down...");
		this.processServer?.shutdown();
		this.wsServer?.shutdown();
		this.ipcServer?.shutdown();
		this.removeAllListeners();
	}

	onConnection(socket: ExtendedSocket | ExtendedWebSocket): void {
		const id = socketId++;
		socket.socketId = id;

		if (env[ENV_DEBUG]) {
			log.info(
				"new connection",
				`socket #${id}`,
				`clientId: ${socket.clientId || "unknown"}`,
			);
		}

		sendMessage(socket, {
			cmd: RPCCommand.DISPATCH,
			data: {
				v: RPC_PROTOCOL_VERSION,
				config: {
					cdn_host: DISCORD_CDN_HOST,
					api_endpoint: DISCORD_API_ENDPOINT,
					environment: DISCORD_ENVIRONMENT,
				},
				user: getUser(),
			},
			evt: RPCEvent.READY,
			nonce: null,
		});

		this.emit("connection", socket);
	}

	onClose(socket: ExtendedSocket | ExtendedWebSocket): void {
		this.emit("activity", {
			activity: null,
			pid: socket.lastPid,
			socketId: socket.socketId?.toString() ?? DEFAULT_SOCKET_ID,
		} as ActivityPayload);

		this.emit("close", socket);
	}

	onActivity(
		socketId: string,
		activity: unknown,
		pid: number,
		name?: string,
	): void {
		if (env[ENV_DEBUG]) {
			log.info("process activity event", {
				socketId,
				activity,
				pid,
				name,
			});
		}

		if (
			activity &&
			typeof activity === "object" &&
			"timestamps" in activity
		) {
			normalizeTimestamps(
				(activity as { timestamps?: Record<string, unknown> })
					.timestamps,
			);
		}

		this.emit("activity", {
			activity: activity
				? {
						type: ActivityType.PLAYING,
						...(activity as Record<string, unknown>),
					}
				: null,
			pid,
			socketId,
		} as ActivityPayload);
	}

	async onMessage(
		socket: ExtendedSocket | ExtendedWebSocket,
		{ cmd, args, evt: subscriptionEvt, nonce }: RPCMessage,
	): Promise<void> {
		if (env[ENV_DEBUG]) {
			log.info(
				"message received",
				`socket #${socket.socketId}`,
				`cmd: ${cmd}`,
				`nonce: ${nonce}`,
			);
		}

		this.emit("message", { socket, cmd, args, nonce });

		switch (cmd) {
			case RPCCommand.CONNECTIONS_CALLBACK:
				sendMessage(socket, {
					cmd,
					data: {
						code: RPC_GENERIC_ERROR_CODE,
						message: "CONNECTIONS_CALLBACK is not supported",
					},
					evt: RPCEvent.ERROR,
					nonce,
				});
				break;

			case RPCCommand.SET_ACTIVITY: {
				const setActivityArgs = args as SetActivityArgs;
				const { activity, pid } = setActivityArgs;

				if (!activity) {
					socket.lastPid = pid ?? socket.lastPid;

					sendMessage(socket, {
						cmd,
						data: null,
						evt: null,
						nonce,
					});

					this.emit("activity", {
						activity: null,
						pid,
						socketId:
							socket.socketId?.toString() ?? DEFAULT_SOCKET_ID,
					} as ActivityPayload);
					return;
				}

				const { buttons, timestamps, instance } = activity;

				socket.lastPid = pid ?? socket.lastPid;

				const metadata: { button_urls?: string[] } = {};
				const extra: { buttons?: string[] } = {};

				if (buttons) {
					metadata.button_urls = buttons.map(
						(x: { url: string; label: string }) => x.url,
					);
					extra.buttons = buttons.map((x) => x.label);
				}

				normalizeTimestamps(timestamps);

				if (env[ENV_DEBUG]) {
					log.info("emitting activity event");
				}
				this.emit("activity", {
					activity: {
						application_id: socket.clientId,
						name: socket.clientName || "",
						type: ActivityType.PLAYING,
						metadata,
						flags: instance ? ACTIVITY_FLAG_INSTANCE : 0,
						...activity,
						...extra,
					},
					pid,
					socketId: socket.socketId?.toString() ?? DEFAULT_SOCKET_ID,
				} as ActivityPayload);

				sendMessage(socket, {
					cmd,
					data: {
						name: socket.clientName || "",
						application_id: socket.clientId,
						type: ActivityType.PLAYING,
						...activity,
					},
					evt: null,
					nonce,
				});

				break;
			}

			case RPCCommand.GUILD_TEMPLATE_BROWSER:
			case RPCCommand.INVITE_BROWSER: {
				const inviteArgs = args as InviteArgs;
				const { code } = inviteArgs;

				const isInvite = cmd === RPCCommand.INVITE_BROWSER;
				const callback = (isValid = true) => {
					sendMessage(socket, {
						cmd,
						data: isValid
							? { code }
							: {
									code: isInvite
										? IPCErrorCode.INVALID_INVITE
										: IPCErrorCode.INVALID_GUILD_TEMPLATE,
									message: `Invalid ${isInvite ? "invite" : "guild template"} id: ${code}`,
								},
						evt: isValid ? null : RPCEvent.ERROR,
						nonce,
					});
				};

				this.emit(
					isInvite ? "invite" : "guild-template",
					code,
					callback,
				);
				break;
			}

			case RPCCommand.DEEP_LINK: {
				const deepLinkArgs = args as DeepLinkArgs;

				const callback = (success = true) => {
					sendMessage(socket, {
						cmd,
						data: success
							? { success: true }
							: {
									code: RPC_GENERIC_ERROR_CODE,
									message: "Deep link could not be handled",
								},
						evt: success ? null : RPCEvent.ERROR,
						nonce,
					});
				};

				if (!deepLinkArgs?.type) {
					callback(false);
					break;
				}

				this.emit("link", deepLinkArgs, callback);
				break;
			}

			case RPCCommand.SUBSCRIBE:
			case RPCCommand.UNSUBSCRIBE: {
				sendMessage(socket, {
					cmd,
					data: { evt: subscriptionEvt ?? null },
					evt: null,
					nonce,
				});
				break;
			}

			default:
				if (env[ENV_DEBUG]) {
					log.info(`unknown cmd: ${cmd}`);
				}
				sendMessage(socket, {
					cmd: cmd ?? "",
					data: {
						code: RPC_GENERIC_ERROR_CODE,
						message: `Unknown command: ${cmd}`,
					},
					evt: RPCEvent.ERROR,
					nonce,
				});
				break;
		}
	}
}
