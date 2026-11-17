import { z } from "zod";

export const GIT_AUTH_STATUS_METHOD = "codexhost/git/auth/status";
export const GIT_AUTH_SIGN_IN_METHOD = "codexhost/git/auth/sign-in";
export const GIT_AUTH_SIGN_OUT_METHOD = "codexhost/git/auth/sign-out";
export const GIT_AUTH_SSH_KEY_METHOD = "codexhost/git/auth/ssh-key";
export const GIT_AUTH_VERIFY_METHOD = "codexhost/git/auth/verify";

/** 托管平台只影响界面提示与注册链接；Git 认证本身按主机名与传输协议执行。 */
export const gitProviderSchema = z.enum(["github", "gitee", "gitlab", "generic"]);
export type GitProvider = z.infer<typeof gitProviderSchema>;

export const gitAuthMethodSchema = z.enum(["https-token", "ssh-key"]);
export type GitAuthMethod = z.infer<typeof gitAuthMethodSchema>;

/** 登录态来源：本产品保存的账号，或本机已有、可直接复用的凭据。 */
export const gitAuthSourceSchema = z.enum(["stored", "git-credential", "gh-cli", "glab-cli"]);
export type GitAuthSource = z.infer<typeof gitAuthSourceSchema>;

export const gitAuthAccountSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    provider: gitProviderSchema,
    method: gitAuthMethodSchema,
    /** 只在用户显式提供时保留；Token 认证缺省使用各平台的安全用户名。 */
    username: z.string().trim().max(255).optional(),
    label: z.string().trim().max(255).optional(),
    createdAt: z.string().min(1),
    verifiedAt: z.string().min(1).nullable(),
  })
  .strict();
export type GitAuthAccount = z.infer<typeof gitAuthAccountSchema>;

export const gitSshKeySchema = z
  .object({
    exists: z.boolean(),
    publicKey: z.string().min(1).nullable(),
    fingerprint: z.string().min(1).nullable(),
  })
  .strict();
export type GitSshKey = z.infer<typeof gitSshKeySchema>;

export const gitAuthHostSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    provider: gitProviderSchema,
    /** 该主机对应的站点地址，用于打开仓库页或注册凭据。 */
    webUrl: z.string().url(),
    /** 当前 Host 上指向该主机的项目仓库路径，按发现顺序去重。 */
    repositories: z.array(z.string().min(1).max(16_384)).max(200),
    state: z.enum(["signed-in", "ambient", "signed-out"]),
    source: gitAuthSourceSchema.nullable(),
    account: gitAuthAccountSchema.nullable(),
    ambientDetail: z.string().max(255).nullable(),
    sshKey: gitSshKeySchema,
    hasSshRemote: z.boolean(),
  })
  .strict();
export type GitAuthHost = z.infer<typeof gitAuthHostSchema>;

export const gitAuthStatusParamsSchema = z
  .object({ cwd: z.string().trim().min(1).max(16_384).optional() })
  .strict();
export type GitAuthStatusParams = z.infer<typeof gitAuthStatusParamsSchema>;

export const gitAuthStatusSchema = z.object({ hosts: z.array(gitAuthHostSchema).max(50) }).strict();
export type GitAuthStatus = z.infer<typeof gitAuthStatusSchema>;

export const gitAuthSignInParamsSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("https-token"),
      host: z.string().trim().min(1).max(255),
      token: z.string().trim().min(1).max(4096),
      username: z.string().trim().max(255).optional(),
      label: z.string().trim().max(255).optional(),
      cwd: z.string().trim().min(1).max(16_384).optional(),
    })
    .strict(),
  z
    .object({
      method: z.literal("ssh-key"),
      host: z.string().trim().min(1).max(255),
      username: z.string().trim().max(255).optional(),
      cwd: z.string().trim().min(1).max(16_384).optional(),
    })
    .strict(),
]);
export type GitAuthSignInParams = z.infer<typeof gitAuthSignInParamsSchema>;

export const gitAuthSignOutParamsSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    cwd: z.string().trim().max(16_384).optional(),
  })
  .strict();
export type GitAuthSignOutParams = z.infer<typeof gitAuthSignOutParamsSchema>;

export const gitSshKeyParamsSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    /** 首次读取时按需生成密钥对；生成只发生在该主机还没有本产品密钥时。 */
    create: z.boolean().default(false),
  })
  .strict();
export type GitSshKeyParams = z.infer<typeof gitSshKeyParamsSchema>;

export const gitSshKeyResultSchema = gitSshKeySchema
  .safeExtend({ host: z.string().trim().min(1).max(255), created: z.boolean() })
  .strict();
export type GitSshKeyResult = z.infer<typeof gitSshKeyResultSchema>;

export const gitAuthVerifyParamsSchema = gitAuthStatusParamsSchema
  .safeExtend({ host: z.string().trim().min(1).max(255) })
  .strict();
export type GitAuthVerifyParams = z.infer<typeof gitAuthVerifyParamsSchema>;

/** 验证结果附一条面向用户的说明，界面不再自行猜测失败原因。 */
export const gitAuthResultSchema = z
  .object({
    status: gitAuthStatusSchema,
    verified: z.boolean(),
    message: z.string().min(1).max(500),
  })
  .strict();
export type GitAuthResult = z.infer<typeof gitAuthResultSchema>;
