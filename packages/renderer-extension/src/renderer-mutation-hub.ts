import { mutationAffectsElements } from "./renderer-dom-mutations.js";

export type DomMutationKind = "childList" | "attributes" | "characterData";

export interface DomMutationSubscription {
  /** 只接收这些变更类型。 */
  kinds: readonly DomMutationKind[];
  /** attributes 类型需要监听的属性名；非空时忽略其余属性变更。 */
  attributeFilter?: readonly string[];
  /** 返回 true 的记录进入 onMutate。 */
  test: (mutation: MutationRecord) => boolean;
  /** 每个 MutationObserver 批次只调用一次，携带本订阅匹配到的记录。 */
  onMutate: (records: readonly MutationRecord[]) => void;
}

export interface DomMutationHub {
  subscribe(subscription: DomMutationSubscription): () => void;
  dispose(): void;
}

// 只订阅自身变更类型 + 属性过滤语义与 MutationObserver 一致：属性记录在
// test 之前先按订阅自己的 attributeFilter 过滤，避免共享 observer 的并集把
// 其他订阅关心的属性变更误投给本订阅。
interface ActiveSubscription {
  kinds: Set<DomMutationKind>;
  attributeFilter: Set<string> | null;
  test: (mutation: MutationRecord) => boolean;
  onMutate: (records: readonly MutationRecord[]) => void;
}

function kindSet(kinds: readonly DomMutationKind[]): Set<DomMutationKind> {
  return new Set(kinds);
}

function createDomMutationHub(ownerDocument: Document): DomMutationHub {
  const subscriptions = new Set<ActiveSubscription>();
  let observer: MutationObserver | null = null;
  let disposed = false;

  const attributeFilterUnion = (): string[] | undefined => {
    let bounded = true;
    const names = new Set<string>();
    for (const sub of subscriptions) {
      if (!sub.kinds.has("attributes")) continue;
      if (sub.attributeFilter === null) {
        bounded = false;
      } else {
        for (const name of sub.attributeFilter) names.add(name);
      }
    }
    return bounded ? [...names] : undefined;
  };

  const reobserve = (): void => {
    observer?.disconnect();
    observer = null;
    if (disposed || subscriptions.size === 0) return;
    const filter = attributeFilterUnion();
    const config: MutationObserverInit = {
      childList: [...subscriptions].some((sub) => sub.kinds.has("childList")),
      subtree: true,
      attributes: [...subscriptions].some((sub) => sub.kinds.has("attributes")),
      characterData: [...subscriptions].some((sub) => sub.kinds.has("characterData")),
    };
    if (config.attributes && filter) config.attributeFilter = filter;
    const next = new MutationObserver((records) => {
      if (disposed) return;
      for (const sub of subscriptions) {
        const matched: MutationRecord[] = [];
        for (const record of records) {
          if (!sub.kinds.has(record.type)) continue;
          if (
            record.type === "attributes" &&
            sub.attributeFilter !== null &&
            !sub.attributeFilter.has(record.attributeName ?? "")
          ) {
            continue;
          }
          if (sub.test(record)) matched.push(record);
        }
        if (matched.length > 0) sub.onMutate(matched);
      }
    });
    next.observe(ownerDocument.documentElement, config);
    observer = next;
  };

  return {
    subscribe(subscription) {
      if (disposed) return () => undefined;
      const active: ActiveSubscription = {
        ...subscription,
        kinds: kindSet(subscription.kinds),
        attributeFilter: subscription.attributeFilter
          ? new Set(subscription.attributeFilter)
          : null,
      };
      subscriptions.add(active);
      reobserve();
      return () => {
        subscriptions.delete(active);
        reobserve();
      };
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      observer = null;
      subscriptions.clear();
    },
  };
}

const hubs = new WeakMap<Document, DomMutationHub>();

/** 每个 Document 一个共享 MutationObserver；订阅者只按自身范围收窄。 */
export function getDomMutationHub(ownerDocument: Document): DomMutationHub {
  let hub = hubs.get(ownerDocument);
  if (!hub) {
    hub = createDomMutationHub(ownerDocument);
    hubs.set(ownerDocument, hub);
  }
  return hub;
}

/** 观察者的属性记录会被 test 之外的 attributeFilter 二次过滤，保证语义不变。 */
export function selectorMutationTest(selector: string, observeContents = true) {
  return (mutation: MutationRecord): boolean =>
    mutationAffectsElements(mutation, selector, observeContents);
}
