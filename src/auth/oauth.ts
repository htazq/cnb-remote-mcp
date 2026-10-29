import { createHash, randomBytes } from "node:crypto";
import express, { type Response } from "express";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  TooManyRequestsError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AppConfig } from "../config.js";
import { verifyPatAccess } from "./pat.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("hex");
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
type Grant = { params: AuthorizationParams; expires: number; actor: string };
type Token = { expires: number; actor: string; family: string };

/** Single-owner OAuth facade. It authorizes access to the configured PAT, never a CNB login. */
export class OwnerOAuth implements OAuthServerProvider {
  readonly client: OAuthClientInformationFull;
  readonly clientsStore;
  readonly resource: URL;
  private readonly pending = new Map<string, Grant>();
  private readonly codes = new Map<string, Grant>();
  private readonly access = new Map<string, Token>();
  private readonly refresh = new Map<string, Token>();
  private attempts = { count: 0, until: 0 };

  constructor(private readonly config: AppConfig) {
    const oauth = config.oauth!;
    this.resource = new URL("/mcp", config.publicBaseUrl);
    this.client = {
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      redirect_uris: oauth.redirectUris,
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "CNB self-hosted client",
      scope: "cnb",
    };
    this.clientsStore = {
      getClient: (id: string) => (id === this.client.client_id ? this.client : undefined),
    };
  }

  private prune(): void {
    for (const map of [this.pending, this.codes, this.access, this.refresh]) {
      for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key);
      if (map.size >= 1000) throw new TooManyRequestsError("Authorization capacity reached");
    }
  }

  private validateResource(resource?: URL): void {
    if (resource && resource.href !== this.resource.href)
      throw new InvalidTargetError("Unexpected MCP resource");
  }

  private validateScopes(scopes?: string[]): void {
    if (scopes?.some((s) => s !== "cnb"))
      throw new InvalidScopeError("Only the cnb scope is supported");
  }

  async authorize(
    _client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.prune();
    this.validateResource(params.resource);
    this.validateScopes(params.scopes);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))
      throw new InvalidGrantError("Invalid S256 challenge");
    const ticket = random();
    this.pending.set(digest(ticket), { params, expires: Date.now() + 300_000, actor: "" });
    res.cookie("__Host-cnb-consent", ticket, {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 300_000,
    });
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Frame-Options": "DENY",
    });
    res.type("html")
      .send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorize CNB / 授权 CNB</title>
<h1>Authorize CNB / 授权 CNB</h1><p>This client will use this server's CNB account in <strong>${escape(this.config.writeMode)}</strong> mode.</p>
<p>此客户端将使用本服务器配置的 CNB 账号。请核对回调地址，仅授权你自己的连接。</p><p>Callback / 回调：<code>${escape(params.redirectUri)}</code></p>
<form method="post" action="/oauth/approve"><input type="hidden" name="ticket" value="${ticket}">
<label>Owner access key / 服务器访问密钥 <input type="password" name="password" autocomplete="off" required maxlength="512"></label>
<p>Enter a configured MCP_ACCESS_TOKENS key. Never enter your CNB token or password.<br>输入 MCP_ACCESS_TOKENS 中的密钥，不要输入 CNB 令牌或密码。</p>
<button type="submit">Authorize / 授权</button></form></html>`);
  }

  router(): express.Router {
    const router = express.Router();
    router.post(
      "/oauth/approve",
      express.urlencoded({ extended: false, limit: "4kb" }),
      (req, res) => {
        this.prune();
        res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
        const ticket = typeof req.body.ticket === "string" ? req.body.ticket : "";
        const cookie = req.headers.cookie
          ?.split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith("__Host-cnb-consent="))
          ?.slice("__Host-cnb-consent=".length);
        const grant = this.pending.get(digest(ticket));
        if (!grant || cookie !== ticket || req.headers.origin !== this.config.publicBaseUrl) {
          res.status(400).send("Invalid or expired consent. Reconnect from your MCP client.");
          return;
        }
        if (this.attempts.until < Date.now())
          this.attempts = { count: 0, until: Date.now() + 60_000 };
        if (++this.attempts.count > 20) {
          res.status(429).send("Too many attempts. Try again in one minute.");
          return;
        }
        const password = typeof req.body.password === "string" ? req.body.password : "";
        const auth = verifyPatAccess(
          password,
          this.config.accessTokenList.filter((v) => v.length >= 32),
          this.config.cnbToken!,
        );
        if (!auth.ok) {
          res.status(401).send("Invalid owner key. Go back and retry.");
          return;
        }
        this.pending.delete(digest(ticket));
        res.clearCookie("__Host-cnb-consent", {
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
        const code = random();
        this.codes.set(digest(code), {
          ...grant,
          actor: auth.ctx.actor,
          expires: Date.now() + 60_000,
        });
        const target = new URL(grant.params.redirectUri);
        target.searchParams.set("code", code);
        if (grant.params.state !== undefined) target.searchParams.set("state", grant.params.state);
        res.redirect(303, target.href);
      },
    );
    router.use(
      mcpAuthRouter({
        provider: this,
        issuerUrl: new URL(this.config.publicBaseUrl!),
        resourceServerUrl: this.resource,
        scopesSupported: ["cnb"],
        resourceName: "CNB Remote MCP",
        // The private connector is the network peer; use bounded global limits.
        authorizationOptions: { rateLimit: { keyGenerator: () => "owner" } },
        tokenOptions: { rateLimit: { keyGenerator: () => "owner" } },
        revocationOptions: { rateLimit: { keyGenerator: () => "owner" } },
      }),
    );
    return router;
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    code: string,
  ): Promise<string> {
    this.prune();
    const grant = this.codes.get(digest(code));
    if (!grant) throw new InvalidGrantError("Invalid or expired authorization code");
    return grant.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.prune();
    this.validateResource(resource);
    const grant = this.codes.get(digest(code));
    if (!grant || redirectUri !== grant.params.redirectUri)
      throw new InvalidGrantError("Invalid code or redirect URI");
    this.codes.delete(digest(code));
    return this.issue(grant.actor, random());
  }

  private issue(actor: string, family: string): OAuthTokens {
    const access = random();
    const refresh = random();
    this.access.set(digest(access), { actor, family, expires: Date.now() + 3_600_000 });
    this.refresh.set(digest(refresh), { actor, family, expires: Date.now() + 30 * 86_400_000 });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refresh,
      scope: "cnb",
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    token: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.prune();
    this.validateResource(resource);
    this.validateScopes(scopes);
    const stored = this.refresh.get(digest(token));
    if (!stored) throw new InvalidGrantError("Invalid or expired refresh token");
    this.revokeFamily(stored.family);
    return this.issue(stored.actor, stored.family);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    this.prune();
    const stored = this.access.get(digest(token));
    if (!stored) throw new InvalidTokenError("Invalid or expired access token");
    return {
      token,
      clientId: this.client.client_id,
      scopes: ["cnb"],
      expiresAt: Math.floor(stored.expires / 1000),
      resource: this.resource,
      extra: { actor: stored.actor },
    };
  }

  private revokeFamily(family: string): void {
    for (const map of [this.access, this.refresh])
      for (const [key, value] of map) if (value.family === family) map.delete(key);
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: { token: string },
  ): Promise<void> {
    const stored =
      this.access.get(digest(request.token)) ?? this.refresh.get(digest(request.token));
    if (stored) this.revokeFamily(stored.family);
  }
}
