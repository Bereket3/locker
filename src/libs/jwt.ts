import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createLogger } from "./logger.js";
import { env } from "./config.js";

const logger = createLogger("jwt");

export interface TokenPayload extends JWTPayload {
  userId: string;
  phoneNumber: string;
  role: string;
  userType: string;
}

const JWT_SECRET = env.JWT_SECRET;
const JWT_EXPIRES_IN = env.JWT_EXPIRES_IN;
const REFRESH_TOKEN_EXPIRES_IN = env.REFRESH_TOKEN_EXPIRES_IN;

const secret = new TextEncoder().encode(JWT_SECRET);

export async function generateAccessToken(
  payload: TokenPayload,
): Promise<string> {
  try {
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(JWT_EXPIRES_IN)
      .sign(secret);

    return token;
  } catch (error) {
    logger.error("Error generating access token:", error);
    throw new Error("Failed to generate access token");
  }
}

export async function generateRefreshToken(
  payload: TokenPayload,
): Promise<string> {
  try {
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(REFRESH_TOKEN_EXPIRES_IN)
      .sign(secret);

    return token;
  } catch (error) {
    logger.error("Error generating refresh token:", error);
    throw new Error("Failed to generate refresh token");
  }
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as TokenPayload;
  } catch (error) {
    logger.error("Token verification failed:", error);
    return null;
  }
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString(),
    );
    return payload as TokenPayload;
  } catch (error) {
    logger.error("Token decode failed:", error);
    return null;
  }
}
