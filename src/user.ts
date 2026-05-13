import { env } from "bun";
import {
	DEFAULT_USER,
	ENV_USER_AVATAR,
	ENV_USER_DISCRIMINATOR,
	ENV_USER_GLOBAL_NAME,
	ENV_USER_ID,
	ENV_USER_USERNAME,
} from "./constants";
import type { User } from "./types";

let currentUser: User = { ...DEFAULT_USER };

if (env[ENV_USER_ID]) currentUser.id = env[ENV_USER_ID];
if (env[ENV_USER_USERNAME]) currentUser.username = env[ENV_USER_USERNAME];
if (env[ENV_USER_GLOBAL_NAME])
	currentUser.global_name = env[ENV_USER_GLOBAL_NAME];
if (env[ENV_USER_DISCRIMINATOR])
	currentUser.discriminator = env[ENV_USER_DISCRIMINATOR];
if (env[ENV_USER_AVATAR]) currentUser.avatar = env[ENV_USER_AVATAR];

export function getUser(): User {
	return currentUser;
}

export function setUser(patch: Partial<User>): User {
	currentUser = { ...currentUser, ...patch };
	return currentUser;
}

export function resetUser(): User {
	currentUser = { ...DEFAULT_USER };
	return currentUser;
}
