import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "@codexhost/protocol-core";

const cursorPrefix = "codexhost-catalog:";
const defaultPageSize = 100;
const maximumPageSize = 0xffff_ffff;

// 仅投影自定义 API Provider 的菜单目录，不改写原生会话持有的执行元数据。
export class LiveModelCatalog {
  readonly #models: JsonObject[];
  readonly #revision = randomUUID();

  constructor(catalog: unknown) {
    const root = object(catalog, "catalog");
    const slugs = new Set<string>();
    const models = array(root.models, "models").map((value, index) => {
      const path = `models[${index}]`;
      const model = object(value, path);
      const slug = string(model.slug, `${path}.slug`);
      if (!slug.trim() || slugs.has(slug)) {
        throw new Error("模型目录包含空白或重复的模型 ID。");
      }
      slugs.add(slug);
      const priority = integer(model.priority, `${path}.priority`);
      if (priority < -2_147_483_648 || priority > 2_147_483_647) {
        invalid(`${path}.priority`);
      }
      const supported = boolean(model.supported_in_api, `${path}.supported_in_api`);
      const projected = projectModel(model, path, slug);
      return { priority, supported, projected };
    });
    // 与原生 ModelsManager 一致：稳定排序、API 可用性过滤，再选择首个可见默认项。
    this.#models = models
      .sort((left, right) => left.priority - right.priority)
      .filter((model) => model.supported)
      .map((model) => model.projected);
    const selected = this.#models.find((model) => !model.hidden) ?? this.#models[0];
    if (selected) {
      selected.isDefault = true;
    }
  }

  get visibleIds(): string[] {
    return this.#models.filter((model) => !model.hidden).map((model) => model.model as string);
  }

  list(params: JsonObject): JsonObject {
    const includeHidden =
      params.includeHidden == null ? false : boolean(params.includeHidden, "includeHidden");
    const requestedLimit = params.limit == null ? defaultPageSize : integer(params.limit, "limit");
    if (requestedLimit < 0 || requestedLimit > maximumPageSize) {
      throw new Error(`模型目录分页 limit 必须在 0 到 ${maximumPageSize} 之间。`);
    }
    // 原生 model/list 将 limit=0 归一化为一项，避免生成无法前进的游标。
    const limit = Math.max(1, requestedLimit);
    const models = this.#models.filter((model) => includeHidden || !model.hidden);
    const offset = this.#offset(params.cursor, includeHidden, models.length);
    const end = Math.min(offset + limit, models.length);
    const nextCursor =
      end < models.length
        ? cursorPrefix +
          Buffer.from(
            JSON.stringify({ revision: this.#revision, includeHidden, offset: end }),
          ).toString("base64url")
        : null;
    // 返回副本，调用方对响应和嵌套元数据的修改不能污染后续分页。
    return { data: structuredClone(models.slice(offset, end)), nextCursor };
  }

  #offset(cursor: JsonValue | undefined, includeHidden: boolean, size: number): number {
    if (cursor == null) {
      return 0;
    }
    if (typeof cursor !== "string" || !cursor.startsWith(cursorPrefix)) {
      throw new Error("模型目录游标无效，请从第一页重新读取。");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(cursor.slice(cursorPrefix.length), "base64url").toString());
    } catch {
      throw new Error("模型目录游标无效，请从第一页重新读取。");
    }
    const value = object(decoded, "cursor");
    if (value.revision !== this.#revision || value.includeHidden !== includeHidden) {
      throw new Error("模型目录游标已过期或筛选条件已变化，请从第一页重新读取。");
    }
    const offset = integer(value.offset, "cursor.offset");
    if (offset < 0 || offset > size) {
      throw new Error("模型目录游标超出范围，请从第一页重新读取。");
    }
    return offset;
  }
}

function projectModel(model: Record<string, unknown>, path: string, slug: string): JsonObject {
  const visibility = choice(model.visibility, ["list", "hide", "none"], `${path}.visibility`);
  const multiAgentVersion = optionalString(
    model.multi_agent_version,
    `${path}.multi_agent_version`,
  );
  const supportedReasoningEfforts = array(
    model.supported_reasoning_levels,
    `${path}.supported_reasoning_levels`,
  ).map((value, index) => {
    const optionPath = `${path}.supported_reasoning_levels[${index}]`;
    const option = object(value, optionPath);
    return {
      reasoningEffort: string(option.effort, `${optionPath}.effort`),
      description: string(option.description, `${optionPath}.description`),
    };
  });
  const serviceTiers = array(absent(model.service_tiers, []), `${path}.service_tiers`);
  return {
    id: slug,
    model: slug,
    displayName: string(model.display_name, `${path}.display_name`),
    description: optionalString(model.description, `${path}.description`) ?? "",
    modelSpecialty: optionalString(model.model_specialty, `${path}.model_specialty`),
    hidden: visibility !== "list",
    supportedReasoningEfforts,
    defaultReasoningEffort:
      optionalString(model.default_reasoning_level, `${path}.default_reasoning_level`) ?? "none",
    inputModalities: array(
      absent(model.input_modalities, ["text", "image"]),
      `${path}.input_modalities`,
    ).map((value) => choice(value, ["text", "image", "audio"], `${path}.input_modalities`)),
    supportsPersonality: false,
    // 与原生前向兼容行为一致：未知的可选运行时版本不宣称已支持。
    multiAgentVersion:
      multiAgentVersion !== null && ["disabled", "v1", "v2"].includes(multiAgentVersion)
        ? multiAgentVersion
        : null,
    additionalSpeedTiers: array(
      absent(model.additional_speed_tiers, []),
      `${path}.additional_speed_tiers`,
    ).map((value) => string(value, `${path}.additional_speed_tiers`)),
    serviceTiers: serviceTiers.map((value, index) => {
      const tierPath = `${path}.service_tiers[${index}]`;
      const tier = object(value, tierPath);
      return {
        id: string(tier.id, `${tierPath}.id`),
        name: string(tier.name, `${tierPath}.name`),
        description: string(tier.description, `${tierPath}.description`),
      };
    }),
    defaultServiceTier: optionalString(model.default_service_tier, `${path}.default_service_tier`),
    availableAccessPrograms: accessPrograms(model.available_access_programs, path),
    availabilityNux:
      model.availability_nux == null
        ? null
        : {
            message: string(
              object(model.availability_nux, `${path}.availability_nux`).message,
              `${path}.availability_nux.message`,
            ),
          },
    ...upgrade(model.upgrade, path),
    isDefault: false,
  };
}

function upgrade(value: unknown, path: string): JsonObject {
  if (value == null) {
    return { upgrade: null, upgradeInfo: null };
  }
  const info = object(value, `${path}.upgrade`);
  const model = string(info.model, `${path}.upgrade.model`);
  const retirement = info.retirement_at;
  // 原生只识别 RFC 3339 时间，格式错误和非字符串均视为未提供。
  const timestamp =
    typeof retirement === "string" &&
    /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/u.test(retirement)
      ? Date.parse(retirement)
      : NaN;
  return {
    upgrade: model,
    upgradeInfo: {
      model,
      upgradeCopy: null,
      modelLink: null,
      migrationMarkdown: string(info.migration_markdown, `${path}.upgrade.migration_markdown`),
      retirementAt: Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : null,
    },
  };
}

function accessPrograms(value: unknown, path: string): JsonObject | null {
  if (value == null) {
    return null;
  }
  const programs = object(value, `${path}.available_access_programs`);
  const names: Record<string, string> = {
    standard: "standard",
    daybreak_blue: "daybreakBlue",
    daybreak_red: "daybreakRed",
  };
  // 原生忽略尚未识别的服务端访问计划，但保留空列表与缺失元数据的区别。
  const cyber = array(programs.cyber, `${path}.available_access_programs.cyber`)
    .map((entry) => string(entry, `${path}.available_access_programs.cyber`))
    .flatMap((entry) => {
      const name = Object.hasOwn(names, entry) ? names[entry] : undefined;
      return name === undefined ? [] : [name];
    });
  return { cyber };
}

function absent(value: unknown, fallback: unknown): unknown {
  return value === undefined ? fallback : value;
}

function invalid(path: string): never {
  throw new Error(`模型目录字段无效：${path}。`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    invalid(path);
  }
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    invalid(path);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | null {
  return value == null ? null : string(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    invalid(path);
  }
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalid(path);
  }
  return value;
}

function choice(value: unknown, choices: string[], path: string): string {
  if (typeof value !== "string" || !choices.includes(value)) {
    invalid(path);
  }
  return value;
}
